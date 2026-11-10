import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./hash.js";
import type { Snapshot } from "./snapshot.js";
import { METHODOLOGY_VERSION } from "./score.js";

export interface Manifest {
  address: string;
  period: { from: string; to: string };
  scorer: { commit: string; dirty: boolean; methodology: string };
  inputs: Record<string, string>;
  metricsHash: string;
}

function git(cmd: string): string {
  const cwd = dirname(fileURLToPath(import.meta.url));
  try {
    return execSync(`git ${cmd}`, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

export function scorerCommit(): { commit: string; dirty: boolean } {
  const commit = git("rev-parse HEAD") || "unknown";
  // Only scorer sources count; data and docs do not change the output.
  const dirty = git("status --porcelain -- src package.json pnpm-lock.yaml") !== "";
  return { commit, dirty };
}

export function buildManifest(snap: Snapshot, hashes: Record<string, string>, metricsText: string): Manifest {
  const inputs: Record<string, string> = {};
  for (const k of Object.keys(hashes).sort()) inputs[k] = hashes[k]!;
  return {
    address: snap.meta.address,
    period: { from: snap.meta.from, to: snap.meta.to },
    scorer: { ...scorerCommit(), methodology: METHODOLOGY_VERSION },
    inputs,
    metricsHash: sha256(metricsText),
  };
}
