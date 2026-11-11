# agent-attestor

**A trading bot's track record, recomputed from public data. Same inputs, same hash, on any machine.**

Every trading bot has a PnL screenshot. Almost none have a record you can check. agent-attestor rebuilds a Hyperliquid account's performance trade by trade from Hyperliquid's public API, so anyone can rerun it and get byte-identical numbers.

No keys. No signing. No orders. It only reads.

## The Alpha Arena bots, rescored

Six AI models traded real money on Hyperliquid in [Alpha Arena](https://nof1.ai) Season 1. Here's what their accounts did over the season (Oct 18 to Nov 4, 2025, marks at 00:00 UTC), recomputed from scratch:

| Bot | Return (TWR, net) | Max drawdown | Fees paid | Turnover |
|---|---|---|---|---|
| Qwen3 Max | +27.82% | 40.45% | $1,603 | 327x |
| DeepSeek V3.1 | +12.03% | 49.93% | $640 | 134x |
| Claude Sonnet 4.5 | -30.50% | 45.00% | $571 | 157x |
| Grok 4 | -43.89% | 57.60% | $350 | 106x |
| Gemini 2.5 Pro | -60.75% | 75.08% | $1,256 | 639x |
| GPT-5 | -65.97% | 77.81% | $512 | 333x |

Wallet addresses come from two public GitHub repos, not from nof1, so treat the mapping as unconfirmed. Full results, including 15 Hyperliquid leaderboard wallets, are in [`docs/wallets.md`](docs/wallets.md).

## What a report card looks like

```
AGENT ATTESTOR REPORT CARD (Phase 0, unbound)
----------------------------------------------------------------
Account               0x67293d914eafb26878534571add81f6bd2d9fe06
Period                2025-10-18 to 2025-11-04 (17 days, marks at 00:00 UTC)

Return (TWR, net)     -65.97%
PnL (net)             -$7,200.48
Max drawdown          77.81%
Fees paid             $512.45 (4.71% of start)
Turnover              333.4x avg equity ($1,449,097.76 traded)
Non-trading income    $0.00 (excluded from return)

Meets minimums        no (needs 30+ days and avg equity >= $1,000)
Fill position checks  760 matched HL
Funding size checks   728 hours matched HL
Method                phase0-v7
----------------------------------------------------------------
```

That's GPT-5, trimmed. `attestor report` prints the full card.

## Why you can trust the numbers (or check them)

- **Deterministic.** The scorer is a pure function. Sorted keys, fixed decimals, no timestamps, no floats in money math. Two clean checkouts give the same metrics hash.
- **Checked against Hyperliquid.** Across 21 wallets, the replay matched Hyperliquid's own PnL on 15. The other 6 are listed with their causes: vault and staking money that Hyperliquid counts and the scorer doesn't, one 1-cent rounding miss, and 2 accounts it can't score yet.
- **Refuses instead of guessing.** Unknown ledger entries, unsupported account modes and unpriceable tokens stop the run with a reason. Every known approximation is written up in [`docs/methodology.md`](docs/methodology.md).
- **Reproducible end to end.** `verify` refetches the data, rescores it and prints `MATCH` or a field-level diff. The last live run was 19 of 19 `MATCH`.

## Quick start

Node 20+ and pnpm.

```sh
pnpm install

# 1. snapshot an account's public data (raw responses + sha256 per file)
pnpm attestor fetch 0x67293d914eafb26878534571add81f6bd2d9fe06 --from 2025-10-18 --to 2025-11-04

# 2. score it (writes metrics.json and manifest.json)
pnpm attestor score data/raw/0x67293d914eafb26878534571add81f6bd2d9fe06/2025-10-18_2025-11-04

# 3. print the report card
pnpm attestor report data/raw/0x67293d914eafb26878534571add81f6bd2d9fe06/2025-10-18_2025-11-04/score/metrics.json

# 4. refetch, rescore and compare
pnpm attestor verify data/raw/0x67293d914eafb26878534571add81f6bd2d9fe06/2025-10-18_2025-11-04/score/manifest.json
```

## What it measures

Time-weighted return net of fees and funding, max drawdown, Sharpe and Sortino (null under 30 daily returns), fees, funding, turnover, and non-trading income (rewards, rebates, referrals) reported separately so it can't pad the return. Definitions and edge cases: [`docs/methodology.md`](docs/methodology.md).

## Known limits

- **No account value at a chosen time.** Hyperliquid's API doesn't serve it, so the scorer replays every fill and prices holdings from candle closes. Section 3 of the methodology covers the error this adds.
- **Fill history may be capped.** Hyperliquid documents a 10,000-fill limit. It wasn't enforced in testing, but very active accounts are at risk.
- **No counterparty addresses.** Fills don't expose them, so wash trading can't be detected from fills alone.
- **Hyperliquid only.** Vault equity, staked HYPE and borrow/lend are outside the trading account and handled as described in the docs.

API findings: [`docs/hyperliquid-api.md`](docs/hyperliquid-api.md).

## What's next

Phase 0 proves the numbers. Phase 1 answers whose numbers they are: an operator links a Hyperliquid account to an [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) agent onchain, and scoring starts from that block, so nobody can pick their best account after the fact. Draft: [`docs/phase1-spec.md`](docs/phase1-spec.md).

If you run a trading bot and want a card for it, open an issue.

## License

MIT
