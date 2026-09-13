# Snipe TR2 / TC strategy — full rule specification (as implemented, v3)

This is the exact rule set coded in `tradingview/SnipeSetup.pine`, `tradingview/SnipeStrategy.pine`,
`mt5/SnipeTR2.mq5`, `atas/SnipeOrderflow.cs` and `backtest/snipe_bt/detector.py`. All five must agree.
Where a rule is my interpretation of something the teacher (Alex, Snipe Trading) leaves to judgement,
it is marked **[interpretation]** and a reviewer should check it against the lessons and fix the code,
not the rule, if they disagree. Sources: `SETUP_EXPLAINED.md` (verified from 63 lesson transcripts).

Instrument: gold (XAUUSD). 1 pip = 0.10 in price. Setup timeframe: 5m (also 15m, 3m). All clock rules in UTC.

---

## 1. Market structure (two tiers, same algorithm)

Structure is read at two scales with one algorithm. Lengths are in bars of the chart timeframe.

| Tier | Length | Used for |
|---|---|---|
| Swing (external) | 50 | real highs/lows = external liquidity, swing bias, trailing range for premium/discount |
| Internal | 5 | CHoCH and BOS that build the setup, the consolidation break |
| Trend (HTF) | 10 bars of the 1H chart | direction filter |

**Pivot registration (leg state).** A leg turns bearish when the candle N bars ago has a higher high than
all N candles after it, and bullish when it has a lower low than all N after it. A swing high is registered
only on the bar the leg turns bearish; a swing low only on the bar it turns bullish. A registered level does
not move until the leg turns the other way. Each level carries a `crossed` flag, initially false.
**[interpretation]**: this is the LuxAlgo SMC method; the teacher never gives a bar count.

**Break.** A bullish break of a tier = a candle *close* above that tier's last swing high while its
`crossed` flag is false. Bearish break = close below the last swing low. After a break the flag is set,
so each level can only be broken once.

**CHoCH vs BOS.** Each tier has a bias (+1 / -1, starts 0). A break against the current bias is a
**CHoCH** (bias flips). A break in the direction of the bias is a **BOS**. Body close required, wicks do not count.

**Swing bias** = bias of the swing tier. **Internal bias** = bias of the internal tier.

**Trailing range.** `trailTop` = the last registered swing high, then raised by every higher high since;
`trailBot` = the last registered swing low, lowered by every lower low since. `biasMid` = their midpoint.
Above biasMid = premium, below = discount.

**HTF trend bias.** The same leg-state / break algorithm run on completed 1H candles with length 10.
+1 after a bullish break, -1 after a bearish break. The current forming 1H candle is ignored (no repaint).

---

## 2. Liquidity sweep (swing tier only)

A **sweep of a high** happens on a bar where: high > last swing high (swing tier), the level's `crossed`
flag is still false, and (strict mode, default on) the bar closes back **below** that level. Mirror for lows.
If instead the bar closes above the level, that is a swing break, not a sweep.
The sweep bar index is stored (`sweepHiBar` / `sweepLoBar`).
Session-liquidity flag: true if the swept level is within 2 pips of the Asia (00:00–07:00 UTC) high/low,
London (07:00–12:00) high/low, or previous-day high/low.

---

## 3. Setup sequence

### TR2 (trend reversal 2, his favourite) — sell version, buy is the mirror
1. Swing high swept (section 2).
2. Within `SweepMaxBars` = 60 bars: an **internal bearish CHoCH** (close below the last internal swing low
   while internal bias was +1). Store `chochBearBar`. If no sweep happened within 60 bars before it, the
   CHoCH does not qualify (`chochBearBar` stays unset).
3. Within `ChochMaxBars` = 60 bars after that CHoCH: an **internal bearish BOS** (close below the next
   internal swing low, internal bias already -1) **with displacement**: candle body >= 1.2 × average body of
   the last 10 candles. This is the "consolidation break". **[interpretation]**: he says "break with volume";
   1.2 × average body is my proxy.

### TC (trend continuation) — sell version
- Swing bias = -1, and an internal bearish BOS with displacement occurs. No sweep/CHoCH needed.
- A bar that qualifies as TR2 is never also TC.

### Consolidation
The consolidation = the candles from the broken internal swing low up to (not including) the break candle.
`lookN` = break bar index − broken swing low bar index. Its high `cH` and low `cL` are the highest high /
lowest low of those bars plus the break bar.

---

## 4. Zone (supply / demand)

For a sell: among the consolidation candles, take the one with the **highest high** whose range is
**< 2 × ATR(200)** (very large candles are ignored, LuxAlgo-style). For a buy: lowest low.
This is the "last opposite / indecision candle before the impulse" = order block.
**[interpretation]**: he says "freshest zone" and "most extreme 15m zone" in different lessons; the extreme
candle of the consolidation is used. Reviewer may test the alternative (last opposite candle before the break).

- Zone body = open/close of that candle; zone wick = high/low.
- `entry` = proximal edge: body bottom for a sell (or wick low if `EntryBody=false`); body top for a buy.
- `SL` = distal wick + buffer: wick high + 3 pips (sell), wick low − 3 pips (buy).
- **Reject the zone if SL distance > 28 pips.** (No lower-timeframe refinement is attempted — [interpretation].)
- Imbalance flag: gap between the zone candle and the candle two bars later (3-candle FVG).

### Filters applied at zone creation (zone is not created if any fails)
- **Premium/discount**: sell entry must be >= `biasMid`; buy entry <= `biasMid`.
- **HTF trend**: sell only if HTF bias = -1; buy only if HTF bias = +1.
- **Score >= 5** (see section 8).

### Zone state
- `anchor` = consolidation high `cH` (sell) / low `cL` (buy) = fib 1.0.
- `ext` = the break bar's low (sell) / high (buy), then extended with every lower low / higher high while the
  zone is untouched = fib 0.0 = the **ultimate target**.
- Only one active zone at a time; a new qualifying setup replaces an untouched older one.

---

## 5. Arming (Fibonacci gate) and the retest

Every bar while untouched:
- `rng = |anchor − ext|`; gate = `ext + 0.764 × rng` (sell) / `ext − 0.764 × rng` (buy).
- **Armed** if entry is at/beyond the gate (sell: entry >= gate − 1 pip) **and** the ultimate target is at
  least `MinTargetRR` = 2 × the stop distance away from the entry.
- **Touch** = first bar with high >= entry (sell) / low <= entry (buy), after the creation bar.
- A touch counts as a valid signal only if the zone is armed **and** the touch bar is inside the session
  window (07:00–15:00 UTC, not Friday after 13:00 UTC). Otherwise the touch is logged and the zone is spent
  (one touch only — "first retest").

---

## 6. Entry

**Reaction mode (default).** After a valid touch, wait up to 6 bars for a candle that closes back
**beyond the zone body** in the trade direction (sell: close < body bottom and close < open). Enter at that
close (market, filled next bar open). `SL` is recomputed = extreme wick made since the touch + 3 pips
(sell: highest high since touch). Reject if that SL > 28 pips or the target is < 2R away.
The wait is cancelled if a candle closes through the far wick of the zone (sell: close > wick high).
**[interpretation]**: he moved from limit at the tip to market after the reaction because "price overshoots
the tip"; the exact reaction candle he wants is not defined.

**Limit mode.** Pending order at `entry` while the zone is armed and inside the session; original SL.

---

## 7. Zone cancellation
An untested zone is removed when: a close beyond its SL level; 100 bars since creation; or (default on)
internal structure flips against it — for a sell zone, a bullish internal CHoCH or a bullish swing break.
**[interpretation]**: this encodes "trade the first pullback of the new structure", learned from the losing
retests that came after the market had already reversed.

---

## 8. Confluence score (informational, min 5 to mark)
4 mandatory (structure, fib, zone, liquidity are implied by the sequence) + 1 each for: imbalance next to
the zone; session liquidity swept; zone candle formed 07:00–08:00 or 12:00–14:00 UTC (London / NY open
volume); model = TR2; SL <= 20 pips. Range 4–9. ATAS adds up to 4 orderflow points.

---

## 9. Management (strategy / EA / backtest)
- Position size: risk 1% of equity over the stop distance.
- Breakeven: stop moved to entry once price has been 1R in profit.
- Partials: 50% at 2R, 30% at 3R (limits). Remaining 20% exits at the ultimate target (`ext`).
- Time stop: 288 bars (one day on 5m).
- Max 2 trades per day (EA), one open position at a time.
- Costs: 1 pip slippage per side in TradingView; MT5 uses real spread from tick data; Python deducts 2 pips
  round trip.

---

## 10. Things the code does NOT do (known gaps vs the lessons)
- No news filter (CPI/NFP/GDP).
- No POC / session volume profile confluence (needs volume; ATAS version approximates with footprint).
- No lower-timeframe refinement of a zone whose stop is > 28 pips; such zones are skipped.
- TR1 model is not implemented (he no longer trades it).
- Consolidation is defined by internal structure, not by eye.

## 11. Suspected weak points for a reviewer to check first
1. Zone choice inside the consolidation (extreme vs last opposite candle).
2. Displacement threshold 1.2 × average body.
3. Whether the sweep should be allowed to be the same bar that later forms the swing high (currently the
   swing high must already be registered, i.e. confirmed 50 bars later, before it can be swept).
4. Internal length 5 vs 3 on the 5m chart.
5. Reaction rule: close beyond the zone body vs simply a close in the trade direction.
