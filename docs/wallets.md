# Results on public wallets

Run 2026-11-10 (UTC). Metrics rescored with `phase0-v4` (true time-weighted return, Sortino down-day gate); snapshots and the HL comparison are unchanged from the `phase0-v2` run. Raw per-wallet output, including every comparison
field, is in `wallet-results.json`. Snapshots are in `data/raw/` (gitignored; rerun with
`tsx scripts/run-wallets.ts`).

## Wallets

21 wallets. I found no full Senpi Arena addresses: senpi.ai/arena shows only shortened ones
(`0XED7534…`), so none are included.

- **15 from the Hyperliquid leaderboard** (`stats-data.hyperliquid.xyz/Mainnet/leaderboard`). One
  (`0x838d…`) was the first wallet probed. 14 are a random sample (`random.seed(42)`, Python) of the
  5,625 rows with account value $10k-$5M and 30-day volume $1M-$100M. Very large accounts were left
  out on purpose: billions in monthly volume means millions of fills to page through.
- **6 Alpha Arena Season 1 wallets** (nof1.ai, Oct 17 - Nov 3 2025). Addresses come from two
  independent public GitHub repos (`rz0718/hyperliquid-monitor`, `Gajesh2007/copytrading-agent`).
  Five appear in both; the Claude Sonnet 4.5 address appears in only one. None are confirmed by
  nof1 itself.

Periods: leaderboard wallets 2026-10-10 to 2026-11-10 (31 days). Arena wallets 2025-10-18 to
2025-11-04 (17 days, so Sharpe/Sortino are null and `meetsMinimums` is false by rule).

## How the check works

Hyperliquid's own PnL here is `portfolio.month` (whole account), or `portfolio.allTime` for the
Arena wallets, whose month window no longer covers 2025. Not the leaderboard: that is perp-only
(see `hyperliquid-api.md`). We rebuild holdings at HL's own sample times and compare PnL between
HL's first and last sample in the period.

**Tolerance** (`methodology.md` section 7): at both endpoints, every holding's |qty| times the
high-low range of the candle around the sample, plus 0.1% of price, plus $0.01. The reason: the only
input we cannot get exactly is the price at the sample. HL's mark lies inside the range traded
around that moment, so a correct replay cannot miss by more than this. The tolerance does not absorb
missing cash, fees or flows. It is tight for flat accounts ($0.01 when nothing is held) and wide
for big volatile positions, and for 2025 samples, where only daily candles remain.

## Results

| # | Wallet | Source | Mode | TWR | Max DD | Sharpe | Fees $ | Turnover | Min? | HL PnL | Our PnL | Diff | Tol | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `0x838d8e13` | leaderboard | unified | -4.61% | 9.49% | -1.29 | 23,304 | 71.74 | yes | -64,669 | -65,954 | -1,285 | 8,418 | PASS |
| 2 | `0xef2ac5c3` | leaderboard | | | | | | | | | | | | ERROR |
| 3 | `0x2888be69` | leaderboard | | | | | | | | | | | | ERROR |
| 4 | `0x085d2ac5` | leaderboard | unified | -4.74% | 14.72% | -0.72 | 4,802 | 41.86 | yes | -17,997 | 12,576 | 30,573 | 3,801 | MISS (vault) |
| 5 | `0x65c6b7f0` | leaderboard | default | -25.07% | 37.07% | -1.22 | 1,523 | 30.36 | yes | -62,798 | -65,097 | -2,299 | 4,777 | PASS |
| 6 | `0x5a3c19c7` | leaderboard | | | | | | | | | | | | ERROR |
| 7 | `0x51a4cee5` | leaderboard | unified | -27.83% | 31.99% | -5.17 | 2,541 | 12.06 | yes | -150,647 | -169,622 | -18,975 | 6,351 | MISS |
| 8 | `0x3364f3e9` | leaderboard | unified | -0.84% | 15.00% | 0.28 | 1,444 | 10.69 | yes | -23,833 | -15,204 | 8,629 | 7,869 | MISS (staking) |
| 9 | `0x25497a77` | leaderboard | unified | 9.50% | 36.91% | 1.59 | 228 | 23.65 | yes | 21,679 | 20,172 | -1,507 | 3,395 | PASS |
| 10 | `0xfc85ab58` | leaderboard | unified | 3.67% | 0.00% | 4.68 | 411 | 7.07 | yes | 8,707 | 8,707 | 0.00 | 0.02 | PASS (exact) |
| 11 | `0xcb30bc4a` | leaderboard | unified | 2.32% | 7.03% | 0.91 | 429 | 17.18 | yes | -3,337 | 1,316 | 4,653 | 701 | MISS |
| 12 | `0x1f2becbf` | leaderboard | unified | -73.10% | 87.28% | n/a | 986 | 1159.18 | yes | -8,680 | -8,472 | 208 | 1,038 | PASS |
| 13 | `0xdb951b52` | leaderboard | unified | -70.80% | 72.60% | -6.14 | 762 | 19.34 | yes | -175,990 | -177,493 | -1,503 | 4,284 | PASS |
| 14 | `0x9d1cceaf` | leaderboard | disabled | 0.00% | 0.00% | n/a | 0 | 0.00 | no | -110 | 0 | 110 | 0.01 | MISS (staking) |
| 15 | `0x0b554de8` | leaderboard | unified | 26.67% | 2.95% | n/a | 7,294 | 1496.00 | yes | 4,539 | 4,539 | 0.01 | 0.01 | MISS (1 cent) |
| 16 | `0xc20ac4dc` | Arena: DeepSeek V3.1 | default | 12.03% | 49.93% | n/a | 640 | 133.88 | no | -4,261 | -5,373 | -1,112 | 2,318 | PASS |
| 17 | `0x7a8fd8bb` | Arena: Qwen3 Max | default | 27.82% | 40.45% | n/a | 1,603 | 326.62 | no | -615 | -1,955 | -1,341 | 5,565 | PASS |
| 18 | `0x56d652e6` | Arena: Grok 4 | default | -43.89% | 57.60% | n/a | 350 | 106.32 | no | -3,487 | -3,234 | 254 | 2,749 | PASS |
| 19 | `0x67293d91` | Arena: GPT-5 | default | -65.97% | 77.81% | n/a | 512 | 333.38 | no | 1,075 | 1,337 | 262 | 1,015 | PASS |
| 20 | `0x1b7a7d09` | Arena: Gemini 2.5 Pro | default | -60.75% | 75.08% | n/a | 1,256 | 638.51 | no | 1,949 | 2,191 | 242 | 1,093 | PASS |
| 21 | `0x59fa085d` | Arena: Claude Sonnet 4.5 | default | -30.50% | 45.00% | n/a | 571 | 156.57 | no | -3,561 | -4,224 | -663 | 1,159 | PASS |

TWR, drawdown, Sharpe, fees and turnover are over our period (00:00 UTC marks). HL PnL, our PnL,
diff and tolerance are over HL's sample window inside that period, which for Arena wallets runs from
HL's first real sample (2025-10-22) to now. That is why the Arena PnL columns do not line up with
their TWR.

**Tally: 12 pass, 6 miss, 3 cannot be scored.** Of the 6 misses, 3 are explained by holdings HL
counts and we do not (vault, staking), 1 is a 1-cent rounding miss, and 2 are unexplained.

## Every miss, with the cause

**#4 `0x085d…`: vault PnL.** Diff 30,573. The account put 281,140 into a vault on Nov 5 and took
251,054 out on Nov 6. HL keeps vault equity inside account value, so the 30,087 vault loss is PnL to
HL. We score the trading account only, so the vault moves are flows to us. Adding the vault flows
back leaves 486, inside the 3,801 tolerance. Sample by sample our equity matches HL's except while
the money sat in the vault.

**#8 `0x3364…`: staked HYPE.** Diff 8,629 vs tolerance 7,869. The account has 1,057.66 HYPE staked
(~$84k). HL counts it; our level history sits a steady ~80-90k below HL's, moving with the HYPE
price. Adjusting for staked HYPE × the HYPE price change (-12,253) leaves -3,624, inside tolerance.

**#14 `0x9d1c…`: staked HYPE.** Trading account holds $0.007 and never traded; 10.57 HYPE is
staked. HL's -109.67 is the HYPE price drop on the staked tokens. The staking adjustment (-111.50)
leaves -1.82. That residual is staking rewards plus HYPE price error, which the tolerance does not
cover because the trading account holds nothing.

**#15 `0x0b55…`: 1 cent.** Flat at both endpoints, so the tolerance is $0.01, and the diff rounds to
$0.01 and sits just past it. HL publishes values to 6 decimals; the gap is probably rounding in HL's
own sampling. I left the $0.01 floor alone rather than widen it after seeing results.

**#7 `0x51a4…`: unexplained, -18,975.** Every fill's position check passes and both sides see no
flows. Our level history sits 9-17k above HL's from Oct 10 to Oct 17, then the two converge from
Oct 19 and track closely. Spot HYPE prices (its biggest holding) agree with perp prices to 0.1%.
HL's month and allTime series agree with each other. I did not find the cause.

**#11 `0xcb30…`: unexplained, +4,653.** Same shape: a ~3-4.6k gap (HL higher) until Oct 18, then
convergence. 15 of its 43 HL samples exactly repeat the previous value (e.g. 95,917.186067 on both
Oct 12 and Oct 13), while the account held HYPE, XMR and HIP-3 positions. That points at HL's own
history being stale in places, but I could not prove the gap comes from that.

One more oddity from #11: `userFunding` returned no HYPE or XMR funding for Oct 10-20, although
fills show both positions open since September. Funding is served as daily aggregates there
(`nSamples` up to 24). The missing rows are worth tens of dollars a day, too small to explain the
gap, but it means funding history may not be complete.

## Wallets that cannot be scored

The scorer stops instead of guessing (`CLAUDE.md`: no silent approximation).

**#2 `0xef2a…`: a position changed without a public fill.** At 2026-10-10T10:02 the replay holds
683.316 `xyz:CRCL` but HL's `startPosition` on the next fill says -138.229. Some position change in
between has no fill. Without it, the walk back is wrong for every earlier time.

**#3 `0x2888…`: same, on `PONS`.** The account bought 400,000 PONS perp on Nov 4 (95 fills, all
`Open Long`, starting from 0). At the anchor there is no PONS position, and there is no closing fill
or ledger entry. Walking back from the anchor then puts a phantom -400,000 short in place before
Nov 4. The first version of the scorer counted these mismatches but still produced numbers; it now
stops. What closed the position is not visible in public data.

**#6 `0x5a3c…`: `borrowLend`.** The account supplied 273,814 USDC to HL lending. How lent balances
show up in `spotClearinghouseState` and in HL's account value is not documented, so the scorer
refuses the ledger type.

## TWR on flow-heavy accounts

`phase0-v2` used Modified Dietz within each day. It assumes flows are small next to equity, and two
accounts broke it: `0x1f2b…` sweeps nearly all funds out and back in (equity $0.000001 at several
midnights), and `0x085d…` moved six-figure sums in and out within single days. Their v2 numbers
were noise: TWR -63.94% and Sharpe 4.14 next to a -32% TWR.

`phase0-v3` values the account just before and after every flow and chains the pieces, skipping
pieces where the account is flat (equity and exposure both under $1). Results:

| Wallet | v2 TWR | v3 TWR | v2 Sharpe | v3 Sharpe |
|---|---|---|---|---|
| `0x085d…` | -63.94% | -4.74% | -3.05 | -0.72 |
| `0x1f2b…` | -32.48% | -73.10% | 4.14 | n/a (25 daily returns after dust days are skipped) |

`0x085d…` now has positive dollar PnL (+17,321) next to a -4.74% TWR. That is not a contradiction:
TWR weights each day equally, and this account lost while it was small and gained while it was big.
Accounts without large flows are unchanged (e.g. `0x838d…` -4.61% in both).

**Sortino on near-flat accounts.** In `phase0-v3`, `0xfc85…` had Sortino 418,209.66: its 16 down
days were each about -0.00001% (cents of funding on a $240k account), so the downside deviation was
nearly zero. `phase0-v4` needs at least 5 days with a loss of 1 basis point or more; `0xfc85…` has
none, so its Sortino is n/a. The other 8 wallets with a Sortino are unchanged.

## Exit gate

1. **Same snapshot, same hash on two clean checkouts:** pass, on `phase0-v2` and again on
   `phase0-v3` (see the end of this file). Two fresh `git clone`s of commit `d8a0397`, `pnpm install --frozen-lockfile`, same snapshot of `0x838d…`: byte-identical
   `metrics.json` and `manifest.json` (`metricsHash eadc053e…`). Both clones ran on this machine
   (Node 25.8.1, macOS); I did not test a second OS or Node version.
2. **Scorer PnL agrees with HL within tolerance:** 12 of 21 pass outright. With vault and staking
   adjustments, 14 of 18 scorable wallets agree. The other 4: #14 is explained by staking but keeps
   a $1.82 residual, #15 misses by a cent, #7 and #11 are unexplained. 3 cannot be scored (#2, #3,
   #6).

`verify` against the live API also returned MATCH on `0x838d…` on two separate refetches: new anchor
each time, 37 and then 38 of 63 raw files changed, identical metrics hash (the second run on the
final `phase0-v2` code).

**On `phase0-v3`** (commit `9243614`): two fresh clones again gave byte-identical `metrics.json` and
`manifest.json` (`metricsHash a4a5dc68…`), and a live `verify` returned MATCH with 41 of 63 raw
files changed.

**On `phase0-v4`** (commit `a05cc74`): two fresh clones gave byte-identical `metrics.json` and
`manifest.json` (`metricsHash 11bdd530…`).
