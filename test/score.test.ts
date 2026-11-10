import { describe, expect, it } from "vitest";
import { Decimal } from "../src/decimal.js";
import { score } from "../src/score.js";
import { canonicalJson } from "../src/canonical.js";
import { sha256 } from "../src/hash.js";
import { basicSnapshot } from "./fixtures/basic.js";
import type { Snapshot } from "../src/snapshot.js";

const m = score(basicSnapshot()) as any;
const ten = (x: Decimal) => x.toDecimalPlaces(10, Decimal.ROUND_HALF_EVEN).toFixed(10);

describe("score on the hand-built fixture", () => {
  it("rebuilds daily equity from the anchor", () => {
    expect(m.daily.map((x: any) => x.startEquity)).toEqual(["10000.000000", "10975.000000", "16954.200000"]);
    expect(m.equity.end).toBe("15963.200000");
  });

  it("computes the return with a deposit and a withdrawal", () => {
    // Day 1: 10975/10000. Day 2: 10975 -> 11475 before the 12:00 deposit, 16475 after, ends
    // 16954.2. Day 3: only flows, nothing held -> 0.
    const day2 = new Decimal(11475).div(10975).times(new Decimal("16954.2").div(16475));
    expect(m.daily.map((x: any) => x.return)).toEqual(["0.0975000000", ten(day2.minus(1)), "0.0000000000"]);
    expect(m.twrNet).toBe(ten(new Decimal("1.0975").times(day2).minus(1)));
  });

  it("separates PnL from flows", () => {
    // 2,000 trading gain - 40.8 fees - 5 funding
    expect(m.pnlNet).toBe("1954.200000");
    expect(m.externalFlows).toEqual({
      deposits: "5000.000000",
      withdrawals: "-1001.000000",
      transfersIn: "0.000000",
      transfersOut: "0.000000",
      vault: "0.000000",
      staking: "0.000000",
      nonTrading: "10.000000",
      other: "0.000000",
      net: "4009.000000",
    });
  });

  it("reports fees, funding and non-trading income", () => {
    expect(m.feesPaid).toEqual({ usd: "40.800000", shareOfStartEquity: "0.0040800000" });
    expect(m.fundingNet).toEqual({ usd: "-5.000000", shareOfStartEquity: "-0.0005000000" });
    expect(m.nonTradingIncome).toEqual({ usd: "10.000000" });
  });

  it("computes turnover over average daily equity", () => {
    // 102,000 traded / mean(10000, 10975, 16954.2, 15963.2) = 102000 / 13473.1
    expect(m.notionalTraded).toBe("102000.000000");
    expect(m.equity.averageDaily).toBe("13473.100000");
    expect(m.turnover).toBe(ten(new Decimal(102000).div("13473.1")));
  });

  it("applies the minimums and nulls", () => {
    expect(m.maxDrawdown).toBe("0.0000000000");
    expect(m.sharpe).toBeNull();
    expect(m.sortino).toBeNull();
    expect(m.operatorCohort).toBeNull();
    expect(m.meetsMinimums).toBe(false);
  });

  it("checks every fill against HL's startPosition", () => {
    // Three fills from the period start to the anchor, including the one after the period.
    expect(m.integrity.positionChecks).toBe(3);
    expect(m.integrity.positionDust).toBe(0);
  });

  it("stops when a position changed without a fill", () => {
    const s = basicSnapshot();
    // Anchor says flat, but the post-period buy leaves 0.1 BTC: the replay disagrees with HL.
    const ch = JSON.parse(s.files["clearinghouseState/_default.json"]!);
    ch.assetPositions = [];
    s.files["clearinghouseState/_default.json"] = JSON.stringify(ch);
    expect(() => score(s)).toThrow(/without a public fill/);
  });

  it("catches a missing opening fill that the startPosition check cannot see", () => {
    // Drop the 01-01 buy. Undoing the 01-02 sell now invents 1 BTC from before the period, and
    // that agrees with the sell's startPosition. HL charged no funding before 07:00, so the
    // hourly funding check finds it.
    const s = basicSnapshot();
    s.files["userFillsByTime/0001.json"] = JSON.stringify(JSON.parse(s.files["userFillsByTime/0001.json"]!).slice(1));
    expect(() => score(s)).toThrow(/2026-01-01T00:00:00.000Z BTC: replay holds 1, HL charged funding on nothing/);
  });

  it("stops when funding was charged on a position the replay does not hold", () => {
    const s = basicSnapshot();
    const rows = JSON.parse(s.files["userFunding/0001.json"]!);
    rows.push({ time: Date.parse("2026-01-03T05:00:00Z"), hash: "0x0", delta: { type: "funding", coin: "BTC", usdc: "-1", szi: "0.5", fundingRate: "0.0", nSamples: null } });
    s.files["userFunding/0001.json"] = JSON.stringify(rows);
    expect(() => score(s)).toThrow(/replay holds 0, HL charged funding on 0.5/);
  });

  it("gives the same metrics for a unified account", () => {
    const u = score(basicSnapshot("unifiedAccount")) as any;
    expect({ ...u, accountMode: "x" }).toEqual({ ...m, accountMode: "x" });
  });

  it("refuses ledger types it does not understand", () => {
    const s = basicSnapshot();
    s.files["userNonFundingLedgerUpdates/0001.json"] = JSON.stringify([{ time: Date.parse("2026-01-02T00:00:00Z"), hash: "0x9", delta: { type: "borrowLend", token: "HYPE", operation: "supply", amount: "1", interestAmount: "0" } }]);
    expect(() => score(s)).toThrow(/borrowLend/);
  });
});

describe("TWAP slices", () => {
  // Move the 01-01 buy into the TWAP slice endpoint, shaped as HL serves it: a wrapper with the
  // twapId, a zero hash and a null nested twapId.
  const withTwap = (executedSz: string, status = "finished"): Snapshot => {
    const s = basicSnapshot();
    const fills = JSON.parse(s.files["userFillsByTime/0001.json"]!);
    const open = { ...fills[0], hash: "0x" + "0".repeat(64), twapId: null };
    s.files["userFillsByTime/0001.json"] = JSON.stringify(fills.slice(1));
    s.files["userTwapSliceFillsByTime/0001.json"] = JSON.stringify([{ fill: open, twapId: 7 }]);
    const started = Date.parse("2026-01-01T05:59:00Z");
    s.files["twapHistory.json"] = JSON.stringify([
      { time: Date.parse("2026-01-01T06:00:30Z") / 1000, state: { coin: "BTC", side: "B", sz: "1.0", executedSz, executedNtl: "50000.0", minutes: 5, timestamp: started }, status: { status }, twapId: 7 },
    ]);
    return s;
  };

  it("scores a TWAP opening exactly like the same fill from userFillsByTime", () => {
    const t = score(withTwap("1.0")) as any;
    expect(t.integrity.twapOrders).toBe(1);
    expect(t.integrity.twapSlices).toBe(1);
    expect({ ...t, integrity: null }).toEqual({ ...m, integrity: null });
  });

  it("counts a slice once when the regular fill stream also serves it", () => {
    const s = withTwap("1.0");
    s.files["userFillsByTime/0001.json"] = basicSnapshot().files["userFillsByTime/0001.json"]!;
    const t = score(s) as any;
    expect({ ...t, integrity: null }).toEqual({ ...m, integrity: null });
  });

  it("refuses a TWAP whose early slices are no longer served", () => {
    expect(() => score(withTwap("2.0"))).toThrow(/TWAP 7 on BTC .* executed 2.0 but HL serves slices for only 1/);
  });

  it("refuses a TWAP still running at the anchor", () => {
    expect(() => score(withTwap("0.0", "activated"))).toThrow(/TWAP 7 on BTC was still running/);
  });

  it("refuses a slice whose TWAP is not in twapHistory", () => {
    const s = withTwap("1.0");
    s.files["twapHistory.json"] = "[]";
    expect(() => score(s)).toThrow(/belongs to TWAP 7, which twapHistory does not list/);
  });
});

describe("determinism", () => {
  const shuffled = (s: Snapshot): Snapshot => {
    const keys = Object.keys(s.files).reverse();
    const files: Record<string, string> = {};
    for (const k of keys) files[k] = s.files[k]!;
    return { meta: { ...s.meta, requests: [...s.meta.requests].reverse(), fetchedAt: "1999-01-01T00:00:00.000Z" }, files };
  };

  it("gives byte-identical metrics for the same snapshot, whatever the file order or fetch time", () => {
    const a = canonicalJson(score(basicSnapshot()));
    const b = canonicalJson(score(shuffled(basicSnapshot())));
    expect(b).toBe(a);
    // Locked so that any change to the output is deliberate. Update with a methodology bump.
    expect(sha256(a)).toBe("47808fdbb8b267632d55feb8c0723482a77772afff00d7bb3b1eec17d521cdd1");
  });

  it("writes no timestamps or floats", () => {
    const text = canonicalJson(score(basicSnapshot()));
    expect(text).not.toMatch(/fetchedAt|generatedAt|T\d\d:\d\d:\d\d/);
    expect(text).not.toMatch(/: -?\d+\.\d+[,\n]/); // every decimal is a quoted fixed string
  });
});
