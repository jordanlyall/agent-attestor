// Load a snapshot directory and check every file against SHA256SUMS. IO lives here; scoring is pure.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./hash.js";
import type { SnapshotMeta } from "./indexer.js";

export interface Snapshot {
  meta: SnapshotMeta;
  files: Record<string, string>; // raw response text by relative path
}

export function loadSnapshot(dir: string): { snapshot: Snapshot; hashes: Record<string, string> } {
  const sums = readFileSync(join(dir, "SHA256SUMS"), "utf8").trim().split("\n");
  const hashes: Record<string, string> = {};
  const files: Record<string, string> = {};
  for (const line of sums) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!m) throw new Error(`bad SHA256SUMS line: ${line}`);
    const [, h, file] = m as unknown as [string, string, string];
    const text = readFileSync(join(dir, file), "utf8");
    if (sha256(text) !== h) throw new Error(`hash mismatch: ${file}`);
    hashes[file] = h;
    files[file] = text;
  }
  const metaText = files["requests.json"];
  if (!metaText) throw new Error("snapshot has no requests.json");
  const meta = JSON.parse(metaText) as SnapshotMeta;
  for (const r of meta.requests) if (!(r.file in files)) throw new Error(`missing file listed in requests.json: ${r.file}`);
  delete files["requests.json"];
  return { snapshot: { meta, files }, hashes };
}
