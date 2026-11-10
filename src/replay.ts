// Rebuild the account's holdings at any past time from public events.
//
// Model: the account is a set of token balances plus signed perp positions.
//   equity(t) = sum(balance[token] * price(token, t)) + sum(szi[coin] * price(coin, t))
// Perp trades book their notional against the dex's collateral token (USDC on the default
// dex), so a position is worth szi * price on top of that. This is the same identity HL uses
// (accountValue = totalRawUsd + sum(szi * markPx)) and it does not depend on account mode.
//
// We start from the current state (the anchor) and walk events back to the period start.
// Cash is exact. Only prices are approximate: historical mark prices are not served, so
// positions are valued at the last candle close before the mark (see methodology.md).
import { Decimal, ZERO, d } from "./decimal.js";
import type { Snapshot } from "./snapshot.js";
import type { SpotMetaRaw } from "./indexer.js";
import { safeName, usdcPair } from "./indexer.js";

export class UnsupportedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "UnsupportedError";
  }
}

export type FlowKind = "deposit" | "withdraw" | "transferIn" | "transferOut" | "vault" | "staking" | "nonTrading" | "other";

export interface Fill {
  kind: "fill";
  time: number;
  coin: string;
  spot: boolean;
  base: string; // spot: base token; perp: coin
  quote: string; // spot: quote token; perp: collateral token
  signedSz: Decimal;
  px: Decimal;
  fee: Decimal;
  feeToken: string;
  startPosition: Decimal;
  dir: string;
  key: string;
}

export interface Funding {
  kind: "funding";
  time: number;
  coin: string;
  token: string;
  usdc: Decimal;
  key: string;
}

// A ledger entry, reduced to balance changes. External ones carry a flow.
export interface Ledger {
  kind: "ledger";
  time: number;
  type: string;
  deltas: { token: string; amount: Decimal }[];
  flow: { kind: FlowKind; usd: Decimal | null } | null; // usd null: value from prices
  key: string;
}

export type Event = Fill | Funding | Ledger;

export interface Holdings {
  balances: Map<string, Decimal>;
  perps: Map<string, Decimal>;
}

interface Candle {
  t: number;
  T: number;
  c: string;
}

export interface Account {
  address: string;
  mode: string;
  anchorTime: number;
  events: Event[]; // sorted, all with time <= anchorTime
  anchor: Holdings;
  spotMeta: SpotMetaRaw;
  candles: { "1d": Map<string, Candle[]>; "1h": Map<string, Candle[]> };
  collateral: Map<string, string>; // dex name ("" default) -> collateral token name
  extras: { vaultEquityUsd: Decimal; stakedHype: Decimal };
  portfolio: [string, { accountValueHistory: [number, string][]; pnlHistory: [number, string][]; vlm: string }][];
}

const json = (snap: Snapshot, file: string): any => {
  const t = snap.files[file];
  if (t === undefined) throw new Error(`snapshot missing ${file}`);
  return JSON.parse(t);
};

function add(m: Map<string, Decimal>, k: string, v: Decimal): void {
  const n = (m.get(k) ?? ZERO).plus(v);
  if (n.isZero()) m.delete(k);
  else m.set(k, n);
}

export function dexOf(coin: string): string {
  const i = coin.indexOf(":");
  return i < 0 ? "" : coin.slice(0, i);
}

export function buildAccount(snap: Snapshot): Account {
  const address = snap.meta.address;
  const spotMeta = json(snap, "spotMeta.json") as SpotMetaRaw;
  const tokenName = new Map(spotMeta.tokens.map((t) => [t.index, t.name]));
  const pairs = new Map(spotMeta.universe.map((u) => [u.name, [tokenName.get(u.tokens[0])!, tokenName.get(u.tokens[1])!] as const]));

  const dexes = (json(snap, "perpDexs.json") as ({ name: string } | null)[]).map((x) => (x ? x.name : ""));
  const collateral = new Map<string, string>();
  for (const dex of dexes) {
    const meta = json(snap, `meta/${dex ? safeName(dex) : "_default"}.json`);
    const tok = tokenName.get(meta.collateralToken ?? 0);
    if (!tok) throw new UnsupportedError(`dex ${dex || "default"}: unknown collateral token ${meta.collateralToken}`);
    collateral.set(dex, tok);
  }
  const collateralOf = (coin: string): string => {
    const c = collateral.get(dexOf(coin));
    if (!c) throw new UnsupportedError(`coin ${coin}: unknown perp dex`);
    return c;
  };

  // Anchor
  const mode = String(json(snap, "userAbstraction.json"));
  const def = json(snap, "clearinghouseState/_default.json");
  const anchorTime = def.time as number;
  const balances = new Map<string, Decimal>();
  const perps = new Map<string, Decimal>();
  for (const b of json(snap, "spotClearinghouseState.json").balances) add(balances, b.coin, d(b.total));
  for (const dex of dexes) {
    const st = json(snap, `clearinghouseState/${dex ? safeName(dex) : "_default"}.json`);
    const col = collateral.get(dex)!;
    let signedNtl = ZERO;
    for (const ap of st.assetPositions) {
      const p = ap.position;
      if (ap.type !== "oneWay") throw new UnsupportedError(`position type ${ap.type}`);
      const szi = d(p.szi);
      add(perps, p.coin, szi);
      signedNtl = signedNtl.plus(d(p.positionValue).times(szi.isNeg() ? -1 : 1));
    }
    if (mode === "default" || mode === "disabled") {
      // Standard account: perp cash sits in the clearinghouse, separate from spot.
      add(balances, col, d(st.marginSummary.totalRawUsd));
    } else if (mode === "unifiedAccount" || mode === "portfolioMargin") {
      // Unified: the spot balance already includes perp equity at mark. Back out szi*mark
      // so that the position is not counted twice.
      add(balances, col, signedNtl.neg());
    } else {
      throw new UnsupportedError(`account mode ${mode}`);
    }
  }

  // Events
  const rows = (prefix: string): any[] => {
    const seen = new Map<string, any>();
    for (const f of Object.keys(snap.files).sort()) {
      if (!f.startsWith(prefix + "/")) continue;
      for (const r of json(snap, f)) seen.set(JSON.stringify(r), r);
    }
    // Keep the API's order (pages ascending, rows as served); it orders fills within a millisecond.
    return [...seen.values()];
  };
  const events: Event[] = [];
  for (const f of rows("userFillsByTime")) {
    const key = JSON.stringify(f);
    const sz = d(f.sz);
    const signedSz = f.side === "B" ? sz : f.side === "A" ? sz.neg() : null;
    if (!signedSz) throw new UnsupportedError(`fill side ${f.side}`);
    const pair = pairs.get(f.coin);
    events.push({
      kind: "fill",
      time: f.time,
      coin: f.coin,
      spot: !!pair,
      base: pair ? pair[0] : f.coin,
      quote: pair ? pair[1] : collateralOf(f.coin),
      signedSz,
      px: d(f.px),
      fee: d(f.fee),
      feeToken: f.feeToken,
      startPosition: d(f.startPosition),
      dir: f.dir,
      key,
    });
  }
  for (const f of rows("userFunding")) {
    if (f.delta.type !== "funding") throw new UnsupportedError(`funding delta type ${f.delta.type}`);
    events.push({ kind: "funding", time: f.time, coin: f.delta.coin, token: collateralOf(f.delta.coin), usdc: d(f.delta.usdc), key: JSON.stringify(f) });
  }
  for (const l of rows("userNonFundingLedgerUpdates")) events.push(ledgerEvent(l, address));

  // Stable sort by time; ties keep stream order (fills, funding, ledger) and API order.
  const order = { fill: 0, funding: 1, ledger: 2 } as const;
  const idx = new Map(events.map((e, n) => [e, n]));
  events.sort((a, b) => a.time - b.time || order[a.kind] - order[b.kind] || idx.get(a)! - idx.get(b)!);
  const inRange = events.filter((e) => e.time <= anchorTime);

  const candles = { "1d": new Map<string, Candle[]>(), "1h": new Map<string, Candle[]>() };
  for (const r of snap.meta.requests) {
    if ((r.body as any).type !== "candleSnapshot") continue;
    const req = (r.body as any).req;
    const list = (json(snap, r.file) as Candle[]).slice().sort((a, b) => a.t - b.t);
    (candles as any)[req.interval].set(req.coin, list);
  }

  const vaults = json(snap, "userVaultEquities.json") as { equity: string }[];
  const deleg = json(snap, "delegatorSummary.json");
  return {
    address,
    mode,
    anchorTime,
    events: inRange,
    anchor: { balances, perps },
    spotMeta,
    candles,
    collateral,
    extras: {
      vaultEquityUsd: vaults.reduce((a, v) => a.plus(d(v.equity)), ZERO),
      stakedHype: d(deleg?.delegated ?? "0").plus(d(deleg?.totalPendingWithdrawal ?? "0")),
    },
    portfolio: json(snap, "portfolio.json"),
  };
}

function ledgerEvent(l: any, me: string): Ledger {
  const x = l.delta;
  const key = JSON.stringify(l);
  const base = { kind: "ledger" as const, time: l.time as number, type: x.type as string, key };
  const usdc = (v: string) => d(v);
  const lower = (a: unknown) => (typeof a === "string" ? a.toLowerCase() : "");
  switch (x.type) {
    case "deposit":
      return { ...base, deltas: [{ token: "USDC", amount: usdc(x.usdc) }], flow: { kind: "deposit", usd: usdc(x.usdc) } };
    case "withdraw": {
      // usdc is the amount that leaves the account; fee is charged on top of it.
      const out = usdc(x.usdc).plus(d(x.fee ?? "0"));
      return { ...base, deltas: [{ token: "USDC", amount: out.neg() }], flow: { kind: "withdraw", usd: out.neg() } };
    }
    case "accountClassTransfer":
      return { ...base, deltas: [], flow: null };
    case "send":
    case "spotTransfer":
    case "internalTransfer":
    case "subAccountTransfer": {
      const token: string = x.token ?? "USDC";
      const amount = d(x.amount ?? x.usdc);
      const from = lower(x.user);
      const to = lower(x.destination);
      const fee = d(x.fee ?? "0");
      const feeToken: string = x.feeToken || token;
      const nativeFee = d(x.nativeTokenFee ?? "0");
      const valueOf = (amt: Decimal) => (token === "USDC" ? amt : x.usdcValue !== undefined ? d(x.usdcValue).times(amt).div(amount.isZero() ? 1 : amount) : null);
      const deltas: { token: string; amount: Decimal }[] = [];
      if (from === me && to === me) {
        // Move between this account's own dexes or spot/perp. Fee still leaves.
        if (!fee.isZero()) deltas.push({ token: feeToken, amount: fee.neg() });
        if (!nativeFee.isZero()) deltas.push({ token: "HYPE", amount: nativeFee.neg() });
        const feeUsd = feeToken === "USDC" ? fee.neg() : null;
        return { ...base, deltas, flow: fee.isZero() && nativeFee.isZero() ? null : { kind: "other", usd: nativeFee.isZero() ? feeUsd : null } };
      }
      if (from === me) {
        deltas.push({ token, amount: amount.neg() });
        if (!fee.isZero()) deltas.push({ token: feeToken, amount: fee.neg() });
        if (!nativeFee.isZero()) deltas.push({ token: "HYPE", amount: nativeFee.neg() });
        const v = valueOf(amount);
        const simple = feeToken === token && nativeFee.isZero();
        return { ...base, deltas, flow: { kind: "transferOut", usd: v && simple ? valueOf(amount.plus(fee))!.neg() : null } };
      }
      if (to === me) {
        deltas.push({ token, amount });
        return { ...base, deltas, flow: { kind: "transferIn", usd: valueOf(amount) } };
      }
      throw new UnsupportedError(`${x.type} not to or from this account: ${key}`);
    }
    case "vaultDeposit":
      return { ...base, deltas: [{ token: "USDC", amount: usdc(x.usdc).neg() }], flow: { kind: "vault", usd: usdc(x.usdc).neg() } };
    case "vaultWithdraw":
      return { ...base, deltas: [{ token: "USDC", amount: usdc(x.netWithdrawnUsd) }], flow: { kind: "vault", usd: usdc(x.netWithdrawnUsd) } };
    case "vaultDistribution":
      return { ...base, deltas: [{ token: "USDC", amount: usdc(x.usdc) }], flow: { kind: "vault", usd: usdc(x.usdc) } };
    case "vaultLeaderCommission":
      return { ...base, deltas: [{ token: "USDC", amount: usdc(x.usdc) }], flow: { kind: "nonTrading", usd: usdc(x.usdc) } };
    case "rewardsClaim": {
      const token: string = x.token ?? "USDC";
      return { ...base, deltas: [{ token, amount: d(x.amount) }], flow: { kind: "nonTrading", usd: token === "USDC" ? d(x.amount) : null } };
    }
    case "spotGenesis":
      return { ...base, deltas: [{ token: x.token, amount: d(x.amount) }], flow: { kind: "nonTrading", usd: null } };
    case "cStakingTransfer": {
      const amt = d(x.amount).times(x.isDeposit ? -1 : 1);
      return { ...base, deltas: [{ token: x.token, amount: amt }], flow: { kind: "staking", usd: null } };
    }
    case "liquidation":
      // Informational. The closing trades arrive as fills.
      return { ...base, deltas: [], flow: null };
    default:
      throw new UnsupportedError(`ledger type ${x.type} is not supported in Phase 0: ${key}`);
  }
}

export function applyEvent(h: Holdings, e: Event, sign: 1 | -1): void {
  const s = (x: Decimal) => (sign === 1 ? x : x.neg());
  if (e.kind === "fill") {
    if (e.spot) add(h.balances, e.base, s(e.signedSz));
    else add(h.perps, e.coin, s(e.signedSz));
    add(h.balances, e.quote, s(e.signedSz.times(e.px).neg()));
    add(h.balances, e.feeToken, s(e.fee.neg()));
  } else if (e.kind === "funding") {
    add(h.balances, e.token, s(e.usdc));
  } else {
    for (const x of e.deltas) add(h.balances, x.token, s(x.amount));
  }
}

export function clone(h: Holdings): Holdings {
  return { balances: new Map(h.balances), perps: new Map(h.perps) };
}

// Holdings just before `t` (events with time < t applied).
export function holdingsAt(acc: Account, t: number): Holdings {
  const h = clone(acc.anchor);
  for (let i = acc.events.length - 1; i >= 0; i--) {
    const e = acc.events[i]!;
    if (e.time < t) break;
    applyEvent(h, e, -1);
  }
  return h;
}

export type Interval = "1d" | "1h";

export interface PriceSource {
  price(coin: string, t: number): Decimal; // spot pair or perp coin
  tokenPrice(token: string, t: number): Decimal;
  staleness: number; // marks priced from a candle older than one interval
}

// Last candle close strictly before t.
export function priceSource(acc: Account, interval: Interval): PriceSource {
  const step = interval === "1d" ? 86_400_000 : 3_600_000;
  const src: PriceSource = {
    staleness: 0,
    price(coin, t) {
      const list = acc.candles[interval].get(coin) ?? (interval === "1h" ? undefined : undefined);
      if (!list || list.length === 0) throw new UnsupportedError(`no ${interval} candles for ${coin}`);
      let lo = 0;
      let hi = list.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid]!.T < t) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (best < 0) throw new UnsupportedError(`no ${interval} candle for ${coin} before ${new Date(t).toISOString()}`);
      const c = list[best]!;
      if (t - c.T > step) src.staleness++;
      return d(c.c);
    },
    tokenPrice(token, t) {
      if (token === "USDC") return d(1);
      const pair = usdcPair(acc.spotMeta, token);
      if (!pair) throw new UnsupportedError(`token ${token} has no USDC spot pair to price it`);
      return src.price(pair, t);
    },
  };
  return src;
}

// Gross value of everything that is not USDC: |token balances| plus |perp notional|.
export function exposureOf(h: Holdings, t: number, px: PriceSource): Decimal {
  let e = ZERO;
  for (const [tok, bal] of h.balances) if (tok !== "USDC") e = e.plus(bal.times(px.tokenPrice(tok, t)).abs());
  for (const [coin, szi] of h.perps) e = e.plus(szi.times(px.price(coin, t)).abs());
  return e;
}

export function equityOf(h: Holdings, t: number, px: PriceSource): Decimal {
  let e = ZERO;
  for (const [tok, bal] of h.balances) e = e.plus(bal.times(px.tokenPrice(tok, t)));
  for (const [coin, szi] of h.perps) e = e.plus(szi.times(px.price(coin, t)));
  return e;
}

// USD value of an external flow. Tokens without a stated USD value are priced at the flow time.
export function flowUsd(e: Ledger, px: PriceSource): Decimal {
  if (!e.flow) return ZERO;
  if (e.flow.usd) return e.flow.usd;
  let v = ZERO;
  for (const x of e.deltas) v = v.plus(x.amount.times(px.tokenPrice(x.token, e.time)));
  return v;
}

export { Decimal };

export function usdcPairOf(acc: Account, token: string): string | undefined {
  return usdcPair(acc.spotMeta, token);
}

// Below this, a startPosition difference is rounding dust HL applies without an event.
export const DUST = new Decimal("0.000001");

export interface PositionCheck {
  checks: number;
  dust: number;
  maxDust: Decimal;
}

// Walk forward from `from` to the anchor and compare every fill's startPosition with the replay.
// A real disagreement means some position change has no public event (the walk-back is then
// wrong for every earlier time), so scoring stops.
export function checkPositions(acc: Account, from: number): PositionCheck {
  const h = holdingsAt(acc, from);
  let checks = 0;
  let dust = 0;
  let maxDust = ZERO;
  for (const e of acc.events) {
    if (e.time < from) continue;
    if (e.kind === "fill") {
      const before = e.spot ? (h.balances.get(e.base) ?? ZERO) : (h.perps.get(e.coin) ?? ZERO);
      const diff = before.minus(e.startPosition).abs();
      checks++;
      if (diff.gt(DUST))
        throw new UnsupportedError(
          `replay disagrees with HL at ${new Date(e.time).toISOString()} ${e.coin}: replay ${before.toString()}, HL startPosition ${e.startPosition.toString()}. A position changed without a public fill.`,
        );
      if (!diff.isZero()) {
        dust++;
        if (diff.gt(maxDust)) maxDust = diff;
      }
    }
    applyEvent(h, e, 1);
  }
  return { checks, dust, maxDust };
}
