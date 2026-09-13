"""Mechanical Snipe setup detector — mirrors tradingview/SnipeSetup.pine and atas/SnipeOrderflow.cs.

Sequence (sell / TR2):  external swing high swept -> CHOCH (close below last swing low)
    -> consolidation box (largest window <= BoxMult*ATR14, BoxMin..BoxMax bars)
    -> displacement break below the box (body >= DispMult * avg body)
    -> zone = last (freshest) bullish/indecision candle inside the box
    -> entry = zone body edge (proximal), SL = wick tip + buffer, cap MaxSLPips
    -> fib anchored box HIGH (1.0) -> running leg LOW (0.0); ARMED when entry >= 0.764 level
    -> signal when price touches entry while armed, inside the session window
TC = same box break in the direction of the last two swings (HH/HL or LH/LL) without a sweep+CHOCH.
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Optional
import numpy as np
import pandas as pd

@dataclass
class Params:
    piv_len: int = 5
    sweep_max_bars: int = 40
    use_tr2: bool = True
    use_tc: bool = True
    box_min: int = 6
    box_max: int = 40
    box_mult: float = 2.2
    disp_mult: float = 1.3
    fib: float = 0.764
    zone_pick: str = "freshest"   # or "extreme"
    entry_body: bool = True
    max_sl_pips: float = 28.0
    sl_buf_pips: float = 3.0
    zone_life: int = 200
    indec_body: float = 0.45
    pip: float = 0.10
    sess_start: int = 7
    sess_end: int = 15
    skip_fri_pm: bool = True
    min_score: int = 5
    require_armed: bool = True
    strict_sweep: bool = True
    min_target_rr: float = 2.0
    htf_filter: bool = True
    htf_lookback: int = 240
    ext_lookback: int = 60

@dataclass
class Setup:
    idx_born: int
    time_born: pd.Timestamp
    bear: bool
    model: str
    zone_top: float
    zone_bot: float
    wick_top: float
    wick_bot: float
    zone_bar: int
    box_high: float
    box_low: float
    box_start: int
    entry: float
    sl: float
    anchor: float
    ext: float
    score: int
    fvg: bool
    sess_liq: bool
    hi_vol_zone: bool
    armed: bool = False
    touched: bool = False
    idx_touch: Optional[int] = None
    time_touch: Optional[pd.Timestamp] = None
    in_window: bool = False
    valid_signal: bool = False
    reason: str = ""
    tp2: float = 0.0
    sl_pips: float = 0.0

    def to_row(self):
        d = asdict(self); return d

def _atr(h, l, c, n=14):
    tr = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    tr = np.r_[h[0] - l[0], tr]
    return pd.Series(tr).rolling(n).mean().to_numpy()

def _pivots(h, l, n):
    N = len(h); ph = np.full(N, np.nan); pl = np.full(N, np.nan)
    for i in range(n, N - n):
        w_h = h[i - n:i + n + 1]; w_l = l[i - n:i + n + 1]
        if h[i] == w_h.max() and (w_h == h[i]).sum() == 1: ph[i] = h[i]
        if l[i] == w_l.min() and (w_l == l[i]).sum() == 1: pl[i] = l[i]
    return ph, pl

def detect(df: pd.DataFrame, p: Params = Params()) -> List[Setup]:
    o = df["open"].to_numpy(float); h = df["high"].to_numpy(float); l = df["low"].to_numpy(float); c = df["close"].to_numpy(float)
    t = df.index; N = len(df)
    atr = _atr(h, l, c, 14)
    body = np.abs(c - o); avg_body = pd.Series(body).rolling(10).mean().to_numpy()
    ph, pl = _pivots(h, l, p.piv_len)
    roll_hi = pd.Series(h).rolling(p.htf_lookback, min_periods=1).max().to_numpy(); roll_lo = pd.Series(l).rolling(p.htf_lookback, min_periods=1).min().to_numpy()
    ext_hi = pd.Series(h).rolling(p.ext_lookback, min_periods=1).max().shift(1).to_numpy(); ext_lo = pd.Series(l).rolling(p.ext_lookback, min_periods=1).min().shift(1).to_numpy()
    hours = t.hour.to_numpy(); dows = t.dayofweek.to_numpy(); days = t.normalize()
    in_window = (hours >= p.sess_start) & (hours < p.sess_end)
    if p.skip_fri_pm: in_window &= ~((dows == 4) & (hours >= 13))
    hi_vol = (hours == 7) | ((hours >= 12) & (hours < 14))

    # session levels per day
    day_id = pd.factorize(days)[0]
    asia_h = np.full(N, np.nan); asia_l = np.full(N, np.nan); ldn_h = np.full(N, np.nan); ldn_l = np.full(N, np.nan); pd_h = np.full(N, np.nan); pd_l = np.full(N, np.nan)
    cur_day = -1; aH = aL = lH = lL = dH = dL = np.nan; prevH = prevL = np.nan
    for i in range(N):
        if day_id[i] != cur_day:
            prevH, prevL = dH, dL; cur_day = day_id[i]; aH = aL = lH = lL = np.nan; dH, dL = h[i], l[i]
        else:
            dH = max(dH, h[i]); dL = min(dL, l[i])
        if hours[i] < 7: aH = np.nanmax([aH, h[i]]); aL = np.nanmin([aL, l[i]])
        if 7 <= hours[i] < 12: lH = np.nanmax([lH, h[i]]); lL = np.nanmin([lL, l[i]])
        asia_h[i], asia_l[i], ldn_h[i], ldn_l[i], pd_h[i], pd_l[i] = aH, aL, lH, lL, prevH, prevL

    def sess_level(i, lvl, is_high):
        tol = 2 * p.pip
        cands = [asia_h[i], ldn_h[i], pd_h[i]] if is_high else [asia_l[i], ldn_l[i], pd_l[i]]
        return any((not np.isnan(x)) and abs(lvl - x) <= tol for x in cands)

    setups: List[Setup] = []
    sh = []; shb = []; sl_ = []; slb = []
    sweep_hi_bar = -1; sweep_hi_px = np.nan; sweep_hi_sess = False
    sweep_lo_bar = -1; sweep_lo_px = np.nan; sweep_lo_sess = False
    choch_bear_bar = -1; choch_bull_bar = -1; choch_bear_sess = False; choch_bull_sess = False
    act: Optional[Setup] = None
    last_bear_event = last_bull_event = -1; last_bear_kind = last_bull_kind = ''
    trend = 0; prot_low = prot_high = 0.0; prot_low_bar = prot_high_bar = 0; struct_high = struct_low = None; struct_high_bar = struct_low_bar = 0

    for i in range(p.piv_len * 2 + 20, N):
        pb = i - p.piv_len
        if not np.isnan(ph[pb]): sh.append(ph[pb]); shb.append(pb)
        if not np.isnan(pl[pb]): sl_.append(pl[pb]); slb.append(pb)
        if len(sh) < 2 or len(sl_) < 2: continue
        lastSH, prevSH, lastSL, prevSL = sh[-1], sh[-2], sl_[-1], sl_[-2]
        lastSHb, lastSLb = shb[-1], slb[-1]
        # --- market structure state machine (mirrors Pine) ---
        bear_choch = bull_choch = False
        if trend == 0:
            trend = 1 if lastSH > prevSH else -1
            prot_low, prot_low_bar, prot_high, prot_high_bar = lastSL, lastSLb, lastSH, lastSHb
            struct_high, struct_high_bar, struct_low, struct_low_bar = lastSH, lastSHb, lastSL, lastSLb
        if not np.isnan(ph[pb]) and trend == 1 and (struct_high is None or ph[pb] > struct_high):
            struct_high, struct_high_bar = ph[pb], pb
        if not np.isnan(pl[pb]) and trend == -1 and (struct_low is None or pl[pb] < struct_low):
            struct_low, struct_low_bar = pl[pb], pb
        if trend == 1:
            if c[i] < prot_low:
                bear_choch = True; trend = -1; last_bear_event, last_bear_kind = i, 'TR2'
                seg = h[prot_low_bar:i + 1]; prot_high = seg.max(); prot_high_bar = prot_low_bar + int(seg.argmax())
                struct_low = struct_high = None
            elif struct_high is not None and c[i] > struct_high:
                seg = l[struct_high_bar:i + 1]; prot_low = seg.min(); prot_low_bar = struct_high_bar + int(seg.argmin()); struct_high = None; last_bull_event, last_bull_kind = i, 'TC'
        elif trend == -1:
            if c[i] > prot_high:
                bull_choch = True; trend = 1; last_bull_event, last_bull_kind = i, 'TR2'
                seg = l[prot_high_bar:i + 1]; prot_low = seg.min(); prot_low_bar = prot_high_bar + int(seg.argmin())
                struct_high = struct_low = None
            elif struct_low is not None and c[i] < struct_low:
                seg = h[struct_low_bar:i + 1]; prot_high = seg.max(); prot_high_bar = struct_low_bar + int(seg.argmax()); struct_low = None; last_bear_event, last_bear_kind = i, 'TC'
        # sweeps of external liquidity (structural HH / LL)
        ext_high = struct_high if struct_high is not None else lastSH
        ext_low = struct_low if struct_low is not None else lastSL
        if h[i] > ext_high and (not p.strict_sweep or c[i] < ext_high) and ext_high >= ext_hi[i] - p.pip:
            sweep_hi_bar, sweep_hi_px, sweep_hi_sess = i, h[i], sess_level(i, ext_high, True)
        if l[i] < ext_low and (not p.strict_sweep or c[i] > ext_low) and ext_low <= ext_lo[i] + p.pip:
            sweep_lo_bar, sweep_lo_px, sweep_lo_sess = i, l[i], sess_level(i, ext_low, False)
        if bear_choch and sweep_hi_bar >= 0 and i - sweep_hi_bar <= p.sweep_max_bars:
            choch_bear_bar, choch_bear_sess = i, sweep_hi_sess
        if bull_choch and sweep_lo_bar >= 0 and i - sweep_lo_bar <= p.sweep_max_bars:
            choch_bull_bar, choch_bull_sess = i, sweep_lo_sess
        up_trend = trend == 1
        down_trend = trend == -1

        # consolidation box = range formed after the structure event (CHOCH for TR2, BOS for TC)
        def box_since(ev):
            if ev < 0: return (np.nan, np.nan, 0)
            max_n = min(p.box_max, i - ev - 1); a = atr[ev]
            if max_n < p.box_min or np.isnan(a) or a <= 0: return (np.nan, np.nan, 0)
            rh, rl, best = -np.inf, np.inf, (np.nan, np.nan, 0)
            for k in range(1, max_n + 1):
                rh = max(rh, h[i - k]); rl = min(rl, l[i - k])
                if rh - rl <= p.box_mult * a:
                    if k >= p.box_min: best = (rh, rl, k)
                else: break
            return best
        bxHd, bxLd, bxNd = box_since(last_bear_event); bxHu, bxLu, bxNu = box_since(last_bull_event)
        break_dn = bxNd > 0 and c[i] < bxLd and body[i] >= p.disp_mult * avg_body[i] and c[i] < o[i]
        break_up = bxNu > 0 and c[i] > bxHu and body[i] >= p.disp_mult * avg_body[i] and c[i] > o[i]
        bxH, bxL, bxN = (bxHd, bxLd, bxNd) if break_dn else (bxHu, bxLu, bxNu)
        tr2_bear = p.use_tr2 and break_dn and last_bear_kind == 'TR2' and choch_bear_bar == last_bear_event
        tr2_bull = p.use_tr2 and break_up and last_bull_kind == 'TR2' and choch_bull_bar == last_bull_event
        tc_bear = p.use_tc and break_dn and last_bear_kind == 'TC' and down_trend
        tc_bull = p.use_tc and break_up and last_bull_kind == 'TC' and up_trend

        new = None
        if tr2_bear or tc_bear: new = (True, "TR2" if tr2_bear else "TC", tr2_bear and choch_bear_sess)
        elif tr2_bull or tc_bull: new = (False, "TR2" if tr2_bull else "TC", tr2_bull and choch_bull_sess)
        if new is not None:
            bear, model, sess_liq = new
            # zone inside box
            best = -np.inf if bear else np.inf; found = None
            for k in range(1, bxN + 1):
                j = i - k; bull = c[j] > o[j]; rng = h[j] - l[j]; bd = abs(c[j] - o[j])
                opp = bull if bear else (not bull); indec = rng > 0 and bd <= p.indec_body * rng
                if not (opp or indec): continue
                if p.zone_pick == "freshest" or (h[j] > best if bear else l[j] < best):
                    best = h[j] if bear else l[j]
                    fvg = (h[j + 2] < l[j] if bear else l[j + 2] > h[j]) if k >= 2 else False
                    found = (max(o[j], c[j]), min(o[j], c[j]), h[j], l[j], j, fvg)
                    if p.zone_pick == "freshest": break
            if found is not None:
                zt, zb, wt, wb, zbar, fvg = found
                entry = (zb if p.entry_body else wb) if bear else (zt if p.entry_body else wt)
                sl = wt + p.sl_buf_pips * p.pip if bear else wb - p.sl_buf_pips * p.pip
                sl_pips = abs(sl - entry) / p.pip
                mid = (roll_hi[i] + roll_lo[i]) / 2
                htf_ok = (not p.htf_filter) or (entry >= mid if bear else entry <= mid)
                if sl_pips <= p.max_sl_pips and htf_ok:
                    score = 4 + int(fvg) + int(sess_liq) + int(hi_vol[zbar]) + int(model == "TR2") + int(sl_pips <= 20)
                    if score >= p.min_score:
                        if act is not None and not act.touched:
                            act.reason = "replaced"
                        act = Setup(i, t[i], bear, model, zt, zb, wt, wb, zbar, bxH, bxL, i - bxN, entry, sl, bxH if bear else bxL,
                                    l[i] if bear else h[i], score, fvg, sess_liq, bool(hi_vol[zbar]), sl_pips=sl_pips)
                        setups.append(act)
                        continue
        # manage active
        if act is not None:
            a = act
            if not a.touched and i > a.idx_born:
                a.ext = min(a.ext, l[i]) if a.bear else max(a.ext, h[i])
                rngF = abs(a.anchor - a.ext)
                gate = a.ext + p.fib * rngF if a.bear else a.ext - p.fib * rngF
                reward_ok = abs(a.ext - a.entry) >= p.min_target_rr * abs(a.sl - a.entry)
                a.armed = reward_ok and ((a.entry >= gate - p.pip) if a.bear else (a.entry <= gate + p.pip))
                touch = h[i] >= a.entry if a.bear else l[i] <= a.entry
                if touch:
                    a.touched = True; a.idx_touch = i; a.time_touch = t[i]; a.in_window = bool(in_window[i]); a.tp2 = a.ext
                    if (a.armed or not p.require_armed) and a.in_window:
                        a.valid_signal = True; a.reason = "signal"
                    else:
                        a.reason = "touch before fib gate" if not a.armed else "outside session"
            invalid = (c[i] > a.sl if a.bear else c[i] < a.sl) or i - a.idx_born > p.zone_life
            if invalid:
                if not a.touched: a.reason = a.reason or ("invalidated" if i - a.idx_born <= p.zone_life else "expired")
                act = None
    return setups
