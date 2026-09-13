"""Data loaders. Accepts:
  * the SnipeDataExporter CSV (time_utc,open,high,low,close,volume,delta,bid,ask,max_delta,min_delta,poc_price,poc_volume,ticks)
  * the optional levels CSV (time_utc,price,volume,bid,ask)
  * ATAS built-in "Export" CSV, MT5 / TradingView / Dukascopy style OHLC(V) CSVs (columns auto-detected)
Everything is normalised to a pandas DataFrame indexed by UTC timestamp with
columns open, high, low, close, volume (+ delta, bid, ask, max_delta, min_delta, poc_price when present).
"""
from __future__ import annotations
import re
import numpy as np
import pandas as pd

_ALIASES = {
    "time": ["time_utc", "time", "datetime", "date_time", "timestamp", "date", "gmt time", "<date>", "local time"],
    "open": ["open", "<open>", "o"], "high": ["high", "<high>", "h"], "low": ["low", "<low>", "l"], "close": ["close", "<close>", "c"],
    "volume": ["volume", "vol", "<vol>", "<tickvol>", "tickvol", "tick_volume"],
    "delta": ["delta"], "bid": ["bid", "bid_volume"], "ask": ["ask", "ask_volume"],
    "max_delta": ["max_delta", "maxdelta"], "min_delta": ["min_delta", "mindelta"],
    "poc_price": ["poc_price", "poc"], "poc_volume": ["poc_volume"], "ticks": ["ticks", "trades"],
}

def _find(cols, names):
    lc = {c.lower().strip(): c for c in cols}
    for n in names:
        if n in lc:
            return lc[n]
    return None

def load_bars(path: str, tz_offset_hours: float = 0.0) -> pd.DataFrame:
    """Load any OHLC csv. tz_offset_hours: hours to SUBTRACT to convert the file's time to UTC
    (e.g. MT5 broker time UTC+3 in summer -> 3)."""
    sep = None
    with open(path, "r", encoding="utf-8-sig", errors="ignore") as f:
        head = f.readline()
    for cand in [",", ";", "\t"]:
        if cand in head:
            sep = cand; break
    df = pd.read_csv(path, sep=sep or ",", engine="python")
    cols = list(df.columns)
    tcol = _find(cols, _ALIASES["time"])
    if tcol is None:
        # MT5 export has separate <DATE> and <TIME>
        d = _find(cols, ["<date>", "date"]); t = _find(cols, ["<time>", "time"])
        if d is not None and t is not None:
            df["__time"] = df[d].astype(str) + " " + df[t].astype(str); tcol = "__time"
        else:
            raise ValueError(f"no time column in {cols}")
    out = pd.DataFrame()
    ts = pd.to_datetime(df[tcol], utc=False, errors="coerce", format="mixed")
    out["time"] = ts - pd.Timedelta(hours=tz_offset_hours)
    for k in ["open", "high", "low", "close", "volume", "delta", "bid", "ask", "max_delta", "min_delta", "poc_price", "poc_volume", "ticks"]:
        c = _find(cols, _ALIASES[k])
        if c is not None:
            out[k] = pd.to_numeric(df[c], errors="coerce")
    if "volume" not in out:
        out["volume"] = 0.0
    out = out.dropna(subset=["time", "open", "high", "low", "close"]).sort_values("time")
    out = out.drop_duplicates("time").set_index("time")
    out.index = pd.DatetimeIndex(out.index).tz_localize(None)
    return out

def load_levels(path: str, tz_offset_hours: float = 0.0) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["time"] = pd.to_datetime(df["time_utc"], format="mixed") - pd.Timedelta(hours=tz_offset_hours)
    return df[["time", "price", "volume", "bid", "ask"]]

def resample(df: pd.DataFrame, minutes: int) -> pd.DataFrame:
    """Aggregate M1 bars to an N-minute timeframe (UTC boundaries)."""
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    for k in ["delta", "bid", "ask", "ticks"]:
        if k in df: agg[k] = "sum"
    if "max_delta" in df: agg["max_delta"] = "max"
    if "min_delta" in df: agg["min_delta"] = "min"
    r = df.resample(f"{minutes}min", label="left", closed="left").agg(agg).dropna(subset=["open"])
    return r

def synthetic_gold(n_days: int = 60, seed: int = 7, start="2026-03-02") -> pd.DataFrame:
    """Random-walk M1 gold-like series with sessions, ONLY for smoke-testing the pipeline."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=n_days * 1440, freq="1min")
    idx = idx[idx.dayofweek < 5]
    n = len(idx); h = idx.hour
    vol = np.where((h >= 7) & (h < 16), 1.0, 0.35)  # more movement in London/NY
    ret = rng.normal(0, 0.9, n) * vol  # ~0.9 $/min std in session
    # add regime drift and occasional impulses
    drift = np.cumsum(rng.normal(0, 0.03, n))
    imp = np.zeros(n); k = rng.integers(0, n, n // 300); imp[k] = rng.normal(0, 8, len(k))
    close = 3300 + np.cumsum(ret + imp) + drift
    o = np.r_[close[0], close[:-1]]
    hi = np.maximum(o, close) + np.abs(rng.normal(0, 0.5, n)) * vol
    lo = np.minimum(o, close) - np.abs(rng.normal(0, 0.5, n)) * vol
    v = (rng.gamma(2.0, 60, n) * vol).round()
    delta = rng.normal(0, 0.3, n) * v
    df = pd.DataFrame({"open": o, "high": hi, "low": lo, "close": close, "volume": v, "delta": delta,
                       "bid": (v - delta) / 2, "ask": (v + delta) / 2, "max_delta": np.abs(delta) + 5, "min_delta": -np.abs(delta) - 5}, index=idx)
    return df
