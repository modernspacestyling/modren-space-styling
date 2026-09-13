#!/usr/bin/env python3
"""Run the Snipe backtest.

Examples
  # rule-based detector on 15m built from your ATAS M1 export, simulate fills on M1, evaluate orderflow filters
  python run_backtest.py --bars export/XAUUSD_1m_bars.csv --levels export/XAUUSD_1m_levels.csv --tf 15 --out results/

  # replay the 305 posted channel signals against the same M1 data
  python run_backtest.py --bars export/XAUUSD_1m_bars.csv --signals ../data/signals.json --replay-only --out results/

  # smoke test on synthetic data (no edge expected, just proves the pipeline)
  python run_backtest.py --synthetic --tf 5 --out results_synth/
"""
from __future__ import annotations
import argparse, json, os, sys
from dataclasses import asdict
import numpy as np, pandas as pd
from snipe_bt.data import load_bars, load_levels, resample, synthetic_gold
from snipe_bt.detector import Params, detect
from snipe_bt.sim import Ladder, simulate, summarise
from snipe_bt.orderflow import touch_features
from snipe_bt.report import fmt_stats, breakdown, equity_png

def run_detector(m1: pd.DataFrame, tf: int, p: Params, ladder: Ladder, levels=None, of_filters=True):
    bars = resample(m1, tf) if tf > 1 else m1
    setups = detect(bars, p)
    m1_index = m1.index
    rows = []
    for s in setups:
        row = s.to_row(); row["tf"] = tf
        if s.valid_signal:
            # simulate on M1 from the first M1 bar after the touch bar opens (limit fill at entry)
            t_touch = s.time_touch
            if s.entry_mode == 'reaction':
                # market entry at the open of the first M1 bar after the reaction candle closes
                pos = m1_index.searchsorted(s.time_signal + pd.Timedelta(minutes=tf))
                if pos >= len(m1): continue
                fill = float(m1["open"].iloc[pos]); res = simulate(m1, pos, s.bear, fill, s.sl, s.tp2, ladder)
            else:
                pos = m1_index.searchsorted(t_touch)
                res = simulate(m1, pos, s.bear, s.entry, s.sl, s.tp2, ladder, wait_fill_bars=max(tf, 1) * 2)
            row.update({"r": res.r_multiple, "pips": res.pips, "outcome": res.outcome, "bars_held": res.bars_held, "mfe_rr": res.max_rr, "mae_rr": res.min_rr,
                        "hit_1r": res.hit_1r, "hit_2r": res.hit_2r, "hit_3r": res.hit_3r, "hit_target": res.hit_target})
            if res.outcome == "NOFILL": row["valid_signal"] = False; row["reason"] = "no M1 fill"
            if of_filters:
                bpos = bars.index.get_loc(t_touch)
                row.update(touch_features(bars, bpos, s.bear, bars.index.get_loc(s.time_born), levels))
        rows.append(row)
    return pd.DataFrame(rows), bars

def replay_signals(m1: pd.DataFrame, signals: list, ladder: Ladder):
    rows = []; idx = m1.index
    for sg in signals:
        t = pd.Timestamp(sg["date"]).tz_convert("UTC").tz_localize(None) if pd.Timestamp(sg["date"]).tzinfo else pd.Timestamp(sg["date"])
        if t < idx[0] or t > idx[-1]: continue
        pos = idx.searchsorted(t)
        bear = sg["direction"] == "SELL"; entry = float(sg["entry"]); sl = float(sg["sl"])
        if (bear and sl <= entry) or (not bear and sl >= entry): continue
        risk = abs(entry - sl)
        # channel posts "@ MARKET": assume fill at the open of the next M1 bar, keep his SL
        fill = float(m1["open"].iloc[pos]); slippage_r = (fill - entry) / risk * (-1 if bear else 1)
        res = simulate(m1, pos, bear, fill, sl, None, ladder)
        rows.append({"msg_id": sg["msg_id"], "time": t, "dir": sg["direction"], "entry": entry, "fill": fill, "sl": sl, "sl_pips": risk / ladder.pip,
                     "r": res.r_multiple, "outcome": res.outcome, "mfe_rr": res.max_rr, "mae_rr": res.min_rr, "hit_1r": res.hit_1r, "hit_2r": res.hit_2r, "hit_3r": res.hit_3r,
                     "hour": t.hour, "dow": t.day_name()[:3]})
    return pd.DataFrame(rows)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars"); ap.add_argument("--levels"); ap.add_argument("--signals"); ap.add_argument("--tf", type=int, default=15)
    ap.add_argument("--tz-offset", type=float, default=0.0, help="hours to subtract from file time to get UTC")
    ap.add_argument("--out", default="results"); ap.add_argument("--synthetic", action="store_true"); ap.add_argument("--replay-only", action="store_true")
    ap.add_argument("--min-score", type=int, default=5); ap.add_argument("--max-sl", type=float, default=28); ap.add_argument("--no-tc", action="store_true")
    ap.add_argument("--entry", default="reaction", choices=["reaction", "limit"]); ap.add_argument("--be-rr", type=float, default=1.0); ap.add_argument("--spread", type=float, default=2.0)
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    if a.synthetic: m1 = synthetic_gold(); levels = None; src = "SYNTHETIC random walk (no edge expected)"
    else:
        if not a.bars: sys.exit("--bars required (or --synthetic)")
        m1 = load_bars(a.bars, a.tz_offset); levels = load_levels(a.levels, a.tz_offset) if a.levels else None; src = a.bars
    ladder = Ladder(be_rr=a.be_rr, spread_pips=a.spread)
    md = [f"# Snipe backtest report\n\nSource: `{src}`  \nBars: {len(m1)} M1 from {m1.index[0]} to {m1.index[-1]} (UTC)  \nLadder: BE at {ladder.be_rr}R, partials {ladder.partials}, runner to target, spread {ladder.spread_pips} pips\n"]
    if not a.replay_only:
        p = Params(min_score=a.min_score, max_sl_pips=a.max_sl, use_tc=not a.no_tc, entry_mode=a.entry)
        df, bars = run_detector(m1, a.tf, p, ladder, levels)
        df.to_csv(os.path.join(a.out, f"setups_tf{a.tf}.csv"), index=False)
        sig = df[df.get("valid_signal", pd.Series(dtype=bool)) == True] if len(df) else df
        md.append(f"\n## Rule-based detector on {a.tf}m ({len(df)} zones created, {len(sig)} valid signals)\n")
        md.append("Zone outcomes: " + json.dumps(df["reason"].value_counts().to_dict() if len(df) else {}) + "\n")
        if len(sig):
            md.append(fmt_stats(summarise(sig["r"].tolist())))
            md.append("\n### By model\n" + breakdown(sig, "model")); md.append("\n### By direction\n" + breakdown(sig.assign(dir=np.where(sig["bear"], "SELL", "BUY")), "dir"))
            md.append("\n### By score\n" + breakdown(sig, "score")); md.append("\n### By hour (UTC)\n" + breakdown(sig.assign(hour=pd.to_datetime(sig["time_touch"]).dt.hour), "hour"))
            md.append(f"\nReached 1R: {sig['hit_1r'].mean()*100:.0f}%  2R: {sig['hit_2r'].mean()*100:.0f}%  3R: {sig['hit_3r'].mean()*100:.0f}%  ultimate target: {sig['hit_target'].mean()*100:.0f}%\n")
            if "of_score" in sig and sig["has_orderflow"].any():
                md.append("\n### Orderflow filters (at the touch bar)\n")
                for col in ["delta_agrees", "absorption", "stacked_imbalance", "delta_divergence"]:
                    if col in sig: md.append(breakdown(sig, col))
                md.append(breakdown(sig, "of_score"))
            equity_png(sig["r"].tolist(), os.path.join(a.out, f"equity_tf{a.tf}.png"))
    if a.signals:
        signals = json.load(open(a.signals)); signals = signals["signals"] if isinstance(signals, dict) else signals
        rp = replay_signals(m1, signals, ladder); rp.to_csv(os.path.join(a.out, "signal_replay.csv"), index=False)
        md.append(f"\n## Replay of {len(rp)} posted channel signals inside the data window\n")
        if len(rp):
            md.append(fmt_stats(summarise(rp["r"].tolist()))); md.append("\n### By direction\n" + breakdown(rp, "dir")); md.append("\n### By hour\n" + breakdown(rp, "hour"))
            md.append(f"\nReached 1R: {rp['hit_1r'].mean()*100:.0f}%  2R: {rp['hit_2r'].mean()*100:.0f}%  3R: {rp['hit_3r'].mean()*100:.0f}%  stopped at full loss: {(rp['outcome']=='SL').mean()*100:.0f}%\n")
            equity_png(rp["r"].tolist(), os.path.join(a.out, "equity_signals.png"))
    open(os.path.join(a.out, "REPORT.md"), "w").write("\n".join(md)); print("\n".join(md))

if __name__ == "__main__":
    main()
