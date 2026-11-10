// Fetch, score and compare every wallet in scripts/wallets.json. Writes docs/wallet-results.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchSnapshot } from "../src/indexer.js";
import { scoreDir } from "../src/score-dir.js";
import { compare } from "./compare-hl.js";
import { canonicalJson } from "../src/canonical.js";

interface W { address: string; label: string; source: string; from: string; to: string }
const list = JSON.parse(readFileSync("scripts/wallets.json", "utf8")) as W[];
const only = process.argv[2];
const outPath = "docs/wallet-results.json";
const prior: Record<string, unknown>[] = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : [];
const results = new Map(prior.map((r: any) => [r.address, r]));

for (const w of list) {
  if (only && !w.address.startsWith(only)) continue;
  const dir = join("data/raw", w.address, `${w.from}_${w.to}`);
  const row: Record<string, unknown> = { ...w };
  try {
    if (!existsSync(join(dir, "SHA256SUMS"))) await fetchSnapshot({ address: w.address, from: w.from, to: w.to, log: (s) => console.error(`  ${w.address.slice(0, 10)} ${s}`) });
    const s = scoreDir(dir);
    row.metricsHash = s.metricsHash;
    row.metrics = JSON.parse(readFileSync(s.metricsPath, "utf8"));
    delete (row.metrics as any).daily;
    row.compare = compare(dir);
  } catch (e) {
    row.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  results.set(w.address, row);
  console.error(`${w.address} ${row.error ? "ERROR " + row.error : (row.compare as any).pass ? "PASS" : "MISS"}`);
  writeFileSync(outPath, canonicalJson(list.map((x) => results.get(x.address)).filter(Boolean)));
}
