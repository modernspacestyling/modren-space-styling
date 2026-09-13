# Snipe Trading setup — indicators + backtest

Reverse-engineered from the Snipe Vault course (63 lesson transcripts, 2022-2026), 1,983 chart screenshots
and 305 posted gold signals (Sep 2024 – Aug 2026). Instrument: XAUUSD. Timeframes: 3m/5m/15m setups, M1 execution.

| Folder | What |
|---|---|
| `docs/SETUP_EXPLAINED.md` | Plain-language explanation of the setup, what is mechanical, what he leaves discretionary, and how this code resolves it |
| `tradingview/SnipeSetup.pine` | Pine v5 indicator: marks sweep, CHOCH, consolidation box, break, zone, fib gate, entry/SL/TP, score, alerts |
| `atas/SnipeOrderflow.cs` | ATAS indicator: same logic + orderflow confirmation (delta, absorption, stacked imbalance, delta divergence) |
| `atas/SnipeDataExporter.cs` | ATAS indicator that dumps the loaded history (bars + footprint) to CSV for the backtest |
| `backtest/` | Python engine: detector, M1 fill simulation with his partial ladder, posted-signal replay, orderflow filter evaluation |
| `data/signals.json` | The 305 posted signals (entry, SL, direction, UTC time) |
| `docs/ATAS_EXPORT.md` | How to export from ATAS and run the backtest |

Quick smoke test (synthetic data, no edge expected):
```bash
cd backtest && pip install pandas numpy matplotlib && python run_backtest.py --synthetic --tf 5 --out results_synth
```
