// Deterministic JSON: sorted keys, 2-space indent, LF, trailing newline.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x === undefined) continue;
      if (typeof x === "number" && !Number.isInteger(x)) throw new Error(`non-integer number at key ${k}; use a fixed decimal string`);
      out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}
