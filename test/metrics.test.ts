import { describe, expect, it } from "vitest";
import { Decimal, d } from "../src/decimal.js";
import { chain, dailyReturns, maxDrawdown, sharpe, sortino } from "../src/metrics.js";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const H = 3_600_000;
const DAY = 24 * H;
const mark = (day: number, equity: string) => ({ time: T0 + day * DAY, equity: d(equity) });
const close = (x: Decimal | null, expected: string) => {
  expect(x).not.toBeNull();
  expect(x!.minus(expected).abs().lt("1e-20")).toBe(true);
};

const flow = (day: number, hour: number, usd: string, before: string, after: string) => ({ time: T0 + day * DAY + hour * H, usd: d(usd), before: d(before), after: d(after) });

describe("dailyReturns: true time-weighted, cut at each flow", () => {
  // Day 1: no flows.                       1100/1000                    -> 0.1
  // Day 2: 1100 -> 1210 at 12:00, +500 -> 1710, ends 1795.5.
  //        (1210/1100) * (1795.5/1710) = 1.1 * 1.05                     -> 0.155
  // Day 3: -200 at exactly 00:00: 1795.5 -> 1595.5, ends 1755.05.
  //        (1795.5/1795.5) * (1755.05/1595.5) = 1.1                     -> 0.1
  // TWR = 1.1 * 1.155 * 1.1 - 1 = 0.39755
  const marks = [mark(0, "1000"), mark(1, "1100"), mark(2, "1795.5"), mark(3, "1755.05")];
  const flows = [flow(1, 12, "500", "1210", "1710"), flow(2, 0, "-200", "1795.5", "1595.5")];
  const days = dailyReturns(marks, flows);

  it("chains the pieces between flows", () => {
    close(days[0]!.ret, "0.1");
    close(days[1]!.ret, "0.155");
    close(days[2]!.ret, "0.1");
  });

  it("puts a flow at exactly 00:00 in the day that starts then", () => {
    expect(days[1]!.flows.toString()).toBe("500");
    expect(days[2]!.flows.toString()).toBe("-200");
  });

  it("chains to the hand-computed TWR", () => {
    close(chain(days.map((x) => x.ret)), "0.39755");
  });

  it("does not depend on the size of a flow", () => {
    // Same 10% then 5% growth, deposit 500 or 50,000 at 12:00: same return.
    const small = dailyReturns([mark(0, "1000"), mark(1, "1680")], [flow(0, 12, "500", "1100", "1600")]);
    const big = dailyReturns([mark(0, "1000"), mark(1, "53655")], [flow(0, 12, "50000", "1100", "51100")]);
    close(small[0]!.ret, "0.155");
    close(big[0]!.ret, "0.155");
  });

  it("handles a first deposit into an empty account", () => {
    // 0 until 06:00, +1000, ends 1010. The empty piece is skipped. -> 0.01
    const r = dailyReturns([mark(0, "0"), mark(1, "1010")], [flow(0, 6, "1000", "0", "1000")]);
    close(r[0]!.ret, "0.01");
  });

  it("skips the swept-out piece when an account empties and refills in a day", () => {
    // 5000 -> 5500 by 12:00, all withdrawn; empty until 18:00; +6000, ends 6600.
    // 1.1 * (skipped) * 1.1 -> 0.21. Modified Dietz gave nonsense here.
    const r = dailyReturns([mark(0, "5000"), mark(1, "6600")], [flow(0, 12, "-5500", "5500", "0"), flow(0, 18, "6000", "0", "6000")]);
    close(r[0]!.ret, "0.21");
  });

  it("ignores dust below $1 and returns null for a day with no capital", () => {
    expect(dailyReturns([mark(0, "0.000001"), mark(1, "0.000002")], [])[0]!.ret).toBeNull();
    expect(dailyReturns([mark(0, "0"), mark(1, "0")], [])[0]!.ret).toBeNull();
  });
});

describe("maxDrawdown", () => {
  it("measures the largest peak-to-trough fall of the index", () => {
    // index: 1.1, 0.88, 0.924, 0.8316, 1.08108. Peak 1.1, trough 0.8316 -> 0.2684/1.1 = 0.244
    const rets = ["0.1", "-0.2", "0.05", "-0.1", "0.3"].map(d);
    close(maxDrawdown(rets), "0.244");
  });
  it("is zero when the index never falls", () => {
    expect(maxDrawdown(["0.01", "0", "0.02"].map(d)).toString()).toBe("0");
  });
  it("counts a fall from the starting value", () => {
    close(maxDrawdown(["-0.5", "0.5"].map(d)), "0.5");
  });
});

describe("sharpe and sortino", () => {
  // 15 days of +1% and 15 of -0.5%. mean = 0.0025, deviations are +-0.0075.
  // sample sd = 0.0075 * sqrt(30/29)        -> sharpe  = (1/3) * sqrt(29/30) * sqrt(365)
  // downside dev = sqrt(15 * 0.005^2 / 30)  -> sortino = 0.5 * sqrt(2) * sqrt(365) = 0.5 * sqrt(730)
  const rets = Array.from({ length: 30 }, (_, i) => d(i % 2 === 0 ? "0.01" : "-0.005"));

  it("annualizes with sqrt(365)", () => {
    close(sharpe(rets), new Decimal(29).div(30).sqrt().times(new Decimal(365).sqrt()).div(3).toString());
    close(sortino(rets), new Decimal(730).sqrt().div(2).toString());
  });

  it("is null below 30 observations", () => {
    expect(sharpe(rets.slice(1))).toBeNull();
    expect(sortino(rets.slice(1))).toBeNull();
  });

  it("is null when there is no variance or no downside", () => {
    expect(sharpe(Array.from({ length: 30 }, () => d("0.01")))).toBeNull();
    expect(sortino(Array.from({ length: 30 }, () => d("0.01")))).toBeNull();
  });
});
