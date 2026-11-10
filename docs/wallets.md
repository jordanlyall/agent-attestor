# Results on public wallets

Run 2026-11-10 (UTC), `phase0-v5`. Every snapshot was refetched for v5, because v1-v4 never
fetched TWAP slices (`hyperliquid-api.md`). The v4 snapshots are kept in `data/raw-v4/`. Raw per-wallet output, including every comparison
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
| 1 | `0x838d8e13` | leaderboard | unified | -4.61% | 9.49% | -1.29 | 23,304 | 71.74 | yes | -57,483 | -57,477 | 5 | 11,246 | PASS |
| 2 | `0xef2ac5c3` | leaderboard | unified | 17.09% | 12.55% | 2.90 | 1,291 | 39.33 | yes | 12,816 | 12,875 | 59 | 656 | PASS |
| 3 | `0x2888be69` | leaderboard | unified | 3.00% | 7.13% | 0.85 | 1,860 | 14.70 | yes | 8,997 | 9,166 | 169 | 573 | PASS |
| 4 | `0x085d2ac5` | leaderboard | unified | -4.74% | 14.72% | -0.72 | 4,802 | 41.86 | yes | -19,571 | 10,551 | 30,122 | 3,703 | MISS (vault) |
| 5 | `0x65c6b7f0` | leaderboard | default | -25.07% | 37.07% | -1.22 | 1,523 | 30.36 | yes | -62,926 | -63,463 | -536 | 5,019 | PASS |
| 6 | `0x5a3c19c7` | leaderboard | | | | | | | | | | | | ERROR |
| 7 | `0x51a4cee5` | leaderboard | | | | | | | | | | | | ERROR |
| 8 | `0x3364f3e9` | leaderboard | unified | -0.84% | 15.00% | 0.28 | 1,444 | 10.69 | yes | -22,234 | -10,902 | 11,331 | 10,608 | MISS (staking) |
| 9 | `0x25497a77` | leaderboard | unified | 9.50% | 36.91% | 1.59 | 228 | 23.65 | yes | 21,772 | 22,809 | 1,037 | 2,303 | PASS |
| 10 | `0xfc85ab58` | leaderboard | unified | 3.67% | 0.00% | 4.68 | 411 | 7.07 | yes | 8,707 | 8,707 | 0.00 | 0.02 | PASS (exact) |
| 11 | `0xcb30bc4a` | leaderboard | unified | -3.56% | 7.03% | -1.25 | 472 | 18.01 | yes | -3,337 | -3,327 | 10 | 82 | PASS |
| 12 | `0x1f2becbf` | leaderboard | unified | -73.10% | 87.28% | n/a | 986 | 1159.18 | yes | -11,974 | -12,684 | -710 | 2,109 | PASS |
| 13 | `0xdb951b52` | leaderboard | unified | -70.80% | 72.60% | -6.14 | 762 | 19.34 | yes | -175,997 | -177,496 | -1,499 | 4,285 | PASS |
| 14 | `0x9d1cceaf` | leaderboard | disabled | 0.00% | 0.00% | n/a | 0 | 0.00 | no | -119 | 0 | 119 | 0.01 | MISS (staking) |
| 15 | `0x0b554de8` | leaderboard | unified | 26.67% | 2.95% | n/a | 7,294 | 1496.00 | yes | 4,539 | 4,539 | 0.01 | 0.01 | MISS (1 cent) |
| 16 | `0xc20ac4dc` | Arena: DeepSeek V3.1 | default | 12.03% | 49.93% | n/a | 640 | 133.88 | no | -4,261 | -5,373 | -1,112 | 2,318 | PASS |
| 17 | `0x7a8fd8bb` | Arena: Qwen3 Max | default | 27.82% | 40.45% | n/a | 1,603 | 326.62 | no | -615 | -1,955 | -1,341 | 5,565 | PASS |
| 18 | `0x56d652e6` | Arena: Grok 4 | default | -43.89% | 57.60% | n/a | 350 | 106.32 | no | -3,488 | -3,234 | 254 | 2,749 | PASS |
| 19 | `0x67293d91` | Arena: GPT-5 | default | -65.97% | 77.81% | n/a | 512 | 333.38 | no | 1,075 | 1,337 | 262 | 1,015 | PASS |
| 20 | `0x1b7a7d09` | Arena: Gemini 2.5 Pro | default | -60.75% | 75.08% | n/a | 1,256 | 638.51 | no | 1,949 | 2,191 | 242 | 1,093 | PASS |
| 21 | `0x59fa085d` | Arena: Claude Sonnet 4.5 | default | -30.50% | 45.00% | n/a | 571 | 156.57 | no | -3,561 | -4,224 | -663 | 1,159 | PASS |

TWR, drawdown, Sharpe, fees and turnover are over our period (00:00 UTC marks). HL PnL, our PnL,
diff and tolerance are over HL's sample window inside that period, which for Arena wallets runs from
HL's first real sample (2025-10-22) to now. That is why the Arena PnL columns do not line up with
their TWR.

HL's month window trails "now", so the refetch moved it: the HL PnL, our PnL and tolerance
columns differ from the v4 run for the leaderboard wallets even where nothing else changed.

**Tally: 15 pass, 4 miss, 2 cannot be scored.** All 4 misses are explained: 3 by holdings HL counts
and we do not (vault, staking), 1 is a 1-cent rounding miss. None are unexplained.

## What v5 changed

v1-v4 never fetched TWAP slices, so every TWAP trade was missing from the replay. Four wallets used
TWAPs in the period. Each one was a miss or an error before and the cause was misread:

| Wallet | v4 | TWAP slices found | v5 |
|---|---|---|---|
| #2 `0xef2a…` | ERROR: "xyz:CRCL changed without a fill" | 5,020 slices, 108 orders | PASS, diff 59 vs tol 656 |
| #3 `0x2888…` | ERROR: "PONS long vanished" | 371 slices, 2 orders (the PONS close was a TWAP, Nov 4 19:37-19:47) | PASS, diff 169 vs tol 573 |
| #7 `0x51a4…` | MISS, -18,975, "unexplained" | 4,069 slices; one spot HYPE TWAP is only partly served | ERROR (below) |
| #11 `0xcb30…` | MISS, +4,653, "unexplained" | 139 slices: HYPE and XMR opened Oct 21, not September | PASS, diff 10 vs tol 82 |

The v4 write-up called #7 and #11 unexplained and suggested HL's own history was stale, and called
#2 and #3 positions that changed with no public event. Both readings were wrong. A Codex second
opinion found the TWAP endpoint; I confirmed it independently before fixing the fetcher.

The fix changed one published number materially: #11's TWR went from +2.32% to -3.56% (Sharpe 0.91
to -1.25), because the replay no longer invents HYPE and XMR positions for Oct 10-20. The other 15
scorable wallets have the same metrics as in v4.

The `startPosition` check had passed on all four wallets. It cannot see a missing opening fill
(`methodology.md` section 2). v5 adds an hourly funding check and a TWAP coverage check; both pass on
all 19 scorable wallets, so neither raised a false alarm here.

## Every miss, with the cause

**#4 `0x085d…`: vault PnL.** Diff 30,122. The account put 281,140 into a vault on Nov 5 and took
251,054 out on Nov 6. HL keeps vault equity inside account value, so the 30,087 vault loss is PnL to
HL. We score the trading account only, so the vault moves are flows to us. Adding the vault flows
back leaves 35, inside the 3,703 tolerance.

**#8 `0x3364…`: staked HYPE.** Diff 11,331 vs tolerance 10,608. The account has 1,057.66 HYPE staked.
HL counts it; we do not.
Adjusting for staked HYPE times the HYPE price change leaves -595, inside tolerance.

**#14 `0x9d1c…`: staked HYPE.** Trading account holds $0.007 and never traded; 10.57 HYPE is
staked. HL's -119 is the HYPE price drop on the staked tokens. The staking adjustment leaves 2.16.
That residual is staking rewards plus HYPE price error, which the tolerance does not cover because
the trading account holds nothing.

**#15 `0x0b55…`: 1 cent.** Flat at both endpoints, so the tolerance is $0.01, and the diff rounds to
$0.01 and sits just past it. HL publishes values to 6 decimals; the gap is probably rounding in HL's
own sampling. I left the $0.01 floor alone rather than widen it after seeing results.

## Wallets that cannot be scored

The scorer stops instead of guessing (`CLAUDE.md`: no silent approximation).

**#7 `0x51a4…`: TWAP history no longer served.** Spot HYPE TWAP 2297432 started 2026-10-08 and
executed 4,475.18 HYPE before it stopped on Oct 14 (`Insufficient spot balance`). The slice
endpoint serves only the last 807.22 HYPE of it, from Oct 13 on, for any `startTime`. About
3,668 HYPE (~$310k) of buys between Oct 8 and Oct 13 are gone from public data, so holdings before
Oct 13 cannot be rebuilt. With the slices that are served, Codex's partial replay lands at -3,868
against a 4,188 tolerance, but a pass on incomplete history would mean nothing.

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
2. **Scorer PnL agrees with HL within tolerance (v5):** 15 of 21 pass outright. With vault and
   staking adjustments, 17 of 19 scorable wallets agree. The other 2: #14 is explained by staking
   but keeps a $2.16 residual, #15 misses by a cent. 2 cannot be scored (#6, #7).

`verify` against the live API also returned MATCH on `0x838d…` on two separate refetches: new anchor
each time, 37 and then 38 of 63 raw files changed, identical metrics hash (the second run on the
final `phase0-v2` code).

**On `phase0-v3`** (commit `9243614`): two fresh clones again gave byte-identical `metrics.json` and
`manifest.json` (`metricsHash a4a5dc68…`), and a live `verify` returned MATCH with 41 of 63 raw
files changed.

**On `phase0-v4`** (commit `a05cc74`): two fresh clones gave byte-identical `metrics.json` and
`manifest.json` (`metricsHash 11bdd530…`).

**On `phase0-v5`** (commit `819c70d`): two fresh clones gave byte-identical `metrics.json` on the
three TWAP wallets (#2 `0066e3e7…`, #3 `c9ac21b1…`, #11 `4c1c40ff…`), each equal to the repo's own
output. Live `verify` returned MATCH on #11 (24 of 52 raw files changed) and #3 (35 of 65 changed).

**On `phase0-v6`** (commit `b94434c`): live `verify` returned MATCH on all 19 scorable wallets.
The first full run, on v5, returned MISMATCH on 9: only the integrity counts differed (checks run
to the fetch time, and HL compacts old funding rows). v6 moved those counts to the manifest. No
metric value changed on any wallet.
