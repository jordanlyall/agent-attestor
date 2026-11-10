import { Decimal as DecimalBase } from "decimal.js";

// One configured Decimal for all money and return math. Never use JS floats for these.
export const Decimal = DecimalBase.clone({ precision: 60, rounding: DecimalBase.ROUND_HALF_EVEN, toExpNeg: -100, toExpPos: 100 });
export type Decimal = InstanceType<typeof Decimal>;

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

export function d(x: string | number | Decimal): Decimal {
  if (typeof x === "number" && !Number.isInteger(x)) throw new Error(`float passed to d(): ${x}`);
  return new Decimal(x);
}

export function sum(xs: Decimal[]): Decimal {
  return xs.reduce((a, b) => a.plus(b), ZERO);
}

// Fixed-place string output, half-even. Negative zero prints as zero.
export function fixed(x: Decimal, places: number): string {
  const s = x.toDecimalPlaces(places, Decimal.ROUND_HALF_EVEN).toFixed(places);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}
