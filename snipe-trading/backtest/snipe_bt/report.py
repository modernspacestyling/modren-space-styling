from __future__ import annotations
import json
import numpy as np
import pandas as pd
from .sim import summarise

def fmt_stats(s: dict) -> str:
    if s.get("n", 0) == 0: return "| n | 0 |\n"
    rows = [("Trades", s["n"]), ("Win rate", f"{s['win_rate']*100:.1f}%"), ("Avg R", f"{s['avg_R']:.2f}"), ("Median R", f"{s['median_R']:.2f}"),
            ("Total R", f"{s['total_R']:.1f}"), ("Profit factor", f"{s['profit_factor']:.2f}"), ("Max drawdown (R)", f"{s['max_dd_R']:.1f}"),
            ("Avg win R", f"{s['avg_win_R']:.2f}"), ("Avg loss R", f"{s['avg_loss_R']:.2f}")]
    return "| Metric | Value |\n|---|---|\n" + "\n".join(f"| {k} | {v} |" for k, v in rows) + "\n"

def breakdown(df: pd.DataFrame, col: str) -> str:
    if df.empty or col not in df: return ""
    out = ["| " + col + " | n | win% | avg R | total R |", "|---|---|---|---|---|"]
    for k, g in df.groupby(col):
        s = summarise(g["r"].tolist())
        out.append(f"| {k} | {s['n']} | {s['win_rate']*100:.0f}% | {s['avg_R']:.2f} | {s['total_R']:.1f} |")
    return "\n".join(out) + "\n"

def equity_png(rs, path):
    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
        eq = np.cumsum(rs); plt.figure(figsize=(9, 3.5)); plt.plot(eq, lw=1.5); plt.axhline(0, color="gray", lw=.5)
        plt.title("Equity (R multiples)"); plt.xlabel("trade #"); plt.ylabel("R"); plt.tight_layout(); plt.savefig(path, dpi=110); plt.close()
    except Exception as e:
        print("plot skipped:", e)
