# The Snipe setup, explained and made mechanical

Sources read: 63 Snipe Vault lesson transcripts (June 2022 to May 2026), the master analysis report and
dataset in `SNIPE_MASTER_DATA`, 1,983 chart screenshots (sample reviewed), and 320 posted signals
(305 with entry + SL) from the Snipe Trading Pro channel, 11 Sep 2024 to 6 Aug 2026.

## 1. What the setup is in one paragraph

Gold only, mostly 5m and 15m charts (he also uses 3m and 30m when the picture is clearer there),
traded from London open until about an hour after New York open. He waits for price to **take out an
obvious high or low** (external liquidity), then **flip structure** (a change of character), then
**consolidate**, then **break out of that consolidation with a big candle**, and he sells (or buys) the
**retest of the last opposite candle inside that consolidation**, but only if that candle sits in the
**deep part of the Fibonacci retracement (beyond 0.764)** of the breakout leg. Stop goes just beyond the
zone, never more than 28 pips (1 pip = $0.10). Targets are not fixed: partials as the trade runs and the
ultimate target is the low or high that the breakout made. He calls this entry model **TR2** and it is
the one he trades almost exclusively now.

## 2. The checklist he recites every lesson

Four **mandatory** confluences. "If I do not have these four, there is no trade."

| # | Confluence | What it means on the chart |
|---|---|---|
| 1 | Market structure + consolidation | A CHOCH (close through the last higher low / lower high) after a liquidity sweep, followed by a range. A consolidation and its break "counts as structure". |
| 2 | Fibonacci 0.764 | The **only** level he uses (he dropped 0.618 years ago). For a sell: drawn from the consolidation **high** (1.0) down to the swing **low** (0.0). The zone must sit at or beyond 0.764, in the "premium". Buys are the mirror image. |
| 3 | Supply / demand zone | The last opposite or indecision candle (small body, big wicks) before the impulsive candle that broke out. Drawn body-only when the wick would make the stop too big. Fresh, untested zones only. Refined down timeframes until the stop fits. |
| 4 | Liquidity | An external high/low (previous swing, session high/low, equal highs, trendline) must have been **swept before** the setup forms. |

Extra confluences, each adds weight, none required:

5. Session Volume Profile POC on or within a few pips of the zone (same day or one day old).
6. Imbalance (fair value gap) left next to the zone, ideally filled into it.
7. Session liquidity: the swept level was an Asia, London or previous-day high/low.
8. Entry model: TR2 is "overpowered", TC is fine, TR1 he no longer trades.
9. High-volume zone and structure: the zone or the CHOCH was created in the first 30 minutes of London open or the first 1 to 2 hours of New York open. A 3 am zone is "useless".
10. 50% of the full extension lands on the zone (trending markets only).

Scoring in his words: 4 = a trade, 5 = decent, 6 = good, 8+ = "these do not fail".

## 3. The three entry models

- **TR2 (favourite)**: external liquidity swept, CHOCH, consolidation, structure breaks **away** from the
  consolidation with volume, enter on the retest of the freshest zone inside the consolidation.
  "TR2 is the first trend continuation of a new trend." His claim: "80% of TR2s give the ultimate target."
- **TC (trend continuation)**: trend already established, consolidation, break **with** the trend, retest.
  No sweep or CHOCH needed. Two reversals cannot follow each other; the second becomes a TC.
- **TR1**: sweep, CHOCH, consolidation that does **not** break, entry from the extreme zone at the CHOCH
  origin. He said in 2026 he "hasn't traded these for a very long time".

## 4. Execution and management, the exact numbers

| Rule | What he says |
|---|---|
| Entry | Pending limit at the tip of the zone. No confirmation candle once 5+ confluences are present. Lately he sometimes enters at market after the reaction because price overshoots the tip. |
| Stop | Other side of the zone plus a few pips. "I trade maximum 28 pip stop losses, that's my rule." Posted signals: median 24 pips, 71% between 9 and 40. |
| Breakeven | Around 1:1, sooner on counter-trend trades, more room on with-trend trades. Early breakeven cost him two big runners. |
| Partials | 50 to 60% at 1:2, 70 to 80% off by 1:3, 90% at the liquidity pool, 10% runner. No fixed take-profit orders ever. |
| Ultimate target | The swing low/high that anchored the fib (fib 0), then the next external liquidity or opposing zone. |
| Golden rule | Once the liquidity pool between zone and target has filled, never re-enter the same zone. |
| Risk | 1% per day, 1 trade a day, 2 at most (for example 0.7% + 0.3%). |
| Session | London open to New York open plus about an hour (07:00 to 15:00 UTC in the posted signals, 93% of them between 07:00 and 14:00). Never Asia. Avoid Friday New York. |
| News | No CPI, NFP, GDP. Close 90% before red news, re-enter 3 to 5 minutes after. |

## 5. What the data says about the channel's track record

From the 305 valid posted signals:

| Item | Value |
|---|---|
| Direction | 179 sells, 126 buys |
| Frequency | about 13 per month, 3 a week |
| Entry style | 310 of 320 posted "@ MARKET" |
| Stop size | median 24 pips |
| Busiest hours (UTC) | 08:00 to 13:00 |
| Days | Tuesday most, Friday least |

Follow-up messages after each signal: 217 claim a win, 29 mention breakeven only, 23 have no follow-up,
6 mention a loss. Two years of signals with six mentioned losses is not a track record, it is marketing.
The earlier "+614% backtest" in the vault folder was fabricated (it hard-codes a 2-in-3 win rate and never
reads price data). **Nobody has verified this setup on real price data yet.** That is what the backtest
here is for.

He also said on video 30 that he tried to code the strategy with students and "it ended up in nothing"
because the software could not pick the consolidations. That is the honest core of the problem, and the
reason the code below makes the consolidation rule explicit.

## 6. The three things he leaves to judgement, and how the code resolves them

| Discretionary joint | His words | Mechanical rule used in the indicators and backtest |
|---|---|---|
| Which consolidation | "Cannot be defined as a rule" | The largest window of 6 to 40 bars ending at the breakout candle whose total high-to-low range is at most 2.2 x ATR(14). The breakout candle must close outside the box with a body at least 1.3 x the 10-bar average body. |
| Which zone inside it | "Freshest zone" / "most extreme 15m zone" (both said) | Default: the last opposite-or-indecision candle before the breakout (freshest). Switch to "extreme" to use the one at the box edge. Indecision = body no more than 45% of the range. |
| Which timeframe | "Whatever shows the setup clearest" | Run the detector on 5m and 15m separately. Fills and management are always simulated on 1-minute data. |
| Fib anchor | consolidation edge to swing extreme | Sell: box high (1.0) to the running low after the break (0.0). The zone is "armed" only once the leg has extended far enough that the zone entry is at or beyond 0.764. A touch before that is logged as "touch before fib gate" and not traded. |
| Sweep | "taking out the high or low" | A wick beyond the last confirmed swing (5-bar pivot). CHOCH = close through the last opposite swing within 40 bars of the sweep. Box break must come within 60 bars of the CHOCH for TR2. |
| Stop | tip of zone, cap 28 | Wick tip plus 3 pips buffer. If that is more than 28 pips the zone is skipped (the indicator does not try to guess his lower-timeframe refinement). |
| Partials | discretionary ladder | Breakeven at 1R, 50% at 2R, 30% at 3R, 20% to the leg extreme. All configurable. |

Score in the code: 4 mandatory + imbalance next to zone + session level swept + zone born in a London/NY
open window + TR2 model + stop 20 pips or less, so 4 to 9. The ATAS version adds up to 4 orderflow points.

## 7. Orderflow layer (ATAS only)

Evaluated on the bar that touches the zone:

1. **Delta agrees**: negative delta on a sell touch, positive on a buy touch.
2. **Absorption**: volume at least 1.5 x the 20-bar average with a body of 35% of the range or less.
3. **Stacked imbalances**: three or more consecutive diagonal bid/ask imbalances of 300% or more against the retracement.
4. **Delta divergence**: the retest prints a weaker max delta than the leg that created the zone.

The backtest reports results with and without each filter, so you can see which ones actually improve the
win rate and expectancy on your data instead of assuming they do.

## 8. What "results" will look like and what is needed

The engine produces, per timeframe: number of setups, win rate, average R, profit factor, drawdown, how
often 1R / 2R / 3R / the ultimate target is reached, breakdowns by model, direction, score, hour, and each
orderflow filter, plus a replay of the 305 posted signals against the same data to get the channel's real
win rate. All of it needs one input that only your ATAS installation can provide: the 1-minute gold export
described in `ATAS_EXPORT.md`. The container this was built in has no market data access.
