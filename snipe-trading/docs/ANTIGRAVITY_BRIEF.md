# Task brief for the local agent (Antigravity) — backtest the Snipe TR2 setup in MT5

You are on the user's Windows PC with MetaTrader 5 installed and the repository
`modernspacestyling/modren-space-styling`, branch `claude/great-bohr-k4uwrp`, folder `snipe-trading/`.
Goal: produce verified backtest results for the Snipe TR2/TC gold setup and report them back. Do not change
the strategy rules; only fix compile errors, environment issues, and report what you find.

## 1. Clone and locate files
```
git clone -b claude/great-bohr-k4uwrp https://github.com/modernspacestyling/modren-space-styling.git
cd modren-space-styling/snipe-trading
```
- `mt5/SnipeTR2.mq5` – Expert Advisor (the strategy).
- `backtest/` – Python engine (`run_backtest.py`, package `snipe_bt`).
- `data/signals.json` – 305 posted channel signals (entry, SL, direction, UTC time).
- `docs/SETUP_EXPLAINED.md` – the rules, read it once so you understand what is being tested.

## 2. Compile and run the EA in the MT5 Strategy Tester
1. Copy `mt5/SnipeTR2.mq5` into `<MT5 data folder>\MQL5\Experts\` (find the data folder via MT5 → File → Open Data Folder).
2. Compile with MetaEditor: `metaeditor64.exe /compile:"<path>\SnipeTR2.mq5" /log`. If there are compile errors, fix them
   minimally (syntax, includes, API names) and record what you changed. Keep the logic identical.
3. Determine the broker's server time offset from UTC (compare the Market Watch time with UTC) and note it.
4. Run the tester. Preferred: launch headless with an ini file so results land in a report file:
   ```
   [Tester]
   Expert=SnipeTR2
   Symbol=XAUUSD          ; use the broker's exact gold symbol (XAUUSD, GOLD, XAUUSD.z ...)
   Period=M5
   Model=0                ; 0 = every tick based on real ticks
   FromDate=2025.01.01
   ToDate=2026.09.01
   Deposit=100000
   Currency=USD
   Leverage=1:100
   Report=snipe_m5_report
   ReplaceReport=1
   ShutdownTerminal=1
   ```
   Save as `tester.ini`, run `terminal64.exe /config:tester.ini`. Set the EA input `ServerUTCOffset` in a
   `[TesterInputs]` section (e.g. `ServerUTCOffset=3`). If the ini route is not available, run it manually
   in the Strategy Tester UI with the same settings and save the report (right-click → Save as report, HTML).
5. Repeat for Period=M15. Optionally one run with `TrendFilter=false` and one with `ReactionEntry=false` to
   show the effect of those two rules.
6. Collect from each report: total trades, net profit, profit factor, max drawdown %, win rate, average
   win/loss, expected payoff, and the equity curve image. Also copy the deals list (CSV/HTML).

## 3. Export M1 history and run the Python backtest (second, independent result)
1. `pip install MetaTrader5 pandas numpy matplotlib`
2. Pull history via the MT5 Python API (works while the terminal is open and logged in):
   ```python
   import MetaTrader5 as mt5, pandas as pd, datetime as dt
   mt5.initialize(); sym = "XAUUSD"   # broker symbol
   rates = mt5.copy_rates_range(sym, mt5.TIMEFRAME_M1, dt.datetime(2024,9,1), dt.datetime(2026,9,1))
   df = pd.DataFrame(rates); df["time"] = pd.to_datetime(df["time"], unit="s")
   df.rename(columns={"tick_volume":"volume"})[["time","open","high","low","close","volume"]].to_csv("XAUUSD_M1.csv", index=False)
   mt5.shutdown()
   ```
   MT5 timestamps are server time; note the offset for the next step.
3. Run the engine (offset = hours server time is ahead of UTC, e.g. 3):
   ```
   cd backtest
   python run_backtest.py --bars ../XAUUSD_M1.csv --tz-offset 3 --tf 5  --signals ../data/signals.json --out results_5m
   python run_backtest.py --bars ../XAUUSD_M1.csv --tz-offset 3 --tf 15 --signals ../data/signals.json --out results_15m
   ```
   Each run writes `REPORT.md`, `setups_tf*.csv`, `signal_replay.csv`, `equity_*.png`. The signal replay
   gives the real outcome of the 305 posted channel signals; the detector section gives the rule-based results.

## 4. Report back (paste into the chat with Claude)
- Broker, symbol, server UTC offset, data range actually available, tick-data quality reported by the tester.
- Table per run (M5, M15, and any variants): trades, win rate, profit factor, net profit, max DD, avg R.
- Attach or paste `REPORT.md` from both Python runs and the MT5 HTML reports.
- Any compile fixes you made (file + line + change).
- The three worst and three best trades with timestamps so the rules can be checked against the chart.

Do not tune inputs to improve the numbers. The purpose of this pass is to measure the rules as written.
