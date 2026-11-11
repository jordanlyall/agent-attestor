// pnl-replay verify: refetch the same account and period, rescore, and diff against the manifest.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fetchSnapshot } from "./indexer.js";
import { loadSnapshot } from "./snapshot.js";
import { score } from "./score.js";
import { canonicalJson } from "./canonical.js";
import { sha256 } from "./hash.js";
import { scorerCommit, type Manifest } from "./manifest.js";

export function flatten(v: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (v && typeof v === "object") {
    const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v as object);
    if (entries.length === 0) out[prefix] = JSON.stringify(v);
    for (const [k, x] of entries) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = JSON.stringify(v);
  return out;
}

export function diffMetrics(a: unknown, b: unknown): string[] {
  const fa = flatten(a);
  const fb = flatten(b);
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
  return keys.filter((k) => fa[k] !== fb[k]).map((k) => `${k}: ${fa[k] ?? "(absent)"} -> ${fb[k] ?? "(absent)"}`);
}

export async function verify(manifestPath: string, log: (s: string) => void): Promise<boolean> {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const metricsText = readFileSync(join(dirname(manifestPath), "metrics.json"), "utf8");
  if (sha256(metricsText) !== manifest.metricsHash) {
    console.log("MISMATCH\nmetrics.json does not match manifest.metricsHash");
    return false;
  }
  const now = scorerCommit();
  if (now.commit !== manifest.scorer.commit || now.dirty) log(`note: scorer is ${now.commit}${now.dirty ? " (dirty)" : ""}, manifest was ${manifest.scorer.commit}`);
  const tmp = mkdtempSync(join(tmpdir(), "pnl-replay-verify-"));
  try {
    const dir = await fetchSnapshot({ address: manifest.address, from: manifest.period.from, to: manifest.period.to, outRoot: tmp, log });
    const { snapshot, hashes } = loadSnapshot(dir);
    const fresh = canonicalJson(score(snapshot));
    const changed = Object.keys({ ...hashes, ...manifest.inputs }).filter((k) => hashes[k] !== manifest.inputs[k]).length;
    log(`refetched ${Object.keys(hashes).length} files; ${changed} differ from the manifest (expected: the anchor and later events move)`);
    if (sha256(fresh) === manifest.metricsHash) {
      console.log(`MATCH ${manifest.metricsHash}`);
      return true;
    }
    console.log("MISMATCH");
    for (const line of diffMetrics(JSON.parse(metricsText), JSON.parse(fresh))) console.log(`  ${line}`);
    return false;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
