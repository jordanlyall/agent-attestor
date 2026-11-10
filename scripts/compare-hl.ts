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
import { buildAccount, flowUsd, holdingsAt, priceSource, equityOf, usdcPairOf, type Account, type Holdings, type PriceSource } from "../src/replay.js";

interface Candle {
  t: number;
  T: number;
  c: string;
  h: string;
  l: string;
}

function candleAround(acc: Account, coin: string, t: number): Candle | undefined {
  for (const iv of ["1h", "1d"] as const) {
    const list = (acc.candles[iv].get(coin) ?? []) as unknown as Candle[];
    const c = list.find((x) => x.t <= t && t <= x.T);
    if (c) return c;
  }
  // No trade in the hour or day around t (thin market): use the last candle before it.
  for (const iv of ["1h", "1d"] as const) {
    const c = ((acc.candles[iv].get(coin) ?? []) as unknown as Candle[]).filter((x) => x.T < t).pop();
    if (c) return c;
  }
  return undefined;
}

function rangeBound(acc: Account, h: Holdings, t: number): Decimal {
  const bound = (coin: string, qty: Decimal): Decimal => {
    const c = candleAround(acc, coin, t);
    if (!c) throw new Error(`no candle for ${coin} around ${new Date(t).toISOString()}`);
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
  vaultFlowsInWindow: string;
  diffExVault: string;
  passExVault: boolean;
  hlRepeatedSamples: number;
  ourFlows: string;
  vaultEquityAtAnchor: string;
  stakedHypeAtAnchor: string;
}

// Price at an HL sample: last 1h close before it, or the last 1d close when hourly candles no
// longer reach back that far (the API serves the 5000 most recent candles per interval).
function samplePrice(acc: Account): PriceSource {
  const h = priceSource(acc, "1h");
  const dd = priceSource(acc, "1d");
  const pick = (coin: string, t: number) => {
    const list = acc.candles["1h"].get(coin);
    return list && list.length > 0 && list[0]!.t <= t - 3_600_000 ? h.price(coin, t) : dd.price(coin, t);
  };
  const src: PriceSource = {
    staleness: 0,
    price: pick,
    tokenPrice(token, t) {
      if (token === "USDC") return new Decimal(1);
      const pair = usdcPairOf(acc, token);
      if (!pair) throw new Error(`token ${token} has no USDC pair`);
      return pick(pair, t);
    },
  };
  return src;
}

export function compare(dir: string, preferred = "month"): Comparison {
  const { snapshot } = loadSnapshot(dir);
  const acc = buildAccount(snapshot);
  const from = Date.parse(snapshot.meta.from + "T00:00:00Z");
  // Use HL's month window when it overlaps the snapshot, else allTime (coarser, older).
  let window = preferred;
  let series = acc.portfolio.find(([k]) => k === window)?.[1];
  let av = (series?.accountValueHistory ?? []).filter(([t]) => t >= from && t <= acc.anchorTime);
  if (av.length < 2 || av[0]![0] > from + 2 * 86_400_000) {
    window = "allTime";
    series = acc.portfolio.find(([k]) => k === window)?.[1];
    av = (series?.accountValueHistory ?? []).filter(([t]) => t >= from && t <= acc.anchorTime);
  }
  if (!series) throw new Error("portfolio has no usable window");
  const pnl = new Map(series.pnlHistory.map(([t, v]) => [t, v]));
  if (av.length < 2) throw new Error("fewer than 2 HL samples inside the snapshot");
  const px = samplePrice(acc);
  const ours = av.map(([t, v]) => {
    const h = holdingsAt(acc, t + 1); // HL's sample includes events at its timestamp
    return { t, hl: new Decimal(v), ours: equityOf(h, t, px), h };
  });
  const first = ours[0]!;
  const last = ours[ours.length - 1]!;
  let flows = ZERO;
  let vaultFlows = ZERO;
  for (const e of acc.events)
    if (e.kind === "ledger" && e.time > first.t && e.time <= last.t) {
      const v = flowUsd(e, px);
      flows = flows.plus(v);
      if (e.flow?.kind === "vault") vaultFlows = vaultFlows.plus(v);
    }
  // HL keeps vault equity inside account value, so vault PnL is PnL to HL and a flow to us.
  // When no vault is held at either end, HL's extra PnL is exactly -vaultFlows.
  let frozen = 0;
  for (let k = 1; k < av.length; k++) if (av[k]![1] === av[k - 1]![1]) frozen++;
  const ourPnl = last.ours.minus(first.ours).minus(flows);
  const hlPnl = new Decimal(pnl.get(last.t)!).minus(pnl.get(first.t)!);
  const tol = rangeBound(acc, first.h, first.t).plus(rangeBound(acc, last.h, last.t)).plus("0.01");
  const diff = ourPnl.minus(hlPnl);
  const diffExVault = diff.plus(vaultFlows);
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
    vaultFlowsInWindow: fixed(vaultFlows, 2),
    diffExVault: fixed(diffExVault, 2),
    passExVault: diffExVault.abs().lte(tol),
    hlRepeatedSamples: frozen,
    ourFlows: fixed(flows, 2),
    vaultEquityAtAnchor: fixed(acc.extras.vaultEquityUsd, 2),
    stakedHypeAtAnchor: fixed(acc.extras.stakedHype, 4),
  };
}

if (process.argv[1] && process.argv[1].endsWith("compare-hl.ts")) {
  for (const dir of process.argv.slice(2)) console.log(JSON.stringify(compare(dir), null, 1));
}
