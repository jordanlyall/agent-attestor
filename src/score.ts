// attestor score: a pure function from snapshot to metrics.
import { Decimal, ZERO, fixed, sum } from "./decimal.js";
import type { Snapshot } from "./snapshot.js";
import { buildAccount, applyEvent, checkPositions, equityOf, flowUsd, holdingsAt, priceSource, UnsupportedError, type Account, type FlowKind, type PriceSource } from "./replay.js";
import { chain, dailyReturns, marksFor, maxDrawdown, sharpe, sortino, type Flow, type Mark } from "./metrics.js";
import { DAY_MS, isoDate, parseDate } from "./time.js";

export const METHODOLOGY_VERSION = "phase0-v2";
const USD = 6;
const RATIO = 10;

const usd = (x: Decimal) => fixed(x, USD);
const ratio = (x: Decimal | null) => (x === null ? null : fixed(x, RATIO));
const share = (x: Decimal, base: Decimal) => (base.gt(0) ? fixed(x.div(base), RATIO) : null);

// Prices for intraday values (flows, fees): hourly candle if there is one, else daily.
function bestPrice(acc: Account): PriceSource {
  const h = priceSource(acc, "1h");
  const dd = priceSource(acc, "1d");
  const src: PriceSource = {
    staleness: 0,
    price(coin, t) {
      try {
        return h.price(coin, t);
      } catch (e) {
        if (!(e instanceof UnsupportedError)) throw e;
        return dd.price(coin, t);
      }
    },
    tokenPrice(token, t) {
      try {
        return h.tokenPrice(token, t);
      } catch (e) {
        if (!(e instanceof UnsupportedError)) throw e;
        return dd.tokenPrice(token, t);
      }
    },
  };
  return src;
}

export function score(snap: Snapshot): Record<string, unknown> {
  const acc = buildAccount(snap);
  const from = parseDate(snap.meta.from);
  const to = parseDate(snap.meta.to);
  if (acc.anchorTime < to) throw new Error("anchor is earlier than the period end; refetch");

  const markPx = priceSource(acc, "1d");
  const intraday = bestPrice(acc);

  // Forward pass from the period start.
  const h = holdingsAt(acc, from);
  const times = marksFor(from, to);
  const marks: Mark[] = [];
  const flows: Flow[] = [];
  const flowTotals: Record<FlowKind, Decimal> = { deposit: ZERO, withdraw: ZERO, transferIn: ZERO, transferOut: ZERO, vault: ZERO, staking: ZERO, nonTrading: ZERO, other: ZERO };
  let fees = ZERO;
  let notional = ZERO;
  let funding = ZERO;
  let nFills = 0;
  let nFunding = 0;
  let nLedger = 0;
  const positions = checkPositions(acc, from);

  let i = acc.events.findIndex((e) => e.time >= from);
  if (i < 0) i = acc.events.length;
  for (const t of times) {
    while (i < acc.events.length && acc.events[i]!.time < t) {
      const e = acc.events[i]!;
      if (e.kind === "fill") {
        nFills++;
        const qPx = intraday.tokenPrice(e.quote, e.time);
        notional = notional.plus(e.signedSz.abs().times(e.px).times(qPx));
        const feeUsd = e.feeToken === e.quote ? e.fee.times(qPx) : e.feeToken === e.base && e.spot ? e.fee.times(e.px).times(qPx) : e.fee.times(intraday.tokenPrice(e.feeToken, e.time));
        fees = fees.plus(feeUsd);
      } else if (e.kind === "funding") {
        nFunding++;
        funding = funding.plus(e.usdc.times(intraday.tokenPrice(e.token, e.time)));
      } else {
        nLedger++;
        if (e.flow) {
          const v = flowUsd(e, intraday);
          flows.push({ time: e.time, usd: v });
          flowTotals[e.flow.kind] = flowTotals[e.flow.kind].plus(v);
        }
      }
      applyEvent(h, e, 1);
      i++;
    }
    marks.push({ time: t, equity: equityOf(h, t, markPx) });
  }

  const days = dailyReturns(marks, flows);
  const rets = days.map((x) => x.ret);
  const observed = rets.filter((r): r is Decimal => r !== null);
  const startEquity = marks[0]!.equity;
  const endEquity = marks[marks.length - 1]!.equity;
  const avgEquity = sum(marks.map((m) => m.equity)).div(marks.length);
  const netFlows = sum(flows.map((f) => f.usd));
  const nDays = (to - from) / DAY_MS;

  return {
    address: acc.address,
    period: { from: snap.meta.from, to: snap.meta.to, days: nDays },
    methodology: METHODOLOGY_VERSION,
    accountMode: acc.mode,
    equity: { start: usd(startEquity), end: usd(endEquity), averageDaily: usd(avgEquity) },
    pnlNet: usd(endEquity.minus(startEquity).minus(netFlows)),
    twrNet: ratio(chain(rets)),
    maxDrawdown: ratio(maxDrawdown(rets)),
    sharpe: ratio(sharpe(observed)),
    sortino: ratio(sortino(observed)),
    feesPaid: { usd: usd(fees), shareOfStartEquity: share(fees, startEquity) },
    fundingNet: { usd: usd(funding), shareOfStartEquity: share(funding, startEquity) },
    notionalTraded: usd(notional),
    turnover: avgEquity.gt(0) ? ratio(notional.div(avgEquity)) : null,
    nonTradingIncome: { usd: usd(flowTotals.nonTrading) },
    externalFlows: {
      deposits: usd(flowTotals.deposit),
      withdrawals: usd(flowTotals.withdraw),
      transfersIn: usd(flowTotals.transferIn),
      transfersOut: usd(flowTotals.transferOut),
      vault: usd(flowTotals.vault),
      staking: usd(flowTotals.staking),
      nonTrading: usd(flowTotals.nonTrading),
      other: usd(flowTotals.other),
      net: usd(netFlows),
    },
    operatorCohort: null,
    meetsMinimums: nDays >= 30 && avgEquity.gte(1000),
    observations: observed.length,
    daily: days.map((x) => ({
      date: isoDate(x.start),
      startEquity: usd(x.startEquity),
      endEquity: usd(x.endEquity),
      flows: usd(x.flows),
      return: ratio(x.ret),
    })),
    integrity: {
      fills: nFills,
      fundingEvents: nFunding,
      ledgerEvents: nLedger,
      positionChecks: positions.checks,
      positionDust: positions.dust,
      positionMaxDust: fixed(positions.maxDust, 12),
      staleMarks: markPx.staleness,
    },
  };
}
