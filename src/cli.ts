import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fetchSnapshot } from "./indexer.js";
import { loadSnapshot } from "./snapshot.js";
import { score } from "./score.js";
import { buildManifest } from "./manifest.js";
import { canonicalJson } from "./canonical.js";
import { renderReport } from "./report.js";
import { verify } from "./verify.js";

const USAGE = `usage:
  attestor fetch <address> --from YYYY-MM-DD --to YYYY-MM-DD [--out data/raw]
  attestor score <snapshot-dir>
  attestor verify <manifest.json>
  attestor report <metrics.json>`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

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

async function main(argv: string[]): Promise<number> {
  const [cmd, target, ...rest] = argv;
  const args = [target ?? "", ...rest];
  switch (cmd) {
    case "fetch": {
      const from = flag(args, "--from");
      const to = flag(args, "--to");
      if (!target || !from || !to) break;
      const dir = await fetchSnapshot({ address: target, from, to, outRoot: flag(args, "--out"), log: (s) => console.error(s) });
      console.log(dir);
      return 0;
    }
    case "score": {
      if (!target) break;
      const r = scoreDir(target);
      console.log(`${r.metricsPath}\n${r.manifestPath}\nmetricsHash ${r.metricsHash}`);
      return 0;
    }
    case "verify": {
      if (!target) break;
      return (await verify(target, (s) => console.error(s))) ? 0 : 1;
    }
    case "report": {
      if (!target) break;
      process.stdout.write(renderReport(JSON.parse(readFileSync(target, "utf8"))));
      return 0;
    }
  }
  console.error(USAGE);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
