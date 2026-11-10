// attestor fetch: snapshot one account's public data for a period, raw and unchanged.
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { InfoClient, type InfoResponse } from "./hl/client.js";
import { sha256 } from "./hash.js";
import { DAY_MS, HOUR_MS, isoDate, parseDate } from "./time.js";
import { canonicalJson } from "./canonical.js";

export const SNAPSHOT_FORMAT = 1;
const RACE_WINDOW_MS = 5_000;
const CANDLE_LIMIT = 5000;

export interface RequestRecord {
  file: string;
  body: Record<string, unknown>;
}

export interface SnapshotMeta {
  format: number;
  address: string;
  from: string;
  to: string;
  fetchedAt: string;
  requests: RequestRecord[];
}

export function normalizeAddress(a: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`not an address: ${a}`);
  return a.toLowerCase();
}

export function safeName(coin: string): string {
  return coin.replace(/[^A-Za-z0-9._-]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}

type Saved = { file: string; resp: InfoResponse };

class Stream {
  pages: Saved[] = [];
  private seen = new Set<string>();
  private next: number;
  constructor(private client: InfoClient, private type: string, private user: string, start: number) {
    this.next = start;
  }
  // Pull pages until the API returns nothing new.
  async drain(): Promise<void> {
    for (;;) {
      const resp = await this.client.post({ type: this.type, user: this.user, startTime: this.next });
      const rows = JSON.parse(resp.text) as { time: number }[];
      this.pages.push({ file: `${this.type}/${String(this.pages.length + 1).padStart(4, "0")}.json`, resp });
      let fresh = 0;
      let maxT = this.next;
      for (const r of rows) {
        const k = JSON.stringify(r);
        if (!this.seen.has(k)) {
          this.seen.add(k);
          fresh++;
        }
        if (r.time > maxT) maxT = r.time;
      }
      if (fresh === 0) return;
      this.next = maxT;
    }
  }
  timesNear(t: number, w: number): boolean {
    for (const k of this.seen) {
      const r = JSON.parse(k) as { time: number };
      if (Math.abs(r.time - t) <= w) return true;
    }
    return false;
  }
  rows(): any[] {
    return [...this.seen].map((k) => JSON.parse(k));
  }
}

export interface FetchOptions {
  address: string;
  from: string;
  to: string;
  outRoot?: string;
  log?: (s: string) => void;
}

export async function fetchSnapshot(opts: FetchOptions): Promise<string> {
  const log = opts.log ?? (() => {});
  const user = normalizeAddress(opts.address);
  const fromMs = parseDate(opts.from);
  const toMs = parseDate(opts.to);
  if (toMs <= fromMs) throw new Error("--to must be after --from");
  if (toMs > Date.now()) throw new Error("--to must not be in the future (the last daily mark must have passed)");
  const dir = join(opts.outRoot ?? "data/raw", user, `${opts.from}_${opts.to}`);
  const client = new InfoClient();
  const saved: Saved[] = [];
  const save = (file: string, resp: InfoResponse) => saved.push({ file, resp });

  log(`static metadata`);
  const perpDexsResp = await client.post({ type: "perpDexs" });
  save("perpDexs.json", perpDexsResp);
  save("spotMeta.json", await client.post({ type: "spotMeta" }));
  const dexes = (JSON.parse(perpDexsResp.text) as ({ name: string } | null)[]).map((x) => (x ? x.name : ""));
  for (const dex of dexes) save(`meta/${dex ? safeName(dex) : "_default"}.json`, await client.post({ type: "meta", dex }));

  log(`events since ${opts.from}`);
  const streams = ["userFillsByTime", "userFunding", "userNonFundingLedgerUpdates"].map((t) => new Stream(client, t, user, fromMs));
  for (const s of streams) await s.drain();

  // Anchor: current account state. Events are walked back from here, so the anchor and the
  // event streams must agree. Retry until no event lands near the anchor time.
  let anchor: Saved[] = [];
  for (let attempt = 1; ; attempt++) {
    log(`anchor attempt ${attempt}`);
    const reqs: [string, Record<string, unknown>][] = [
      ["userAbstraction.json", { type: "userAbstraction", user }],
      ["spotClearinghouseState.json", { type: "spotClearinghouseState", user }],
      ...dexes.map((dex): [string, Record<string, unknown>] => [`clearinghouseState/${dex ? safeName(dex) : "_default"}.json`, { type: "clearinghouseState", user, dex }]),
      ["portfolio.json", { type: "portfolio", user }],
      ["userVaultEquities.json", { type: "userVaultEquities", user }],
      ["delegatorSummary.json", { type: "delegatorSummary", user }],
    ];
    const resps = await Promise.all(reqs.map(([, b]) => client.post(b)));
    anchor = reqs.map(([file], i) => ({ file, resp: resps[i]! }));
    for (const s of streams) await s.drain();
    const def = anchor.find((a) => a.file === "clearinghouseState/_default.json")!;
    const anchorTime = (JSON.parse(def.resp.text) as { time: number }).time;
    const racing = streams.some((s) => s.timesNear(anchorTime, RACE_WINDOW_MS));
    if (!racing) break;
    if (attempt >= 6) throw new Error("account kept trading across the anchor time; retry later");
    await new Promise((r) => setTimeout(r, 5_000));
  }
  for (const a of anchor) saved.push(a);
  for (const s of streams) saved.push(...s.pages);

  // Prices: candles for every coin traded or held, plus each held token's USDC pair.
  const spotMeta = JSON.parse(saved.find((x) => x.file === "spotMeta.json")!.resp.text) as SpotMetaRaw;
  const coins = new Set<string>();
  const [fills, funding, ledger] = streams.map((s) => s.rows());
  for (const f of fills!) coins.add(f.coin);
  for (const f of funding!) coins.add(f.delta.coin);
  for (const a of anchor) {
    if (a.file.startsWith("clearinghouseState/")) for (const p of JSON.parse(a.resp.text).assetPositions) coins.add(p.position.coin);
  }
  const tokens = new Set<string>();
  const spotState = JSON.parse(anchor.find((a) => a.file === "spotClearinghouseState.json")!.resp.text);
  for (const b of spotState.balances) tokens.add(b.coin);
  for (const l of ledger!) if (typeof l.delta.token === "string") tokens.add(l.delta.token);
  for (const c of [...coins]) {
    const pair = spotMeta.universe.find((u) => u.name === c);
    if (pair) for (const ti of pair.tokens) tokens.add(spotMeta.tokens.find((t) => t.index === ti)!.name);
  }
  for (const t of tokens) {
    if (t === "USDC") continue;
    const pair = usdcPair(spotMeta, t);
    if (pair) coins.add(pair);
  }
  const now = Date.now();
  log(`candles for ${coins.size} coins`);
  for (const coin of [...coins].sort()) {
    const d1 = { type: "candleSnapshot", req: { coin, interval: "1d", startTime: fromMs - 10 * DAY_MS, endTime: toMs } };
    save(`candles/1d/${safeName(coin)}.json`, await client.post(d1));
    const h1Start = Math.max(fromMs - DAY_MS, now - (CANDLE_LIMIT - 10) * HOUR_MS);
    const h1 = { type: "candleSnapshot", req: { coin, interval: "1h", startTime: h1Start, endTime: now } };
    save(`candles/1h/${safeName(coin)}.json`, await client.post(h1));
  }

  if (existsSync(dir)) rmSync(dir, { recursive: true });
  const meta: SnapshotMeta = {
    format: SNAPSHOT_FORMAT,
    address: user,
    from: opts.from,
    to: opts.to,
    fetchedAt: new Date(now).toISOString(),
    requests: saved.map((s) => ({ file: s.file, body: s.resp.body })),
  };
  const files: [string, string][] = saved.map((s) => [s.file, s.resp.text]);
  files.push(["requests.json", canonicalJson(meta)]);
  const sums: string[] = [];
  for (const [file, text] of files) {
    const p = join(dir, file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  for (const [file, text] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) sums.push(`${sha256(text)}  ${file}`);
  writeFileSync(join(dir, "SHA256SUMS"), sums.join("\n") + "\n");
  log(`wrote ${files.length} files to ${dir}`);
  return dir;
}

export interface SpotMetaRaw {
  tokens: { name: string; index: number }[];
  universe: { name: string; tokens: [number, number]; index: number }[];
}

export function usdcPair(meta: SpotMetaRaw, token: string): string | undefined {
  const t = meta.tokens.find((x) => x.name === token);
  if (!t) return undefined;
  return meta.universe.find((u) => u.tokens[0] === t.index && u.tokens[1] === 0)?.name;
}

export { isoDate };
