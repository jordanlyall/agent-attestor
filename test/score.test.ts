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
    // Day 1: 975/10000. Day 2: +5000 at 12:00 -> 979.2 / (10975 + 2500). Day 3: flows only -> 0.
    expect(m.daily.map((x: any) => x.return)).toEqual(["0.0975000000", ten(new Decimal("979.2").div(13475)), "0.0000000000"]);
    expect(m.twrNet).toBe(ten(new Decimal("1.0975").times(new Decimal("14454.2").div(13475)).minus(1)));
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
    expect(m.integrity.positionChecks).toBe(2);
    expect(m.integrity.positionMismatches).toBe(0);
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
    expect(sha256(a)).toBe("1e766a7ad810f6b9b2e802229b9d9288d0ca0897098524d3507b69ea51ac5be7");
  });

  it("writes no timestamps or floats", () => {
    const text = canonicalJson(score(basicSnapshot()));
    expect(text).not.toMatch(/fetchedAt|generatedAt|T\d\d:\d\d:\d\d/);
    expect(text).not.toMatch(/: -?\d+\.\d+[,\n]/); // every decimal is a quoted fixed string
  });
});
