// Pure return math on a daily equity series. No IO, no floats.
import { Decimal, ONE, ZERO, sum } from "./decimal.js";
import { DAY_MS } from "./time.js";

export interface Mark {
  time: number; // 00:00 UTC
  equity: Decimal;
  exposure: Decimal; // gross value of non-USDC holdings and perp notional
}

export interface Flow {
  time: number;
  usd: Decimal; // + into the account, - out of it
  before: Decimal; // account value just before the flow
  after: Decimal; // account value just after it
  exposureAfter: Decimal; // gross exposure just after it
}

export interface DayReturn {
  start: number;
  end: number;
  startEquity: Decimal;
  endEquity: Decimal;
  flows: Decimal;
  ret: Decimal | null; // null: no capital at risk that day
}

// A piece is skipped only when the account is flat: equity and gross exposure both below this.
// Returns on dust (an account swept to $0.000001 overnight) are noise, not performance. An account
// with open positions is never skipped, however small its equity.
export const MIN_CAPITAL = new Decimal(1);

export class InvalidReturnError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "UnsupportedError";
  }
}

// True time-weighted return within each day. The day is cut at every external flow; each piece
// runs from the value just after one flow (or the 00:00 mark) to the value just before the next
// (or the next mark). The pieces are chained, so the size and timing of flows do not move the
// return. A flow belongs to the day [start, end) that contains it.
//   r_day = prod(end_k / start_k) - 1, over pieces with start_k >= MIN_CAPITAL
export function dailyReturns(marks: Mark[], flows: Flow[]): DayReturn[] {
  const out: DayReturn[] = [];
  const sorted = [...flows].sort((a, b) => a.time - b.time);
  let j = 0;
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i]!;
    const b = marks[i + 1]!;
    while (j < sorted.length && sorted[j]!.time < a.time) j++;
    let f = ZERO;
    let growth = ONE;
    let pieces = 0;
    let startValue = a.equity;
    let startExposure = a.exposure;
    const piece = (endValue: Decimal, at: number) => {
      if (startValue.lt(MIN_CAPITAL) && startExposure.lt(MIN_CAPITAL)) return; // flat: nothing at risk
      if (startValue.lte(0)) throw new InvalidReturnError(`equity ${startValue.toString()} with open positions at ${new Date(at).toISOString()}: return undefined`);
      // A loss beyond the whole account is -100%, never a sign flip.
      growth = growth.times(Decimal.max(endValue, ZERO).div(startValue));
      pieces++;
    };
    while (j < sorted.length && sorted[j]!.time < b.time) {
      const x = sorted[j]!;
      piece(x.before, x.time);
      f = f.plus(x.usd);
      startValue = x.after;
      startExposure = x.exposureAfter;
      j++;
    }
    piece(b.equity, b.time);
    out.push({ start: a.time, end: b.time, startEquity: a.equity, endEquity: b.equity, flows: f, ret: pieces === 0 ? null : growth.minus(ONE) });
  }
  return out;
}

export function chain(rets: (Decimal | null)[]): Decimal {
  return rets.reduce<Decimal>((acc, r) => (r === null ? acc : acc.times(ONE.plus(r))), ONE).minus(ONE);
}

// Largest peak-to-trough fall of the return index, as a positive fraction.
export function maxDrawdown(rets: (Decimal | null)[]): Decimal {
  let idx = ONE;
  let peak = ONE;
  let worst = ZERO;
  for (const r of rets) {
    if (r !== null) idx = idx.times(ONE.plus(r));
    if (idx.gt(peak)) peak = idx;
    const dd = peak.minus(idx).div(peak);
    if (dd.gt(worst)) worst = dd;
  }
  return worst;
}

export const MIN_OBS = 30;
const ANNUAL = new Decimal(365).sqrt();

// Sharpe: mean / sample stdev of daily returns, times sqrt(365). Risk-free rate 0.
export function sharpe(rets: Decimal[]): Decimal | null {
  const n = rets.length;
  if (n < MIN_OBS) return null;
  const mean = sum(rets).div(n);
  const variance = sum(rets.map((r) => r.minus(mean).pow(2))).div(n - 1);
  if (variance.isZero()) return null;
  return mean.div(variance.sqrt()).times(ANNUAL);
}

// Fewer real losing days than this and the downside deviation is too thin to divide by: a
// near-flat account with a few cents of funding loss would make Sortino explode. A day counts as
// a real loss at -0.01% (1 basis point) or worse; smaller dips are noise.
export const MIN_DOWN_DAYS = 5;
export const MATERIAL_LOSS = new Decimal("-0.0001");

// Sortino: mean / downside deviation, times sqrt(365). Downside deviation uses a 0 target
// and divides by all n observations. Null below MIN_OBS days or MIN_DOWN_DAYS real losing days.
export function sortino(rets: Decimal[]): Decimal | null {
  const n = rets.length;
  if (n < MIN_OBS) return null;
  if (rets.filter((r) => r.lte(MATERIAL_LOSS)).length < MIN_DOWN_DAYS) return null;
  const mean = sum(rets).div(n);
  const dd = sum(rets.map((r) => (r.isNeg() ? r.pow(2) : ZERO))).div(n);
  if (dd.isZero()) return null;
  return mean.div(dd.sqrt()).times(ANNUAL);
}

export function marksFor(from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = from; t <= to; t += DAY_MS) out.push(t);
  return out;
}
