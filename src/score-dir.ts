import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadSnapshot } from "./snapshot.js";
import { score } from "./score.js";
import { buildManifest } from "./manifest.js";
import { canonicalJson } from "./canonical.js";

// Writes <snapshot-dir>/score/metrics.json and manifest.json.
export function scoreDir(dir: string): { metricsPath: string; manifestPath: string; metricsHash: string } {
  const { snapshot, hashes } = loadSnapshot(dir);
  const metrics = score(snapshot);
  const metricsText = canonicalJson(metrics);
  const outDir = join(dir, "score");
  mkdirSync(outDir, { recursive: true });
  const manifest = buildManifest(snapshot, hashes, metricsText);
  const metricsPath = join(outDir, "metrics.json");
  const manifestPath = join(outDir, "manifest.json");
  writeFileSync(metricsPath, metricsText);
  writeFileSync(manifestPath, canonicalJson(manifest));
  return { metricsPath, manifestPath, metricsHash: manifest.metricsHash };
}
