// A hand-built three-day snapshot. Every expected number in score.test.ts is worked out by hand
// from the events below.
//
// Start (before 2026-01-01 00:00): 10,000 USDC, no positions.
// 01-01 06:00  buy 1 BTC @ 50,000, fee 20
// 01-01 08:00  funding -5
// 01-02 00:00  mark: BTC daily close 51,000. cash -40,025 + 51,000          = 10,975
// 01-02 12:00  deposit 5,000
// 01-02 18:00  sell 1 BTC @ 52,000, fee 20.8
// 01-03 00:00  mark: flat. cash -40,025 + 5,000 + 52,000 - 20.8            = 16,954.2
// 01-03 06:00  withdraw 1,000 + 1 fee
// 01-03 10:00  rewards claim 10 USDC (non-trading income)
// 01-04 00:00  mark: 16,954.2 - 1,001 + 10                                 = 15,963.2
// 01-04 05:00  buy 0.1 BTC @ 53,000, fee 2 (after the period)
// anchor 01-05: cash 15,963.2 - 5,300 - 2 = 10,661.2, BTC 0.1 (mark 53,500)
import type { Snapshot } from "../../src/snapshot.js";

const t = (s: string) => Date.parse(s);
const ANCHOR = t("2026-01-05T00:00:00Z");

const fill = (time: string, side: "B" | "A", px: string, sz: string, fee: string, start: string) => ({
  coin: "BTC",
  px,
  sz,
  side,
  time: t(time),
  startPosition: start,
  dir: side === "B" ? "Open Long" : "Close Long",
  closedPnl: "0.0",
  hash: "0x" + "0".repeat(64),
  oid: 1,
  crossed: true,
  fee,
  tid: t(time),
  feeToken: "USDC",
});

const candle = (day: string, c: string) => ({ t: t(day + "T00:00:00Z"), T: t(day + "T00:00:00Z") + 86_399_999, s: "BTC", i: "1d", o: c, c, h: c, l: c, v: "1", n: 1 });

export type Mode = "default" | "unifiedAccount";

export function basicSnapshot(mode: Mode = "default"): Snapshot {
  const position = { type: "oneWay", position: { coin: "BTC", szi: "0.1", entryPx: "53000", positionValue: "5350", unrealizedPnl: "50" } };
  const files: Record<string, unknown> = {
    "perpDexs.json": [null],
    "spotMeta.json": { tokens: [{ name: "USDC", index: 0 }], universe: [] },
    "meta/_default.json": { universe: [{ name: "BTC" }], collateralToken: 0 },
    "userAbstraction.json": mode,
    // Standard: perp cash lives in the clearinghouse as totalRawUsd.
    // Unified: spot USDC carries perp equity at mark (cash + szi * mark = 10,661.2 + 5,350).
    "spotClearinghouseState.json": { balances: mode === "default" ? [] : [{ coin: "USDC", token: 0, total: "16011.2", hold: "0", entryNtl: "0" }] },
    "clearinghouseState/_default.json": {
      marginSummary: { accountValue: "16011.2", totalRawUsd: mode === "default" ? "10661.2" : "-5300", totalNtlPos: "5350", totalMarginUsed: "0" },
      assetPositions: [position],
      time: ANCHOR,
    },
    "portfolio.json": [],
    "userVaultEquities.json": [],
    "delegatorSummary.json": { delegated: "0.0", undelegated: "0.0", totalPendingWithdrawal: "0.0", nPendingWithdrawals: 0 },
    "userFillsByTime/0001.json": [
      fill("2026-01-01T06:00:00Z", "B", "50000", "1", "20", "0"),
      fill("2026-01-02T18:00:00Z", "A", "52000", "1", "20.8", "1"),
      fill("2026-01-04T05:00:00Z", "B", "53000", "0.1", "2", "0"),
    ],
    "userFunding/0001.json": [
      { time: t("2026-01-01T08:00:00Z"), hash: "0x0", delta: { type: "funding", coin: "BTC", usdc: "-5", szi: "1", fundingRate: "0.0001", nSamples: 1 } },
    ],
    "userNonFundingLedgerUpdates/0001.json": [
      { time: t("2026-01-02T12:00:00Z"), hash: "0x1", delta: { type: "deposit", usdc: "5000" } },
      { time: t("2026-01-03T06:00:00Z"), hash: "0x2", delta: { type: "withdraw", usdc: "1000", nonce: 1, fee: "1" } },
      { time: t("2026-01-03T10:00:00Z"), hash: "0x3", delta: { type: "rewardsClaim", amount: "10" } },
    ],
    "candles/1d/BTC.json": [candle("2025-12-31", "49000"), candle("2026-01-01", "51000"), candle("2026-01-02", "52500"), candle("2026-01-03", "53000")],
  };
  const text: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) text[k] = JSON.stringify(v);
  return {
    meta: {
      format: 1,
      address: "0x0000000000000000000000000000000000000001",
      from: "2026-01-01",
      to: "2026-01-04",
      fetchedAt: "2026-01-05T00:00:01.000Z",
      requests: Object.keys(files).map((file) => ({
        file,
        body: file.startsWith("candles/") ? { type: "candleSnapshot", req: { coin: "BTC", interval: "1d", startTime: 0, endTime: 0 } } : { type: file.split(/[/.]/)[0]! },
      })),
    },
    files: text,
  };
}
