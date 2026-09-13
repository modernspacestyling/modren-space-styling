"""Orderflow features on the zone-touch bar (needs delta/bid/ask columns; levels optional)."""
from __future__ import annotations
import numpy as np
import pandas as pd

def touch_features(bars: pd.DataFrame, pos: int, bear: bool, born_pos: int, levels: pd.DataFrame | None = None,
                   imb_ratio: float = 3.0, imb_stack: int = 3, abs_vol_mult: float = 1.5, abs_body: float = 0.35) -> dict:
    row = bars.iloc[pos]; f = {}
    has_of = "delta" in bars.columns and not np.isnan(row.get("delta", np.nan))
    f["has_orderflow"] = bool(has_of)
    if not has_of: return f
    d = float(row["delta"]); v = float(row["volume"]); rng = float(row["high"] - row["low"]); bd = abs(float(row["close"] - row["open"]))
    av = float(bars["volume"].iloc[max(0, pos - 20):pos].mean()) if pos > 0 else 0.0
    f["delta_agrees"] = bool(d < 0) if bear else bool(d > 0)
    f["absorption"] = bool(av > 0 and v >= abs_vol_mult * av and rng > 0 and bd <= abs_body * rng)
    f["rel_volume"] = float(v / av) if av > 0 else np.nan
    f["delta_pct"] = float(d / v) if v > 0 else np.nan
    # delta divergence vs the leg
    if "max_delta" in bars.columns and "min_delta" in bars.columns:
        leg = bars.iloc[born_pos:pos]
        if len(leg):
            f["delta_divergence"] = bool(row["max_delta"] < leg["max_delta"].max()) if bear else bool(row["min_delta"] > leg["min_delta"].min())
    # stacked imbalances from footprint levels
    f["stacked_imbalance"] = False
    if levels is not None and len(levels):
        lv = levels[levels["time"] == bars.index[pos]].sort_values("price")
        if len(lv) > 1:
            bid = lv["bid"].to_numpy(float); ask = lv["ask"].to_numpy(float); stack = best = 0
            for i in range(1, len(lv)):
                imb = (ask[i - 1] > 0 and bid[i] >= imb_ratio * ask[i - 1]) if bear else (bid[i - 1] > 0 and ask[i] >= imb_ratio * bid[i - 1])
                stack = stack + 1 if imb else 0; best = max(best, stack)
            f["stacked_imbalance"] = bool(best >= imb_stack)
    f["of_score"] = int(f.get("delta_agrees", False)) + int(f.get("absorption", False)) + int(f.get("stacked_imbalance", False)) + int(f.get("delta_divergence", False))
    return f
