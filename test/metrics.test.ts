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

describe("dailyReturns: Modified Dietz within the day", () => {
  // Day 1: no flows.             r = (1100 - 1000) / 1000                 = 0.1
  // Day 2: +500 at 12:00, w=0.5. r = (1700 - 1100 - 500) / (1100 + 250)  = 100/1350 = 2/27
  // Day 3: -200 at 00:00, w=1.   r = (1450 - 1700 + 200) / (1700 - 200)  = -50/1500 = -1/30
  // TWR = 1.1 * 29/27 * 29/30 - 1 = 115.1/810
  const marks = [mark(0, "1000"), mark(1, "1100"), mark(2, "1700"), mark(3, "1450")];
  const flows = [
    { time: T0 + DAY + 12 * H, usd: d("500") },
    { time: T0 + 2 * DAY, usd: d("-200") },
  ];
  const days = dailyReturns(marks, flows);

  it("weights each flow by the share of the day left", () => {
    close(days[0]!.ret, "0.1");
    close(days[1]!.ret, new Decimal(2).div(27).toString());
    close(days[2]!.ret, new Decimal(-1).div(30).toString());
  });

  it("puts a flow at exactly 00:00 in the day that starts then", () => {
    expect(days[1]!.flows.toString()).toBe("500");
    expect(days[2]!.flows.toString()).toBe("-200");
  });

  it("chains to the hand-computed TWR", () => {
    close(chain(days.map((x) => x.ret)), new Decimal("115.1").div(810).toString());
  });

  it("handles a first deposit into an empty account", () => {
    // E0 = 0, +1000 at 06:00 (w = 0.75), E1 = 1010. r = 10 / 750
    const r = dailyReturns([mark(0, "0"), mark(1, "1010")], [{ time: T0 + 6 * H, usd: d("1000") }]);
    close(r[0]!.ret, new Decimal(10).div(750).toString());
  });

  it("returns null for a day with no capital", () => {
    const r = dailyReturns([mark(0, "0"), mark(1, "0")], []);
    expect(r[0]!.ret).toBeNull();
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
