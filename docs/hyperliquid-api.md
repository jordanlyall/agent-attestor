# Hyperliquid info API: findings

Checked 2026-11-09/10 against the official docs
(`hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint`, the perpetuals and
rate-limit pages) and by probing `POST https://api.hyperliquid.xyz/info` directly. Where the docs
and the live API disagree, both are noted. "Observed" means seen on real wallets, not promised.

## Request types the attestor uses

| type | body | used for |
|---|---|---|
| `userFillsByTime` | `{user, startTime, endTime?, aggregateByTime?}` | every fill, perp and spot |
| `userFunding` | `{user, startTime, endTime?}` | funding payments |
| `userNonFundingLedgerUpdates` | `{user, startTime, endTime?}` | deposits, withdrawals, transfers, vault and staking moves |
| `clearinghouseState` | `{user, dex?}` | current perp state, one call per perp dex (anchor) |
| `spotClearinghouseState` | `{user}` | current spot balances (anchor) |
| `userAbstraction` | `{user}` | account mode: `default`, `unifiedAccount`, `portfolioMargin` |
| `portfolio` | `{user}` | HL's own account value and PnL history (comparison only) |
| `userVaultEquities`, `delegatorSummary` | `{user}` | holdings outside the trading account (reported, not scored) |
| `perpDexs`, `meta {dex}`, `spotMeta` | | dex list, collateral token per dex, spot token and pair ids |
| `candleSnapshot` | `{req: {coin, interval, startTime, endTime}}` | prices at marks |

## How far back data is served

| data | docs say | observed |
|---|---|---|
| fills (`userFillsByTime`) | 2000 per response; "only the 10000 most recent fills are available" | Paged 14,000 fills back to the account's first trade (2026-04-14) on one wallet, so the 10k cap was not enforced there. Treat it as a risk for very active accounts: if it bites, early fills silently go missing. The scorer's fill-by-fill position check (below) would catch it. |
| `userFillsByTime` page order | not stated | ascending from `startTime`, API order within a millisecond is execution order |
| funding (`userFunding`) | no limit stated | 500 per response, ascending. From `startTime: 0` it pages back to the account's first funding. |
| ledger (`userNonFundingLedgerUpdates`) | no limit stated, no response schema documented | From `startTime: 0` returned the account's full history (back to first deposit). Rows within a response are **not** sorted by time. The fetcher pages on the max time seen and dedupes. |
| general | "Responses that take a time range will only return 500 elements" | true for funding and ledger; fills return 2000 |
| candles | 5000 most recent candles per coin and interval | 1h candles reach ~208 days back; 1d candles reach ~13 years. 1m candles reach only ~3.5 days. |

Pagination: there is no cursor. Repeat the request with `startTime` = last time seen. Rows at that
exact millisecond come back again, so dedupe. The fetcher saves every page as served.

## Historical account value: the blocking gap

There is **no endpoint that returns account value at a chosen time**, so the daily 00:00 UTC marks
the spec asks for cannot be read from the API.

`portfolio` returns, per window (`day`, `week`, `month`, `allTime`, and `perp*` versions of each),
`accountValueHistory` and `pnlHistory` as `[timestampMs, "value"]` pairs:

- Samples are **not** at 00:00 UTC. Times look like `23:14:00.048`, `21:54:00.035`.
- `month` held 45-46 points over 30 days, gaps 4.8 h to 25.7 h on the wallets probed.
- `allTime` held 40-61 points over the account's life, gaps up to ~7 days.
- Windows only trail "now". You cannot ask for a past month.
- The last point is live: it equals current account value at request time.

Historical **mark prices** are not served either. Candles give trade prices only.

What we do instead (decided 2026-11-09): rebuild holdings exactly from fills, funding and ledger,
walked back from today's state, and price them at the last candle close before each mark. See
`methodology.md`.

## Account value: what HL counts

`clearinghouseState.marginSummary.accountValue = totalRawUsd + sum(szi * markPx)`. That is the perp
account only.

`portfolio` (non-perp windows) is the whole account, and how it adds up depends on `userAbstraction`:

- `default` (standard): portfolio value = spot balances valued + perp `accountValue` per dex.
- `unifiedAccount`: portfolio value = spot balances valued. The spot USDC balance already includes
  perp margin and unrealized PnL, so the perp `accountValue` must **not** be added again. Checked
  on three unified wallets: spot value matched HL's live number to the cent.
- `portfolioMargin`: did not reconcile on the one wallet with borrow/lend activity. Unsupported
  for now when `borrowLend` entries are present.

The leaderboard (`stats-data.hyperliquid.xyz/Mainnet/leaderboard`, not part of the info API) reports
**perp-only** PnL and ROI. It matches `portfolio.perpMonth`, not `portfolio.month`. On one wallet
holding ~$690k of spot UBTC, leaderboard month PnL was +67,854 and whole-account month PnL was
-65,626. Phase 0 scores the whole account, so it compares against `portfolio.month`.

## Fills

Fields: `coin, px, sz, side, time, startPosition, dir, closedPnl, hash, oid, crossed, fee, tid,
feeToken, twapId`, plus `builderFee` when non-zero and `liquidation` on liquidation fills.

- **No counterparty address.** Neither the docs nor any observed fill carries one. `tid` is shared
  by both sides of a trade but does not name the other side.
- `fee` includes `builderFee`. It can be negative (maker rebate). `feeToken` is usually USDC; spot
  buys can pay the fee in the base token.
- `startPosition` is the position (perps) or token balance (spot) **before** the fill. This is the
  most useful field for verification: it lets the scorer check its replay against HL fill by fill.
- Coin names: perps `BTC`; HIP-3 dex perps `xyz:XYZ100`; spot pairs `@107` or `PURR/USDC`.
- `dir` values seen: `Open Long`, `Close Long`, `Open Short`, `Close Short`, `Buy`, `Sell`,
  `Spot Dust Conversion`.

## Ledger entry types seen

`deposit, withdraw, send, spotTransfer, internalTransfer, subAccountTransfer, accountClassTransfer,
vaultDeposit, vaultWithdraw, cStakingTransfer, borrowLend` (40 random leaderboard wallets, 60 days,
plus the Alpha Arena wallets). The docs list no schema. The scorer handles each type explicitly
and refuses any type it does not know, rather than guessing.

`send` carries `user` (sender), `destination`, `sourceDex`, `destinationDex`, `token`, `amount`,
`usdcValue`, `fee`, `nativeTokenFee`. A send from the account to itself moves funds between its own
spot and perp dexes.

## Rate limits

Per IP, 1200 weight per minute, shared by all REST requests.

- weight 2: `clearinghouseState`, `spotClearinghouseState`, `allMids`, `l2Book`, `orderStatus`, `exchangeStatus`
- weight 60: `userRole`
- weight 20: everything else
- plus 1 per 20 items returned for `userFills`, `userFillsByTime`, `userFunding`, `historicalOrders`
  and a few others; plus 1 per 60 items for `candleSnapshot`

A 2000-fill page costs 120. The fetcher tracks weight and stays under 60% of the budget. Address-
based limits apply to actions only, not info requests.

## Found while running 21 wallets

- **HL's portfolio counts vault equity and staked HYPE.** A vault deposit is not a flow to HL; the
  vault's PnL is account PnL. Staked HYPE is valued in account value. Both are outside the trading
  account the attestor scores, which explains 3 of the misses in `wallets.md`.
- **`portfolio.allTime` opens with a placeholder worth 0**, then books the account's existing
  equity as a deposit at the next point. PnL before that point is attributed inside the window.
- **HL samples sometimes repeat exactly** (same value to 6 decimals on consecutive days while the
  account holds positions). On the dormant Arena wallets, 54-57 of ~60 `allTime` samples repeat.
- **Positions can change with no public event.** Two wallets had a fill whose `startPosition`
  disagrees with every fill and ledger entry served (a 400,000 PONS long that vanished without a
  closing fill; an `xyz:CRCL` position). Public data does not show what happened.
- **Funding history is shorter and coarser than fills.** On one wallet `userFunding` from a
  September `startTime` returned nothing before 2026-10-09, while fills reach back to September.
  Older funding comes as daily aggregates (`delta.nSamples` up to 24). On that wallet HYPE and XMR
  funding was missing for Oct 10-20 although both positions were open.
- `userAbstraction` can also return `"disabled"`. Treated like `default`.
- A spot pair can go hours or a whole day without a trade, so there is no candle for it. Pricing
  falls back to the last earlier candle.

## Other observations

- The API server clock ran ~4 hours ahead of this machine's local date (it was already 2026-11-10
  UTC). Periods are UTC dates.
- HIP-3 perp dexes (11 listed today) each need their own `clearinghouseState` call. Their collateral
  token comes from `meta {dex}`. Candles work for `dex:COIN` names.
- `portfolio.allTime` for the Alpha Arena wallets starts 2025-10-22 although they were funded on
  2025-10-17, so HL's own history does not cover their first days.
