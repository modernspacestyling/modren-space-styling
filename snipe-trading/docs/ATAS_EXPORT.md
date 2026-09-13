# Exporting gold data from ATAS for the backtest

The backtest needs **1-minute bars with orderflow columns** (delta, bid, ask). Two ways to get them.

## Option A (recommended): the exporter indicator in this repo

1. Build `atas/SnipeTrading.csproj` in Visual Studio (Class Library, .NET 8 or .NET 10 to match your ATAS build,
   references point at `C:\Program Files (x86)\ATAS Platform\` — fix the path if ATAS lives elsewhere).
2. Copy `SnipeTrading.dll` to `%APPDATA%\ATAS\Indicators` (or use *Indicators → Add custom indicator*).
3. Open a chart of the gold instrument you trade against (XAUUSD CFD from your broker feed, or `GC` COMEX futures
   for real exchange volume), timeframe **1 minute**, and load as many days as your data plan allows
   (period settings → number of days). 60+ days is the minimum for a meaningful result; 250+ is ideal.
4. Add the indicator **Snipe Data Exporter (CSV)**. Set *Output folder* (default `C:\snipe_export`).
   Keep *Export price levels* on if you want the footprint imbalance filter tested (large file, fine).
5. Wait until the ATAS log (top toolbar → Logs) shows `Snipe export done: ...`. Two files appear:
   `XAUUSD_1m_bars_<stamp>.csv` and `XAUUSD_1m_levels_<stamp>.csv`.
6. Zip them and upload to the shared Google Drive folder (`snipe_trading_pro` or a new `atas_export` folder).

Times in the export are written in UTC already, so run the backtest with `--tz-offset 0`.

## Option B: ATAS built-in export (bars only)

Right-click the chart → **Export** → CSV. This gives OHLCV without delta. The detector and the signal replay
still work; the orderflow filters are skipped. If the file times are in your local time, pass
`--tz-offset <hours ahead of UTC>` (e.g. Melbourne AEST = 10).

## Running the backtest

```bash
cd snipe-trading/backtest
pip install pandas numpy matplotlib
# rule-based detector on 15m built from the M1 export, fills simulated on M1, orderflow filters evaluated
python run_backtest.py --bars C:\snipe_export\XAUUSD_1m_bars_x.csv --levels C:\snipe_export\XAUUSD_1m_levels_x.csv --tf 15 --out results_15m
# same on 5m
python run_backtest.py --bars ... --levels ... --tf 5 --out results_5m
# replay the 305 posted channel signals (true win rate of what the channel called)
python run_backtest.py --bars ... --signals ../data/signals.json --replay-only --out results_signals
```

Outputs per run: `REPORT.md` (stats, breakdowns by model / direction / score / hour / orderflow filter),
`setups_tf<N>.csv` or `signal_replay.csv` (every trade), `equity_*.png`.

Useful switches: `--min-score 6`, `--max-sl 20`, `--no-tc`, `--be-rr 0` (never breakeven), `--spread 3`.
