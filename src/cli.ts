import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fetchSnapshot } from "./indexer.js";
import { scoreDir } from "./score-dir.js";
import { renderReport } from "./report.js";
import { verify } from "./verify.js";

const USAGE = `usage:
  pnl-replay fetch <address> --from YYYY-MM-DD --to YYYY-MM-DD [--out data/raw]
  pnl-replay score <snapshot-dir>
  pnl-replay verify <manifest.json>
  pnl-replay report <metrics.json>`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
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
      const manifestPath = join(dirname(target), "manifest.json");
      const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : undefined;
      process.stdout.write(renderReport(JSON.parse(readFileSync(target, "utf8")), manifest));
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
