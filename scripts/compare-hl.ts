// Compare replayed equity and PnL with Hyperliquid's own portfolio figures, offline, from a snapshot.
//
// HL publishes accountValueHistory and pnlHistory at its own sample times (not 00:00 UTC).
// We replay holdings to each of those exact times and value them at the last 1h candle close
// before the sample. PnL over HL's window = E(last) - E(first) - external flows between them.
//
// Tolerance (per wallet, per comparison): the only inexact input is price. At each endpoint,
// for every holding, the true mark lies within the traded range of the hour around the
// sample, so |our price - HL mark| <= (high - low) of the 1h candle containing the sample,
// plus 0.1% of price for the gap between last trade and HL's oracle-based mark.
//   tol = sum over both endpoints, all holdings of |qty| * ((high - low) + 0.001 * close) + 0.01
import { Decimal, ZERO, fixed } from "../src/decimal.js";
import { loadSnapshot } from "../src/snapshot.js";
import { buildAccount, flowUsd, holdingsAt, priceSource, equityOf, usdcPairOf, type Account, type Holdings } from "../src/replay.js";

interface Candle {
  t: number;
  T: number;
  c: string;
  h: string;
  l: string;
}

function rangeBound(acc: Account, h: Holdings, t: number): Decimal {
  const bound = (coin: string, qty: Decimal): Decimal => {
    const list = (acc.candles["1h"].get(coin) ?? []) as unknown as Candle[];
    const c = list.find((x) => x.t <= t && t <= x.T) ?? list.filter((x) => x.T < t).pop();
    if (!c) throw new Error(`no 1h candle for ${coin} near ${t}`);
    return qty.abs().times(new Decimal(c.h).minus(c.l).plus(new Decimal(c.c).times("0.001")));
  };
  let b = ZERO;
  for (const [tok, q] of h.balances) {
    if (tok === "USDC") continue;
    const pair = usdcPairOf(acc, tok);
    if (pair) b = b.plus(bound(pair, q));
  }
  for (const [coin, q] of h.perps) b = b.plus(bound(coin, q));
  return b;
}

export interface Comparison {
  address: string;
  mode: string;
  window: string;
  start: string;
  end: string;
  samples: number;
  hlPnl: string;
  ourPnl: string;
  diff: string;
  tolerance: string;
  pass: boolean;
  hlStartValue: string;
  ourStartValue: string;
  hlEndValue: string;
  ourEndValue: string;
  maxLevelDiff: string;
  ourFlows: string;
  vaultEquityAtAnchor: string;
  stakedHypeAtAnchor: string;
}

export function compare(dir: string, window = "month"): Comparison {
  const { snapshot } = loadSnapshot(dir);
  const acc = buildAccount(snapshot);
  const from = Date.parse(snapshot.meta.from + "T00:00:00Z");
  const series = acc.portfolio.find(([k]) => k === window)?.[1];
  if (!series) throw new Error(`portfolio has no ${window} window`);
  const av = series.accountValueHistory.filter(([t]) => t >= from && t <= acc.anchorTime);
  const pnl = new Map(series.pnlHistory.map(([t, v]) => [t, v]));
  if (av.length < 2) throw new Error("fewer than 2 HL samples inside the snapshot");
  const px = priceSource(acc, "1h");
  const ours = av.map(([t, v]) => {
    const h = holdingsAt(acc, t + 1); // HL's sample includes events at its timestamp
    return { t, hl: new Decimal(v), ours: equityOf(h, t, px), h };
  });
  const first = ours[0]!;
  const last = ours[ours.length - 1]!;
  let flows = ZERO;
  for (const e of acc.events) if (e.kind === "ledger" && e.time > first.t && e.time <= last.t) flows = flows.plus(flowUsd(e, px));
  const ourPnl = last.ours.minus(first.ours).minus(flows);
  const hlPnl = new Decimal(pnl.get(last.t)!).minus(pnl.get(first.t)!);
  const tol = rangeBound(acc, first.h, first.t).plus(rangeBound(acc, last.h, last.t)).plus("0.01");
  const diff = ourPnl.minus(hlPnl);
  const maxLevel = ours.reduce((m, x) => Decimal.max(m, x.ours.minus(x.hl).abs()), ZERO);
  return {
    address: acc.address,
    mode: acc.mode,
    window,
    start: new Date(first.t).toISOString(),
    end: new Date(last.t).toISOString(),
    samples: ours.length,
    hlPnl: fixed(hlPnl, 2),
    ourPnl: fixed(ourPnl, 2),
    diff: fixed(diff, 2),
    tolerance: fixed(tol, 2),
    pass: diff.abs().lte(tol),
    hlStartValue: fixed(first.hl, 2),
    ourStartValue: fixed(first.ours, 2),
    hlEndValue: fixed(last.hl, 2),
    ourEndValue: fixed(last.ours, 2),
    maxLevelDiff: fixed(maxLevel, 2),
    ourFlows: fixed(flows, 2),
    vaultEquityAtAnchor: fixed(acc.extras.vaultEquityUsd, 2),
    stakedHypeAtAnchor: fixed(acc.extras.stakedHype, 4),
  };
}

if (process.argv[1] && process.argv[1].endsWith("compare-hl.ts")) {
  for (const dir of process.argv.slice(2)) console.log(JSON.stringify(compare(dir), null, 1));
}
