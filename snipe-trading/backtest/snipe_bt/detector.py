"""Mechanical Snipe setup detector v3 — mirrors tradingview/SnipeSetup.pine and atas/SnipeOrderflow.cs.

Two-tier structure (swing = external, internal = minor), one-sided swing confirmation:
  TR2 sell: swing HIGH swept (wick through, close back under) -> internal CHoCH (close under the last
            internal low while internal bias is bullish) -> internal BOS with displacement (consolidation
            break) -> zone = bearish order block of that BOS (highest normal-range candle between the broken
            internal low and the break bar) -> fib: consolidation high (1.0) -> running low (0.0); armed
            when the zone entry is at/beyond 0.764 and the ultimate target is >= min_target_rr away
            -> reaction entry (close back under the zone) or limit at the edge.
  TC sell : swing bias bearish + internal BOS (not CHoCH) -> same zone logic.
  Bias    : sells only in the premium half of the trailing swing range, buys in the discount half.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import List, Optional
import numpy as np
import pandas as pd

@dataclass
class Params:
    swing_len: int = 50
    int_len: int = 5
    strict_sweep: bool = True
    sweep_max_bars: int = 60
    choch_max_bars: int = 60
    disp_mult: float = 1.2
    use_tr2: bool = True
    use_tc: bool = True
    fib: float = 0.764
    min_target_rr: float = 2.0
    bias_filter: bool = True
    trend_filter: bool = True
    trend_tf: int = 60
    trend_len: int = 10
    entry_body: bool = True
    entry_mode: str = "reaction"   # or "limit"
    react_max_bars: int = 6
    max_sl_pips: float = 28.0
    sl_buf_pips: float = 3.0
    zone_life: int = 100
    cancel_on_flip: bool = True
    vol_mult: float = 2.0
    pip: float = 0.10
    sess_start: int = 7
    sess_end: int = 15
    skip_fri_pm: bool = True
    min_score: int = 5
    require_armed: bool = True

@dataclass
class Setup:
    idx_born: int; time_born: pd.Timestamp; bear: bool; model: str
    zone_top: float; zone_bot: float; wick_top: float; wick_bot: float; zone_bar: int
    cons_high: float; cons_low: float; cons_start: int
    entry: float; sl: float; anchor: float; ext: float
    score: int; fvg: bool; sess_liq: bool; hi_vol_zone: bool
    armed: bool = False; touched: bool = False; idx_touch: Optional[int] = None; time_touch: Optional[pd.Timestamp] = None
    in_window: bool = False; valid_signal: bool = False; reason: str = ""; tp2: float = 0.0; sl_pips: float = 0.0
    entry_mode: str = "limit"; time_signal: Optional[pd.Timestamp] = None
    def to_row(self): return asdict(self)

def _atr(h, l, c, n):
    tr = np.r_[h[0] - l[0], np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))]
    return pd.Series(tr).rolling(n, min_periods=1).mean().to_numpy()

def swing_bias(df: pd.DataFrame, length: int) -> np.ndarray:
    """+1 / -1 / 0 per bar: bias after the last swing break (one-sided pivot confirmation)."""
    h = df["high"].to_numpy(float); l = df["low"].to_numpy(float); c = df["close"].to_numpy(float); N = len(df)
    out = np.zeros(N, int); sh = sl = np.nan; shx = slx = False; b = 0
    for i in range(length, N):
        if h[i - length] > h[i - length + 1:i + 1].max(): sh, shx = h[i - length], False
        if l[i - length] < l[i - length + 1:i + 1].min(): sl, slx = l[i - length], False
        if not np.isnan(sh) and not shx and c[i] > sh: shx = True; b = 1
        if not np.isnan(sl) and not slx and c[i] < sl: slx = True; b = -1
        out[i] = b
    return out

def htf_bias_for(df: pd.DataFrame, m1: pd.DataFrame, tf_minutes: int, length: int) -> np.ndarray:
    """Bias of the last COMPLETED higher-timeframe bar, aligned to df's index (no lookahead)."""
    from .data import resample
    htf = resample(m1, tf_minutes)
    b = swing_bias(htf, length)
    close_time = htf.index + pd.Timedelta(minutes=tf_minutes)
    ser = pd.Series(b, index=close_time).sort_index()
    aligned = ser.reindex(ser.index.union(df.index)).ffill().reindex(df.index).fillna(0)
    return aligned.to_numpy(int)

def detect(df: pd.DataFrame, p: Params = Params(), htf_bias: Optional[np.ndarray] = None) -> List[Setup]:
    if htf_bias is None: htf_bias = np.zeros(len(df), int)
    o = df["open"].to_numpy(float); h = df["high"].to_numpy(float); l = df["low"].to_numpy(float); c = df["close"].to_numpy(float)
    t = df.index; N = len(df)
    atr200 = _atr(h, l, c, 200)
    body = np.abs(c - o); avg_body = pd.Series(body).rolling(10).mean().to_numpy()
    hours = t.hour.to_numpy(); dows = t.dayofweek.to_numpy()
    in_window = (hours >= p.sess_start) & (hours < p.sess_end)
    if p.skip_fri_pm: in_window &= ~((dows == 4) & (hours >= 13))
    hi_vol = (hours == 7) | ((hours >= 12) & (hours < 14))
    # rolling max/min of the LAST n bars (excluding current) for one-sided pivot confirmation
    hs = pd.Series(h); ls = pd.Series(l)
    roll_hi_S = hs.rolling(p.swing_len).max().to_numpy(); roll_lo_S = ls.rolling(p.swing_len).min().to_numpy()
    roll_hi_I = hs.rolling(p.int_len).max().to_numpy();   roll_lo_I = ls.rolling(p.int_len).min().to_numpy()
    # session levels
    day_id = pd.factorize(t.normalize())[0]
    asia_h = np.full(N, np.nan); asia_l = np.full(N, np.nan); ldn_h = np.full(N, np.nan); ldn_l = np.full(N, np.nan); pd_h = np.full(N, np.nan); pd_l = np.full(N, np.nan)
    cur = -1; aH = aL = lH = lL = dH = dL = np.nan; prevH = prevL = np.nan
    for i in range(N):
        if day_id[i] != cur: prevH, prevL = dH, dL; cur = day_id[i]; aH = aL = lH = lL = np.nan; dH, dL = h[i], l[i]
        else: dH = max(dH, h[i]); dL = min(dL, l[i])
        if hours[i] < 7: aH = np.nanmax([aH, h[i]]); aL = np.nanmin([aL, l[i]])
        if 7 <= hours[i] < 12: lH = np.nanmax([lH, h[i]]); lL = np.nanmin([lL, l[i]])
        asia_h[i], asia_l[i], ldn_h[i], ldn_l[i], pd_h[i], pd_l[i] = aH, aL, lH, lL, prevH, prevL
    def sess_level(i, lvl, is_high):
        tol = 2 * p.pip; cands = [asia_h[i], ldn_h[i], pd_h[i]] if is_high else [asia_l[i], ldn_l[i], pd_l[i]]
        return any((not np.isnan(x)) and abs(lvl - x) <= tol for x in cands)

    setups: List[Setup] = []
    # swing tier
    sHigh = sLow = np.nan; sHighBar = sLowBar = -1; sHighX = sLowX = False; sBias = 0; trailTop = trailBot = np.nan
    sweep_hi_bar = sweep_lo_bar = -1; sweep_hi_sess = sweep_lo_sess = False
    # internal tier
    iHigh = iLow = np.nan; iHighBar = iLowBar = -1; iHighX = iLowX = False; iBias = 0
    choch_bear_bar = choch_bull_bar = -1; choch_bear_sess = choch_bull_sess = False
    act: Optional[Setup] = None; react_state = (0, 0.0)

    for i in range(p.swing_len + 1, N):
        # ---- swing tier
        sb = i - p.swing_len
        if h[sb] > roll_hi_S[i - 1] if i - 1 >= 0 else False:
            pass
        # one-sided confirmation: bar[i-size] higher than the following size bars (i-size+1 .. i)
        if h[i - p.swing_len] > h[i - p.swing_len + 1:i + 1].max():
            sHigh, sHighBar, sHighX = h[i - p.swing_len], i - p.swing_len, False; trailTop = sHigh
        if l[i - p.swing_len] < l[i - p.swing_len + 1:i + 1].min():
            sLow, sLowBar, sLowX = l[i - p.swing_len], i - p.swing_len, False; trailBot = sLow
        trailTop = h[i] if np.isnan(trailTop) else max(trailTop, h[i]); trailBot = l[i] if np.isnan(trailBot) else min(trailBot, l[i])
        bias_mid = (trailTop + trailBot) / 2
        sBullBreak = (not np.isnan(sHigh)) and (not sHighX) and c[i] > sHigh
        sBearBreak = (not np.isnan(sLow)) and (not sLowX) and c[i] < sLow
        if sBullBreak: sHighX = True; sBias = 1
        if sBearBreak: sLowX = True; sBias = -1
        sweepHi = (not np.isnan(sHigh)) and (not sHighX) and h[i] > sHigh and (not p.strict_sweep or c[i] < sHigh)
        sweepLo = (not np.isnan(sLow)) and (not sLowX) and l[i] < sLow and (not p.strict_sweep or c[i] > sLow)
        if sweepHi: sweep_hi_bar, sweep_hi_sess = i, sess_level(i, sHigh, True)
        if sweepLo: sweep_lo_bar, sweep_lo_sess = i, sess_level(i, sLow, False)
        # ---- internal tier
        if i - p.int_len >= 0 and h[i - p.int_len] > h[i - p.int_len + 1:i + 1].max():
            iHigh, iHighBar, iHighX = h[i - p.int_len], i - p.int_len, False
        if i - p.int_len >= 0 and l[i - p.int_len] < l[i - p.int_len + 1:i + 1].min():
            iLow, iLowBar, iLowX = l[i - p.int_len], i - p.int_len, False
        iBullBreak = (not np.isnan(iHigh)) and (not iHighX) and c[i] > iHigh
        iBearBreak = (not np.isnan(iLow)) and (not iLowX) and c[i] < iLow
        iBullCHoCH = iBullBreak and iBias == -1; iBearCHoCH = iBearBreak and iBias == 1
        iBullBOS = iBullBreak and iBias == 1;   iBearBOS = iBearBreak and iBias == -1
        brokenLowBar = iLowBar if iBearBreak else -1; brokenHighBar = iHighBar if iBullBreak else -1
        if iBullBreak: iHighX = True; iBias = 1
        if iBearBreak: iLowX = True; iBias = -1
        if iBearCHoCH:
            choch_bear_bar = i if (sweep_hi_bar >= 0 and i - sweep_hi_bar <= p.sweep_max_bars) else -1; choch_bear_sess = sweep_hi_sess
        if iBullCHoCH:
            choch_bull_bar = i if (sweep_lo_bar >= 0 and i - sweep_lo_bar <= p.sweep_max_bars) else -1; choch_bull_sess = sweep_lo_sess
        disp = (not np.isnan(avg_body[i])) and body[i] >= p.disp_mult * avg_body[i]
        tr2_bear = p.use_tr2 and iBearBOS and disp and choch_bear_bar >= 0 and i - choch_bear_bar <= p.choch_max_bars
        tr2_bull = p.use_tr2 and iBullBOS and disp and choch_bull_bar >= 0 and i - choch_bull_bar <= p.choch_max_bars
        tc_bear = p.use_tc and iBearBOS and disp and sBias == -1 and not tr2_bear
        tc_bull = p.use_tc and iBullBOS and disp and sBias == 1 and not tr2_bull

        new = None
        if tr2_bear or tc_bear: new = (True, "TR2" if tr2_bear else "TC", tr2_bear and choch_bear_sess, i - brokenLowBar)
        elif tr2_bull or tc_bull: new = (False, "TR2" if tr2_bull else "TC", tr2_bull and choch_bull_sess, i - brokenHighBar)
        if new is not None:
            bear, model, sess_liq, lookN = new
            lookN = max(lookN, 1)
            # order block: extreme normal-range candle among bars i-lookN .. i-1
            best = None
            for k in range(1, lookN + 1):
                j = i - k
                if (h[j] - l[j]) >= p.vol_mult * atr200[j]: continue
                if best is None or (h[j] > h[best] if bear else l[j] < l[best]): best = j
            cH = h[i - lookN:i + 1].max(); cL = l[i - lookN:i + 1].min()
            if best is not None:
                j = best; zt, zb, wt, wb = max(o[j], c[j]), min(o[j], c[j]), h[j], l[j]
                entry = (zb if p.entry_body else wb) if bear else (zt if p.entry_body else wt)
                sl = wt + p.sl_buf_pips * p.pip if bear else wb - p.sl_buf_pips * p.pip
                sl_pips = abs(sl - entry) / p.pip
                bias_ok = (not p.bias_filter) or (entry >= bias_mid if bear else entry <= bias_mid)
                if p.trend_filter and not (htf_bias[i] == -1 if bear else htf_bias[i] == 1): bias_ok = False
                off = i - j
                fvg = ((h[j + 2] < l[j]) if bear else (l[j + 2] > h[j])) if off >= 2 else False
                if sl_pips <= p.max_sl_pips and bias_ok:
                    score = 4 + int(fvg) + int(sess_liq) + int(hi_vol[j]) + int(model == "TR2") + int(sl_pips <= 20)
                    if score >= p.min_score:
                        if act is not None and not act.touched: act.reason = "replaced"
                        act = Setup(i, t[i], bear, model, zt, zb, wt, wb, j, cH, cL, i - lookN, entry, sl, cH if bear else cL,
                                    l[i] if bear else h[i], score, fvg, sess_liq, bool(hi_vol[j]), sl_pips=sl_pips)
                        setups.append(act); continue
        # ---- manage active setup
        if act is not None:
            a = act
            if not a.touched and i > a.idx_born:
                a.ext = min(a.ext, l[i]) if a.bear else max(a.ext, h[i])
                rngF = abs(a.anchor - a.ext); gate = a.ext + p.fib * rngF if a.bear else a.ext - p.fib * rngF
                reward_ok = abs(a.ext - a.entry) >= p.min_target_rr * abs(a.sl - a.entry)
                a.armed = reward_ok and ((a.entry >= gate - p.pip) if a.bear else (a.entry <= gate + p.pip))
                touch = h[i] >= a.entry if a.bear else l[i] <= a.entry
                if touch:
                    a.touched = True; a.idx_touch = i; a.time_touch = t[i]; a.in_window = bool(in_window[i]); a.tp2 = a.ext
                    if (a.armed or not p.require_armed) and a.in_window:
                        if p.entry_mode == "limit": a.valid_signal = True; a.reason = "signal"; a.entry_mode = "limit"; a.time_signal = t[i]
                        else: a.reason = "waiting reaction"; react_state = (i, h[i] if a.bear else l[i])
                    else:
                        a.reason = "touch before fib gate" if not a.armed else "outside session"
            elif a.touched and a.reason == "waiting reaction" and i > a.idx_touch:
                tb, rext = react_state; rext = max(rext, h[i]) if a.bear else min(rext, l[i]); react_state = (tb, rext)
                reacted = (c[i] < a.zone_bot and c[i] < o[i]) if a.bear else (c[i] > a.zone_top and c[i] > o[i])
                failed = (c[i] > a.wick_top) if a.bear else (c[i] < a.wick_bot)
                if reacted:
                    r_entry = c[i]; r_sl = rext + p.sl_buf_pips * p.pip if a.bear else rext - p.sl_buf_pips * p.pip; r_pips = abs(r_sl - r_entry) / p.pip
                    if r_pips <= p.max_sl_pips and abs(a.ext - r_entry) >= p.min_target_rr * abs(r_sl - r_entry):
                        a.entry, a.sl, a.sl_pips = r_entry, r_sl, r_pips; a.valid_signal = True; a.reason = "signal"; a.entry_mode = "reaction"; a.time_signal = t[i]
                    else: a.reason = "reaction rejected (SL/reward)"
                elif failed or i - tb > p.react_max_bars: a.reason = "no reaction"
            waiting = a.reason == "waiting reaction"
            flip = p.cancel_on_flip and not a.touched and ((iBullCHoCH or sBullBreak) if a.bear else (iBearCHoCH or sBearBreak))
            invalid = ((c[i] > a.sl if a.bear else c[i] < a.sl) and not waiting) or i - a.idx_born > p.zone_life or flip
            if invalid:
                if not a.touched: a.reason = a.reason or ("structure flipped" if flip else ("invalidated" if i - a.idx_born <= p.zone_life else "expired"))
                act = None
    return setups
