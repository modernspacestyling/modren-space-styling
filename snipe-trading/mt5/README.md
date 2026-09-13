# MT5 backtest

## A. Run the EA in the Strategy Tester
1. MetaEditor → File → Open `SnipeTR2.mq5` → Compile (F7). Copy the .ex5 to `MQL5\Experts` (or open the file from there).
2. MT5 → View → Strategy Tester. Expert: SnipeTR2. Symbol: XAUUSD (your broker's gold symbol). Timeframe: M5 or M15.
   Modelling: **Every tick based on real ticks**. Deposit 100000 USD. Leverage as your account.
3. Inputs: set `ServerUTCOffset` to your broker's offset (most are UTC+2 winter / UTC+3 summer; check the Market Watch clock vs UTC).
4. Start. Read the Backtest tab (net profit, profit factor, drawdown, trades) and the Graph tab. Right-click the report → Save as report for me.

The EA mirrors `tradingview/SnipeSetup.pine` v3: swing/internal structure with leg-state pivots, sweep → CHoCH → consolidation break, order-block zone, 0.764 gate, 2R-to-target, 1H trend filter, reaction entry, 28-pip cap, London→NY window, partials 50% at 2R / 30% at 3R, breakeven at 1R, runner to the leg extreme, time stop.

## B. Export M1 history so the Python backtest can run on real data
1. MT5 → View → Symbols → select XAUUSD → **Bars** tab.
2. Timeframe M1, set the date range as far back as your broker allows (F2 window; press "Request" if bars are missing).
3. **Export Bars** → save as `XAUUSD_M1.csv`.
4. Upload to the shared Google Drive folder and tell me the broker's UTC offset. I run:
   `python run_backtest.py --bars XAUUSD_M1.csv --tz-offset <offset> --tf 5 --signals ../data/signals.json`
