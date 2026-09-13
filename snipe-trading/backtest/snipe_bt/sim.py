"""Trade simulation with the Snipe management ladder.

Default ladder (from the lessons): breakeven at 1:1, 50% off at 1:2, 30% off at 1:3,
20% runner to the ultimate target (leg extreme / fib 0) with a wide time stop.
Intrabar ambiguity: if a bar touches both a target and the stop, the STOP is assumed first
(conservative). Results are in R multiples (1R = initial risk) and in pips.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import List, Tuple, Optional
import numpy as np
import pandas as pd

@dataclass
class Ladder:
    be_rr: float = 1.0                 # move SL to entry once this RR is reached (0 = never)
    partials: Tuple[Tuple[float, float], ...] = ((2.0, 0.5), (3.0, 0.3))   # (RR, fraction closed)
    runner_to_target: bool = True      # remaining fraction exits at target price
    max_bars: int = 24 * 60            # time stop in bars of the simulation series (M1 default: 1 day)
    spread_pips: float = 2.0           # round-trip cost in pips deducted from every trade
    pip: float = 0.10

@dataclass
class TradeResult:
    r_multiple: float
    pips: float
    outcome: str          # "SL", "BE", "PARTIAL", "TARGET", "TIME"
    bars_held: int
    max_rr: float         # best RR reached before exit (MFE)
    min_rr: float         # worst RR before exit (MAE)
    hit_1r: bool
    hit_2r: bool
    hit_3r: bool
    hit_target: bool

def simulate(m1: pd.DataFrame, start_pos: int, bear: bool, entry: float, sl: float, target: Optional[float], ladder: Ladder = Ladder(), wait_fill_bars: int = 0) -> TradeResult:
    """wait_fill_bars > 0: treat `entry` as a LIMIT order and wait (up to that many bars) for price to touch it.
    On the fill bar only the stop is evaluated (the favourable excursion of that bar may have happened before the fill)."""
    h = m1["high"].to_numpy(float); l = m1["low"].to_numpy(float); N = len(h)
    risk = abs(entry - sl)
    if risk <= 0: return TradeResult(0, 0, "INVALID", 0, 0, 0, False, False, False, False)
    sgn = -1.0 if bear else 1.0
    def rr_of(price): return sgn * (price - entry) / risk
    fill_pos = start_pos
    if wait_fill_bars > 0:
        fill_pos = -1
        for j in range(start_pos, min(N, start_pos + wait_fill_bars)):
            if (h[j] >= entry) if bear else (l[j] <= entry):
                fill_pos = j; break
        if fill_pos < 0: return TradeResult(0, 0, "NOFILL", 0, 0, 0, False, False, False, False)
    open_frac = 1.0; realised = 0.0; cur_sl = sl; max_rr = 0.0; min_rr = 0.0
    partial_idx = 0; be_done = ladder.be_rr <= 0
    hit = {1: False, 2: False, 3: False, "t": False}
    outcome = "TIME"; end = min(N, fill_pos + ladder.max_bars); i = fill_pos; start_pos = fill_pos
    for i in range(fill_pos, end):
        hi, lo = h[i], l[i]
        best = rr_of(hi if not bear else lo); worst = rr_of(lo if not bear else hi)
        # stop first (conservative)
        stop_hit = (hi >= cur_sl) if bear else (lo <= cur_sl)
        if stop_hit:
            realised += open_frac * rr_of(cur_sl); open_frac = 0.0
            outcome = "BE" if be_done and abs(cur_sl - entry) < 1e-9 else ("SL" if partial_idx == 0 else "PARTIAL")
            min_rr = min(min_rr, worst); break
        if i == fill_pos:
            min_rr = min(min_rr, worst); continue   # no favourable credit on the fill bar
        max_rr = max(max_rr, best); min_rr = min(min_rr, worst)
        for k in (1, 2, 3):
            if best >= k: hit[k] = True
        # partials
        while partial_idx < len(ladder.partials) and best >= ladder.partials[partial_idx][0]:
            rr, frac = ladder.partials[partial_idx]
            frac = min(frac, open_frac); realised += frac * rr; open_frac -= frac; partial_idx += 1
        if not be_done and best >= ladder.be_rr:
            cur_sl = entry; be_done = True
        # target
        if target is not None and ((lo <= target) if bear else (hi >= target)):
            hit["t"] = True
            if ladder.runner_to_target and open_frac > 0:
                realised += open_frac * rr_of(target); open_frac = 0.0; outcome = "TARGET"; break
        if open_frac <= 1e-9:
            outcome = "TARGET" if hit["t"] else "PARTIAL"; break
    else:
        # time stop: close remainder at last close
        if open_frac > 0 and end - 1 < N:
            realised += open_frac * rr_of(m1["close"].iloc[end - 1]); open_frac = 0.0
    cost = ladder.spread_pips * ladder.pip / risk
    r = realised - cost
    return TradeResult(r, r * risk / ladder.pip, outcome, i - start_pos + 1, max_rr, min_rr, hit[1], hit[2], hit[3], hit["t"])

def summarise(rs: List[float]) -> dict:
    a = np.array(rs, float)
    if len(a) == 0: return {"n": 0}
    wins = a[a > 0]; losses = a[a <= 0]
    pf = wins.sum() / abs(losses.sum()) if len(losses) and losses.sum() != 0 else float("inf")
    eq = np.cumsum(a); dd = (np.maximum.accumulate(eq) - eq).max() if len(eq) else 0
    return {"n": int(len(a)), "win_rate": float((a > 0).mean()), "avg_R": float(a.mean()), "median_R": float(np.median(a)),
            "total_R": float(a.sum()), "profit_factor": float(pf), "max_dd_R": float(dd), "avg_win_R": float(wins.mean()) if len(wins) else 0.0,
            "avg_loss_R": float(losses.mean()) if len(losses) else 0.0, "sharpe_per_trade": float(a.mean() / a.std()) if a.std() > 0 else 0.0}
