export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export function parseDate(s: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`date must be YYYY-MM-DD: ${s}`);
  const t = Date.parse(s + "T00:00:00Z");
  if (Number.isNaN(t)) throw new Error(`bad date: ${s}`);
  return t;
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
