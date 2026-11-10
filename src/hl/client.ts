// Read-only client for the public Hyperliquid info endpoint. No keys, no signing, no writes.
export const INFO_URL = "https://api.hyperliquid.xyz/info";

const BUDGET_PER_MIN = 1200; // per IP, shared across REST requests
const SAFETY = 0.6; // stay well under the limit

// Base weights from the rate limit docs.
const LIGHT = new Set(["l2Book", "allMids", "clearinghouseState", "orderStatus", "spotClearinghouseState", "exchangeStatus"]);
const PER20 = new Set(["userFills", "userFillsByTime", "userFunding", "historicalOrders", "fundingHistory", "userTwapSliceFills", "userTwapSliceFillsByTime"]);

export interface InfoResponse {
  body: Record<string, unknown>;
  text: string; // raw response bytes as received
}

export class InfoClient {
  private log: { t: number; w: number }[] = [];

  constructor(private url = INFO_URL) {}

  private weight(type: string, items: number): number {
    let w = LIGHT.has(type) ? 2 : type === "userRole" ? 60 : 20;
    if (PER20.has(type)) w += Math.floor(items / 20);
    if (type === "candleSnapshot") w += Math.floor(items / 60);
    return w;
  }

  private async throttle(expected: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.log = this.log.filter((x) => now - x.t < 60_000);
      const used = this.log.reduce((a, x) => a + x.w, 0);
      if (used + expected <= BUDGET_PER_MIN * SAFETY) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async post(body: Record<string, unknown>): Promise<InfoResponse> {
    const type = String(body.type);
    await this.throttle(this.weight(type, 0));
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await res.text();
      if (res.ok) {
        let items = 0;
        try {
          const j = JSON.parse(text);
          if (Array.isArray(j)) items = j.length;
        } catch {
          throw new Error(`non-JSON response for ${type}: ${text.slice(0, 200)}`);
        }
        this.log.push({ t: Date.now(), w: this.weight(type, items) });
        return { body, text };
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 6) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      throw new Error(`HTTP ${res.status} for ${type}: ${text.slice(0, 200)}`);
    }
  }
}
