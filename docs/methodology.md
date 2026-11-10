# Methodology (phase0-v4)

The scorer turns a snapshot of raw public API responses into metrics. It is a pure function: no
network, no clock, no randomness. Every number is a `decimal.js` decimal (60 significant digits,
round half-even). Floats appear only in the report card's display formatting.

## 1. What is scored

The whole trading account: spot balances plus perp positions on every perp dex (default and HIP-3).
Vault deposits and HYPE staking are outside it: moving money into a vault or into staking is an
external outflow, and back out is an inflow. Their value while outside is not scored.

## 2. Rebuilding holdings

Holdings are token balances plus signed perp sizes. Equity at time t is

    equity(t) = sum(balance[token] * price(token, t)) + sum(szi[coin] * price(coin, t))

A perp trade books its notional against the dex's collateral token: buying `sz` at `px` adds `sz`
to the position and takes `sz * px` from collateral. This is HL's own identity
(`accountValue = totalRawUsd + sum(szi * markPx)`) and it holds in every account mode.

**Anchor.** The fetch reads current state (`clearinghouseState` per dex, `spotClearinghouseState`,
`userAbstraction`). Its `time` is the anchor. Starting balances:

- `default` mode: spot balances, plus each dex's `totalRawUsd` in that dex's collateral token.
- `unifiedAccount` / `portfolioMargin`: spot balances already include perp equity at mark, so we
  subtract `sign(szi) * positionValue` per position to avoid counting positions twice.

**Walk back.** Every fill, funding payment and ledger entry from the period start to the anchor is
undone in reverse to get holdings at the period start. Then the scorer walks forward, applying
events, and takes a mark at each 00:00 UTC. A mark at M includes events with `time < M`.

Cash is exact: it is a sum of decimal strings HL published. Positions are exact. **Prices are the
one approximation** (section 3).

**Fill-by-fill check.** Each fill carries HL's `startPosition` (perp size or spot balance before the
fill). The scorer compares its replayed value with it on every fill from the period start to the
anchor (fills after the period also drive the walk back). A difference above 0.000001 means some
position changed without a public event, so every earlier holding is wrong: scoring stops with an
error. Smaller differences are rounding dust HL applies without an event; they are counted in
`integrity.positionDust` and `positionMaxDust`.

The fetcher refuses to anchor while events land within 5 s of the anchor time (it retries up to 6
times), so the anchor and the event streams agree.

## 3. Prices at marks

HL does not serve historical mark prices or historical account value at a chosen time
(`hyperliquid-api.md`). At a daily mark M, each holding is priced at the **close of the 1d candle
that ends just before M**: the last trade before midnight UTC. Spot tokens use their USDC pair.
USDC is 1.

This differs from HL's mark price (an oracle/median price) by the gap between last trade and mark,
usually small for liquid markets and larger for thin ones. `integrity.staleMarks` counts marks
priced from a candle older than one day (no trades that day). `integrity.staleIntradayPrices`
counts the same for intraday prices (flows, fees, funding) taken from a candle older than its
interval.

Intraday values (fees paid in a non-USDC token, token flows without a stated USD value) use the
last 1h close before the event, falling back to 1d.

Tokens with no USDC spot pair cannot be priced. The scorer stops with an error rather than guess.

## 4. External flows

| ledger type | treatment |
|---|---|
| `deposit` | inflow |
| `withdraw` | outflow of `usdc + fee` |
| `send`, `spotTransfer`, `internalTransfer`, `subAccountTransfer` | inflow or outflow by direction; valued at `usdcValue` when HL gives it. A send from the account to itself is internal (no flow) apart from any fee |
| `accountClassTransfer` | internal, no flow |
| `vaultDeposit`, `vaultWithdraw`, `vaultDistribution` | outflow / inflow (money leaves or rejoins the trading account) |
| `cStakingTransfer` | outflow to staking / inflow from it, valued at the HYPE price |
| `rewardsClaim`, `vaultLeaderCommission`, `spotGenesis` | **non-trading income**: an inflow, reported separately |
| `liquidation` | informational; the closing trades arrive as fills |
| `borrowLend` and anything else | **unsupported**: scoring stops with an error |

## 5. Metrics

**twrNet.** Time-weighted return, net of fees and funding, chained over daily returns.

Flow-timing convention: **true time-weighted return, cut at every external flow.** The replay can
value the account at any moment, so each flow is valued in place: the account is valued just
before the flow (events earlier in event order applied) and just after it, at the same prices (last
1h close before the flow, falling back to 1d). A day [M0, M1) with flows at t_1..t_k splits into
pieces with no flow inside them:

    r_day = (V(t_1-) / E0) * (V(t_2-) / V(t_1+)) * ... * (E1 / V(t_k+)) - 1

The size and timing of flows do not move the return. A flow exactly at 00:00 belongs to the day
starting then. Edge rules, each tested in `test/metrics.test.ts`:

- A piece is skipped only when the account is **flat** at its start: equity and gross exposure
  (|non-USDC balances| + |perp notional|) both below $1. Dust left after a sweep cannot produce
  returns, and a small account with open positions is never skipped.
- A piece that ends at or below zero counts as -100%. The chain never flips sign.
- Zero or negative equity with positions open at the start of a piece: scoring stops, because
  the return is undefined.
- A day with no pieces left has no return. It is left out of the chain and out of Sharpe/Sortino.

Prices inside the day come from hourly candles, so piece values carry the same price
approximation as the marks. At midnight the 1h and 1d closes are the same trade, so the two
sources agree at mark boundaries.

`phase0-v1/v2` used Modified Dietz within each day. It broke on accounts that sweep most of their
funds out and back within a day (`wallets.md`).

**maxDrawdown.** Largest peak-to-trough fall of the return index (start 1, chained daily
returns), as a positive fraction. The index's starting value counts as a peak.

**sharpe.** mean(r) / sample stdev(r) * sqrt(365). Risk-free rate 0. Null with fewer than 30 daily
returns or zero variance.

**sortino.** mean(r) / downside deviation * sqrt(365), downside deviation = sqrt(sum(min(r,0)^2) / n).
Null with fewer than 30 daily returns or fewer than 5 real losing days. A day counts as a real
loss at -0.01% (1 basis point) or worse. Without this, a near-flat account whose only losses are
cents of funding has a downside deviation near zero and the ratio explodes (one wallet showed
418,210 from 16 down days of about -0.00001% each). The losing-day count is only a gate; the
downside deviation itself still uses every negative day.

**pnlNet.** E(end) - E(start) - net external flows (non-trading income counts as a flow).

**feesPaid.** Sum of fill fees in USD for fills in the period. Maker rebates (negative fees) reduce
it. Also as a share of starting equity.

**fundingNet.** Sum of funding payments in USD (positive = received). Also as a share of starting
equity.

**turnover.** Sum of |sz * px| over fills in the period, perp and spot, divided by average daily
equity. Average daily equity is the mean of all marks, both ends included.

**nonTradingIncome.** Sum of the ledger entries in section 4 marked non-trading. Excluded from
twrNet because it is a flow.

**operatorCohort.** Always null in Phase 0. It needs the agent binding.

**meetsMinimums.** True when the period is at least 30 days and average daily equity is at least
1,000 USD.

## 6. Determinism

- Output JSON: sorted keys, 2-space indent, LF, trailing newline.
- USD amounts: fixed 6 decimal places. Returns and ratios: fixed 10. Half-even rounding.
- No timestamps of the run. Dates appear only as period and daily mark dates.
- Events are ordered by time, then stream (fills, funding, ledger), then API order. API order is
  part of the snapshot, so the order is fixed by the input.
- `manifest.json` records the scorer's git commit, whether `src/` or the lockfile were dirty,
  sha256 of every input file, and sha256 of `metrics.json`.
- `verify` refetches. The anchor and events after the period change between fetches, but the
  rebuilt holdings at each mark do not, so metrics should match exactly. A changed metrics hash
  means HL changed history, the fetch missed data, or the scorer changed.

## 7. Comparison with HL (exit gate)

`scripts/compare-hl.ts` rebuilds holdings at **HL's own sample times** from `portfolio.month` (or
`allTime` when the month window does not cover the period) and compares PnL over HL's window:

    ours = E(last sample) - E(first sample) - flows between them
    HL   = pnlHistory(last) - pnlHistory(first)

Tolerance, per wallet: the only inexact input is price. At each of the two endpoints, for every
holding, HL's mark lies inside the traded range of the candle containing the sample time, so

    tol = sum over both endpoints and all holdings of |qty| * ((high - low) + 0.001 * close) + 0.01 USD

HL's `allTime` series starts with a placeholder worth 0; the comparison starts at the first
non-zero sample.

The script also reports, without changing pass/fail: vault flows inside the window (HL counts vault
PnL as account PnL), the effect of staked HYPE (`staked * HYPE price change`, valid when no staking
moves happen in the window), the diff after both (`diffExOutside`), and how many HL samples exactly
repeat the previous one.

The 0.1% term covers the gap between last trade and HL's oracle-based mark. This bound grows with
position size and volatility, which is what drives the price error. It does not absorb errors in
cash or flows: if the replay missed a fee or a transfer, the miss shows.

## 8. Known limits

- Marks use last-trade candle closes, not HL mark prices.
- Spam or illiquid spot tokens are valued at their last trade, which may not be how HL values them.
- `borrowLend`, unknown ledger types, and tokens without a USDC pair stop scoring.
- Vault and staking value is outside the scored account; HL's portfolio may include it.
- If HL's 10,000-fill cap applies to an account, early fills are missing; the position check would
  show mismatches.
