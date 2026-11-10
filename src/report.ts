// attestor report: a plain-text report card from metrics.json. Display only; floats are fine here.
const pct = (x: string | null) => (x === null ? "n/a" : `${(Number(x) * 100).toFixed(2)}%`);
const usd = (x: string) => {
  const n = Number(x);
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}$${s}`;
};
const num = (x: string | null) => (x === null ? "n/a (fewer than 30 daily returns)" : Number(x).toFixed(2));

export function renderReport(m: any): string {
  const rows: [string, string][] = [
    ["Account", m.address],
    ["Period", `${m.period.from} to ${m.period.to} (${m.period.days} days, marks at 00:00 UTC)`],
    ["Account mode", m.accountMode],
    ["", ""],
    ["Return (TWR, net)", pct(m.twrNet)],
    ["PnL (net)", usd(m.pnlNet)],
    ["Max drawdown", pct(m.maxDrawdown)],
    ["Sharpe (ann.)", num(m.sharpe)],
    ["Sortino (ann.)", num(m.sortino)],
    ["", ""],
    ["Start equity", usd(m.equity.start)],
    ["End equity", usd(m.equity.end)],
    ["Avg daily equity", usd(m.equity.averageDaily)],
    ["Fees paid", `${usd(m.feesPaid.usd)} (${pct(m.feesPaid.shareOfStartEquity)} of start)`],
    ["Funding (net)", `${usd(m.fundingNet.usd)} (${pct(m.fundingNet.shareOfStartEquity)} of start)`],
    ["Turnover", m.turnover === null ? "n/a" : `${Number(m.turnover).toFixed(1)}x avg equity (${usd(m.notionalTraded)} traded)`],
    ["Non-trading income", `${usd(m.nonTradingIncome.usd)} (excluded from return)`],
    ["Net external flows", usd(m.externalFlows.net)],
    ["", ""],
    ["Operator cohort", m.operatorCohort ?? "n/a (needs binding, Phase 1)"],
    ["Meets minimums", m.meetsMinimums ? "yes (30+ days, avg equity >= $1,000)" : "no (needs 30+ days and avg equity >= $1,000)"],
    ["Daily returns", String(m.observations)],
    ["Fill position checks", `${m.integrity.positionChecks} matched HL${m.integrity.positionDust ? ` (${m.integrity.positionDust} within dust, max ${m.integrity.positionMaxDust})` : ""}`],
    ["Method", m.methodology],
  ];
  const w = Math.max(...rows.map(([k]) => k.length));
  const line = "-".repeat(64);
  return [
    "AGENT ATTESTOR REPORT CARD (Phase 0, unbound)",
    line,
    ...rows.map(([k, v]) => (k ? `${k.padEnd(w)}  ${v}` : "")),
    line,
    "Recomputed from public Hyperliquid data. Prices at marks are candle closes, not HL mark prices.",
    "",
  ].join("\n");
}
