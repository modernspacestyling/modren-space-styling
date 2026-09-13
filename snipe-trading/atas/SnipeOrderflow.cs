// ============================================================================
//  SnipeOrderflow.cs  —  ATAS indicator: Snipe TR2/TC setup marker + orderflow
//  Target: ATAS.Indicators.dll  (.NET 8 / .NET 10 class library, <UseWPF>true)
//  Install: build -> copy DLL to %APPDATA%\ATAS\Indicators
// ----------------------------------------------------------------------------
//  Same mechanical logic as tradingview/SnipeSetup.pine:
//    sweep -> CHOCH -> consolidation box -> displacement break -> zone =
//    last opposite/indecision candle in the box -> fib 0.764 gate -> retest.
//  Orderflow layer (evaluated on the zone-touch bar, footprint data):
//    * delta sign confirms the direction (sell: negative delta / bid pressure)
//    * absorption: high volume + small body at the zone
//    * stacked imbalances (bid/ask ratio) against the retracement
//    * delta divergence vs. the leg extreme
//  These add to the score (max 13) and are exported to the data window.
// ============================================================================
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Drawing;
using System.Linq;
using ATAS.Indicators;
using ATAS.Indicators.Drawing;
using Utils.Common.Logging;
using Color = System.Windows.Media.Color;
using Colors = System.Windows.Media.Colors;

namespace SnipeTrading
{
    [DisplayName("Snipe Orderflow Setup (TR2/TC)")]
    public class SnipeOrderflow : Indicator
    {
        // ------------------------------------------------------ settings ----
        [Display(Name = "Swing length", GroupName = "Structure", Order = 10)] public int PivLen { get; set; } = 5;
        [Display(Name = "Max bars sweep->CHOCH", GroupName = "Structure", Order = 11)] public int SweepMaxBars { get; set; } = 40;
        [Display(Name = "Swept level must be extreme of last N bars", GroupName = "Structure", Order = 12)] public int ExtLookback { get; set; } = 60;
        [Display(Name = "Sweep must close back inside", GroupName = "Structure", Order = 12)] public bool StrictSweep { get; set; } = true;
        [Display(Name = "Mark TR2", GroupName = "Structure", Order = 13)] public bool UseTR2 { get; set; } = true;
        [Display(Name = "Mark TC", GroupName = "Structure", Order = 14)] public bool UseTC { get; set; } = true;

        [Display(Name = "Box min bars", GroupName = "Consolidation", Order = 20)] public int BoxMin { get; set; } = 6;
        [Display(Name = "Box max bars", GroupName = "Consolidation", Order = 21)] public int BoxMax { get; set; } = 40;
        [Display(Name = "Box height <= x*ATR14", GroupName = "Consolidation", Order = 22)] public decimal BoxMult { get; set; } = 2.2m;
        [Display(Name = "Break body >= x*avgBody10", GroupName = "Consolidation", Order = 23)] public decimal DispMult { get; set; } = 1.3m;

        [Display(Name = "Fib gate", GroupName = "Fibonacci", Order = 30)] public decimal FibLvl { get; set; } = 0.764m;
        [Display(Name = "Min reward to ultimate target (R)", GroupName = "Fibonacci", Order = 31)] public decimal MinTargetRR { get; set; } = 2m;
        [Display(Name = "Bigger picture premium/discount filter", GroupName = "Fibonacci", Order = 32)] public bool HtfFilter { get; set; } = true;
        [Display(Name = "Recent range lookback (bars)", GroupName = "Fibonacci", Order = 33)] public int HtfLookback { get; set; } = 240;

        [Display(Name = "Zone pick (0=freshest,1=extreme)", GroupName = "Zone", Order = 40)] public int ZonePick { get; set; } = 0;
        [Display(Name = "Entry on body (else wick)", GroupName = "Zone", Order = 41)] public bool EntryBody { get; set; } = true;
        [Display(Name = "Reaction entry (close back inside zone)", GroupName = "Zone", Order = 47)] public bool ReactionEntry { get; set; } = true;
        [Display(Name = "Reaction: max bars after touch", GroupName = "Zone", Order = 48)] public int ReactMaxBars { get; set; } = 6;
        [Display(Name = "Max SL pips (pip=0.10)", GroupName = "Zone", Order = 42)] public decimal MaxSLPips { get; set; } = 28m;
        [Display(Name = "SL buffer pips", GroupName = "Zone", Order = 43)] public decimal SLBufPips { get; set; } = 3m;
        [Display(Name = "Zone expiry bars", GroupName = "Zone", Order = 44)] public int ZoneLife { get; set; } = 200;
        [Display(Name = "Indecision body <= x*range", GroupName = "Zone", Order = 45)] public decimal IndecBody { get; set; } = 0.45m;
        [Display(Name = "Pip size", GroupName = "Zone", Order = 46)] public decimal Pip { get; set; } = 0.10m;

        [Display(Name = "Session start (UTC h)", GroupName = "Session", Order = 50)] public int SessStart { get; set; } = 7;
        [Display(Name = "Session end (UTC h)", GroupName = "Session", Order = 51)] public int SessEnd { get; set; } = 15;
        [Display(Name = "Min score to mark", GroupName = "Session", Order = 52)] public int MinScore { get; set; } = 5;

        [Display(Name = "Imbalance ratio (x)", GroupName = "Orderflow", Order = 60)] public decimal ImbRatio { get; set; } = 3m;
        [Display(Name = "Stacked imbalance levels", GroupName = "Orderflow", Order = 61)] public int ImbStack { get; set; } = 3;
        [Display(Name = "Absorption volume >= x*avgVol20", GroupName = "Orderflow", Order = 62)] public decimal AbsVolMult { get; set; } = 1.5m;
        [Display(Name = "Absorption body <= x*range", GroupName = "Orderflow", Order = 63)] public decimal AbsBody { get; set; } = 0.35m;
        [Display(Name = "Require orderflow confirmation for signal", GroupName = "Orderflow", Order = 64)] public bool RequireOF { get; set; } = false;

        // --------------------------------------------------- data series ----
        private readonly ValueDataSeries _sell = new("SellSignal") { VisualType = VisualMode.DownArrow, Color = Colors.Red, Width = 3 };
        private readonly ValueDataSeries _buy  = new("BuySignal")  { VisualType = VisualMode.UpArrow,   Color = Colors.Lime, Width = 3 };
        private readonly ValueDataSeries _score = new("Score")     { VisualType = VisualMode.Hide };
        private readonly ValueDataSeries _ofScore = new("OrderflowScore") { VisualType = VisualMode.Hide };
        private readonly ValueDataSeries _entry = new("Entry") { VisualType = VisualMode.Hide };
        private readonly ValueDataSeries _sl    = new("StopLoss") { VisualType = VisualMode.Hide };
        private readonly ValueDataSeries _tp    = new("Target") { VisualType = VisualMode.Hide };
        private readonly ValueDataSeries _boxBreak = new("BoxBreak") { VisualType = VisualMode.Hide };

        // --------------------------------------------------------- state ----
        private readonly List<decimal> _sh = new(); private readonly List<int> _shBar = new();
        private readonly List<decimal> _sl_ = new(); private readonly List<int> _slBar = new();
        private int _sweepHiBar = -1, _sweepLoBar = -1; private decimal _sweepHiPx, _sweepLoPx;
        private int _chochBearBar = -1, _chochBullBar = -1;
        private int _trend; private decimal _protLow, _protHigh; private int _protLowBar, _protHighBar;
        private decimal? _structHigh, _structLow; private int _structHighBar, _structLowBar;
        private int _lastBearEvent = -1, _lastBullEvent = -1; private string _lastBearKind = "", _lastBullKind = "";
        private decimal _asiaH, _asiaL, _ldnH, _ldnL, _pdH, _pdL, _dayH, _dayL; private int _lastDay = -1;
        private bool _sweepHiSess, _sweepLoSess, _chochBearSess, _chochBullSess;

        private class Setup
        {
            public bool Bear; public string Model; public decimal ZT, ZB, WT, WB; public int ZBar;
            public decimal BoxH, BoxL; public int BoxStart, Born; public decimal Entry, SL, Ext, Anchor;
            public int Score; public bool Armed, Touched, Fvg, SessLiq, WaitReact; public int TouchBar; public decimal ReactExt;
            public DrawingRectangle ZoneRect, BoxRect; public string LabelTag;
        }
        private Setup _act;
        private int _lastBar = -1;

        public SnipeOrderflow()
        {
            DenyToChangePanel = true;
            DataSeries[0] = _sell;
            DataSeries.Add(_buy); DataSeries.Add(_score); DataSeries.Add(_ofScore);
            DataSeries.Add(_entry); DataSeries.Add(_sl); DataSeries.Add(_tp); DataSeries.Add(_boxBreak);
        }

        protected override void OnRecalculate()
        {
            _sh.Clear(); _shBar.Clear(); _sl_.Clear(); _slBar.Clear();
            _sweepHiBar = _sweepLoBar = _chochBearBar = _chochBullBar = -1; _act = null; _lastDay = -1; _trend = 0; _structHigh = _structLow = null; _lastBearEvent = _lastBullEvent = -1;
            Rectangles.Clear(); Labels.Clear();
        }

        // ------------------------------------------------------ helpers ----
        private decimal Atr(int bar, int n)
        {
            if (bar < n + 1) return 0;
            decimal s = 0;
            for (int i = bar - n + 1; i <= bar; i++)
            {
                var c = GetCandle(i); var p = GetCandle(i - 1);
                s += Math.Max(c.High - c.Low, Math.Max(Math.Abs(c.High - p.Close), Math.Abs(c.Low - p.Close)));
            }
            return s / n;
        }
        private decimal AvgBody(int bar, int n)
        {
            if (bar < n) return 0; decimal s = 0;
            for (int i = bar - n + 1; i <= bar; i++) { var c = GetCandle(i); s += Math.Abs(c.Close - c.Open); }
            return s / n;
        }
        private decimal AvgVol(int bar, int n)
        {
            if (bar < n) return 0; decimal s = 0;
            for (int i = bar - n + 1; i <= bar; i++) s += GetCandle(i).Volume;
            return s / n;
        }
        private static bool Near(decimal a, decimal b, decimal tol) => Math.Abs(a - b) <= tol;
        private bool InWindow(DateTime tUtc)
        {
            int h = tUtc.Hour;
            if (h < SessStart || h >= SessEnd) return false;
            if (tUtc.DayOfWeek == DayOfWeek.Friday && h >= 13) return false;
            return true;
        }
        private static bool HiVol(DateTime tUtc) => tUtc.Hour == 7 || (tUtc.Hour >= 12 && tUtc.Hour < 14);

        // (boxHigh, boxLow, n): largest window [bar-n .. bar-1] starting after ev with height <= BoxMult * ATR(ev)
        private (decimal, decimal, int) BoxSince(int bar, int ev)
        {
            if (ev < 0) return (0, 0, 0);
            int maxN = Math.Min(BoxMax, bar - ev - 1); if (maxN < BoxMin) return (0, 0, 0);
            decimal atr = Atr(ev, 14); if (atr <= 0) return (0, 0, 0);
            decimal rh = decimal.MinValue, rl = decimal.MaxValue, bh = 0, bl = 0; int n = 0;
            for (int k = 1; k <= maxN; k++)
            {
                var x = GetCandle(bar - k); rh = Math.Max(rh, x.High); rl = Math.Min(rl, x.Low);
                if (rh - rl <= BoxMult * atr) { if (k >= BoxMin) { bh = rh; bl = rl; n = k; } } else break;
            }
            return (bh, bl, n);
        }

        // zone inside the box: last (freshest) or extreme opposite/indecision candle
        private bool FindZone(int bar, int n, bool bearish, out decimal zt, out decimal zb, out decimal wt, out decimal wb, out int zbar, out bool fvg)
        {
            zt = zb = wt = wb = 0; zbar = -1; fvg = false; decimal best = bearish ? decimal.MinValue : decimal.MaxValue; bool found = false;
            for (int i = 1; i <= n; i++)
            {
                var c = GetCandle(bar - i);
                bool bull = c.Close > c.Open; decimal rng = c.High - c.Low; decimal bd = Math.Abs(c.Close - c.Open);
                bool opp = bearish ? bull : !bull; bool indec = rng > 0 && bd <= IndecBody * rng;
                if (!(opp || indec)) continue;
                bool cand = ZonePick == 0 || (bearish ? c.High > best : c.Low < best);
                if (!cand) continue;
                best = bearish ? c.High : c.Low;
                zt = Math.Max(c.Open, c.Close); zb = Math.Min(c.Open, c.Close); wt = c.High; wb = c.Low; zbar = bar - i; found = true;
                if (i >= 2) { var c2 = GetCandle(bar - i + 2); fvg = bearish ? c2.High < c.Low : c2.Low > c.High; }
                if (ZonePick == 0) break;
            }
            return found;
        }

        // ------------------------------------------------- orderflow ----
        // Returns 0..4: delta sign, absorption, stacked imbalance, delta divergence
        private int OrderflowScore(int bar, bool bearish, decimal legExtDelta)
        {
            var c = GetCandle(bar); int s = 0;
            // 1. delta agrees with the trade direction on the touch bar
            if (bearish ? c.Delta < 0 : c.Delta > 0) s++;
            // 2. absorption: big volume, small body at the zone
            decimal rng = c.High - c.Low; decimal av = AvgVol(bar, 20);
            if (av > 0 && c.Volume >= AbsVolMult * av && rng > 0 && Math.Abs(c.Close - c.Open) <= AbsBody * rng) s++;
            // 3. stacked imbalances against the retracement (sell: bid imbalances = aggressive sellers)
            try
            {
                var levels = c.GetAllPriceLevels().OrderBy(l => l.Price).ToList();
                int stack = 0, bestStack = 0;
                for (int i = 1; i < levels.Count; i++)
                {
                    // diagonal comparison: bid at level i vs ask at level i-1 (sell imbalance), ask at i vs bid at i+1 (buy imbalance)
                    bool imb;
                    if (bearish) imb = levels[i - 1].Ask > 0 && levels[i].Bid >= ImbRatio * levels[i - 1].Ask;
                    else imb = levels[i - 1].Bid > 0 && levels[i].Ask >= ImbRatio * levels[i - 1].Bid;
                    stack = imb ? stack + 1 : 0; bestStack = Math.Max(bestStack, stack);
                }
                if (bestStack >= ImbStack) s++;
            }
            catch { /* no footprint data on this feed */ }
            // 4. delta divergence: retest reaches the zone with weaker delta than the leg extreme printed
            if (bearish ? c.MaxDelta < legExtDelta : c.MinDelta > legExtDelta) s++;
            return s;
        }

        // ------------------------------------------------- main loop ----
        protected override void OnCalculate(int bar, decimal value)
        {
            if (bar < PivLen * 2 + 20) return;
            var c = GetCandle(bar);
            var tUtc = c.Time.ToUniversalTime();

            // session levels
            if (tUtc.Day != _lastDay)
            {
                _pdH = _dayH; _pdL = _dayL; _dayH = c.High; _dayL = c.Low; _asiaH = _ldnH = 0; _asiaL = _ldnL = 0; _lastDay = tUtc.Day;
            }
            else { _dayH = Math.Max(_dayH, c.High); _dayL = _dayL == 0 ? c.Low : Math.Min(_dayL, c.Low); }
            if (tUtc.Hour < 7) { _asiaH = Math.Max(_asiaH, c.High); _asiaL = _asiaL == 0 ? c.Low : Math.Min(_asiaL, c.Low); }
            if (tUtc.Hour >= 7 && tUtc.Hour < 12) { _ldnH = Math.Max(_ldnH, c.High); _ldnL = _ldnL == 0 ? c.Low : Math.Min(_ldnL, c.Low); }

            // confirmed pivots (bar - PivLen)
            int pb = bar - PivLen; var pc = GetCandle(pb); bool isPH = true, isPL = true;
            for (int i = pb - PivLen; i <= pb + PivLen; i++)
            {
                if (i == pb) continue; var x = GetCandle(i);
                if (x.High >= pc.High) isPH = false; if (x.Low <= pc.Low) isPL = false;
            }
            if (isPH && (_shBar.Count == 0 || _shBar[^1] != pb)) { _sh.Add(pc.High); _shBar.Add(pb); }
            if (isPL && (_slBar.Count == 0 || _slBar[^1] != pb)) { _sl_.Add(pc.Low); _slBar.Add(pb); }
            if (_sh.Count < 2 || _sl_.Count < 2) return;
            decimal lastSH = _sh[^1], prevSH = _sh[^2], lastSL = _sl_[^1], prevSL = _sl_[^2];
            int lastSHb = _shBar[^1], lastSLb = _slBar[^1];

            // --- market structure state machine (mirrors Pine) ---
            bool bearCHOCH = false, bullCHOCH = false;
            if (_trend == 0)
            {
                _trend = lastSH > prevSH ? 1 : -1; _protLow = lastSL; _protLowBar = lastSLb; _protHigh = lastSH; _protHighBar = lastSHb;
                _structHigh = lastSH; _structHighBar = lastSHb; _structLow = lastSL; _structLowBar = lastSLb;
            }
            if (isPH && _trend == 1 && (_structHigh == null || pc.High > _structHigh)) { _structHigh = pc.High; _structHighBar = pb; }
            if (isPL && _trend == -1 && (_structLow == null || pc.Low < _structLow)) { _structLow = pc.Low; _structLowBar = pb; }
            if (_trend == 1)
            {
                if (c.Close < _protLow) { bearCHOCH = true; _trend = -1; (_protHigh, _protHighBar) = HighestSince(_protLowBar, bar); _structHigh = _structLow = null; _lastBearEvent = bar; _lastBearKind = "TR2"; }
                else if (_structHigh != null && c.Close > _structHigh) { (_protLow, _protLowBar) = LowestSince(_structHighBar, bar); _structHigh = null; _lastBullEvent = bar; _lastBullKind = "TC"; }
            }
            else if (_trend == -1)
            {
                if (c.Close > _protHigh) { bullCHOCH = true; _trend = 1; (_protLow, _protLowBar) = LowestSince(_protHighBar, bar); _structHigh = _structLow = null; _lastBullEvent = bar; _lastBullKind = "TR2"; }
                else if (_structLow != null && c.Close < _structLow) { (_protHigh, _protHighBar) = HighestSince(_structLowBar, bar); _structLow = null; _lastBearEvent = bar; _lastBearKind = "TC"; }
            }
            // sweeps of external liquidity (structural HH / LL)
            decimal tol = 2 * Pip; decimal extHigh = _structHigh ?? lastSH, extLow = _structLow ?? lastSL;
            var (lbHi, _) = HighestSince(Math.Max(0, bar - ExtLookback), bar - 1); var (lbLo, _) = LowestSince(Math.Max(0, bar - ExtLookback), bar - 1);
            if (c.High > extHigh && (!StrictSweep || c.Close < extHigh) && extHigh >= lbHi - Pip) { _sweepHiBar = bar; _sweepHiPx = c.High; _sweepHiSess = Near(extHigh, _asiaH, tol) || Near(extHigh, _ldnH, tol) || Near(extHigh, _pdH, tol); }
            if (c.Low < extLow && (!StrictSweep || c.Close > extLow) && extLow <= lbLo + Pip) { _sweepLoBar = bar; _sweepLoPx = c.Low; _sweepLoSess = Near(extLow, _asiaL, tol) || Near(extLow, _ldnL, tol) || Near(extLow, _pdL, tol); }
            if (bearCHOCH && _sweepHiBar >= 0 && bar - _sweepHiBar <= SweepMaxBars) { _chochBearBar = bar; _chochBearSess = _sweepHiSess; }
            if (bullCHOCH && _sweepLoBar >= 0 && bar - _sweepLoBar <= SweepMaxBars) { _chochBullBar = bar; _chochBullSess = _sweepLoSess; }
            bool upTrend = _trend == 1, downTrend = _trend == -1;

            // consolidation box = range formed after the structure event (CHOCH for TR2, BOS for TC)
            var (bxHd, bxLd, bxNd) = BoxSince(bar, _lastBearEvent); var (bxHu, bxLu, bxNu) = BoxSince(bar, _lastBullEvent);
            decimal body = Math.Abs(c.Close - c.Open), ab = AvgBody(bar, 10);
            bool breakDn = bxNd > 0 && c.Close < bxLd && body >= DispMult * ab && c.Close < c.Open;
            bool breakUp = bxNu > 0 && c.Close > bxHu && body >= DispMult * ab && c.Close > c.Open;
            var (bxH, bxL, bxN) = breakDn ? (bxHd, bxLd, bxNd) : (bxHu, bxLu, bxNu);
            _boxBreak[bar] = breakDn ? -1 : breakUp ? 1 : 0;
            bool tr2Bear = UseTR2 && breakDn && _lastBearKind == "TR2" && _chochBearBar == _lastBearEvent;
            bool tr2Bull = UseTR2 && breakUp && _lastBullKind == "TR2" && _chochBullBar == _lastBullEvent;
            bool tcBear = UseTC && breakDn && _lastBearKind == "TC" && downTrend, tcBull = UseTC && breakUp && _lastBullKind == "TC" && upTrend;

            if (bar != _lastBar) // create only once per bar
            {
                if (tr2Bear || tcBear) TryCreate(bar, true, tr2Bear ? "TR2" : "TC", tr2Bear && _chochBearSess, bxH, bxL, bxN, tUtc);
                else if (tr2Bull || tcBull) TryCreate(bar, false, tr2Bull ? "TR2" : "TC", tr2Bull && _chochBullSess, bxH, bxL, bxN, tUtc);
            }
            _lastBar = bar;

            // manage active setup
            if (_act != null)
            {
                var a = _act;
                if (!a.Touched && bar > a.Born)
                {
                    a.Ext = a.Bear ? Math.Min(a.Ext, c.Low) : Math.Max(a.Ext, c.High);
                    decimal rngF = Math.Abs(a.Anchor - a.Ext);
                    decimal gate = a.Bear ? a.Ext + FibLvl * rngF : a.Ext - FibLvl * rngF;
                    bool rewardOk = Math.Abs(a.Ext - a.Entry) >= MinTargetRR * Math.Abs(a.SL - a.Entry);
                    a.Armed = rewardOk && (a.Bear ? a.Entry >= gate - Pip : a.Entry <= gate + Pip);
                    bool touch = a.Bear ? c.High >= a.Entry : c.Low <= a.Entry;
                    if (touch)
                    {
                        a.Touched = true;
                        if (a.Armed && InWindow(tUtc))
                        {
                            if (ReactionEntry) { a.WaitReact = true; a.TouchBar = bar; a.ReactExt = a.Bear ? c.High : c.Low; }
                            else EmitSignal(bar, a, c, tUtc);
                        }
                        else AddText("sig" + bar, a.Armed ? "outside session" : "touch before fib", !a.Bear, bar, a.Bear ? c.High : c.Low, Colors.White, Colors.Gray, 8f, DrawingText.TextAlign.Center);
                    }
                }
                else if (a.WaitReact && bar > a.TouchBar)
                {
                    a.ReactExt = a.Bear ? Math.Max(a.ReactExt, c.High) : Math.Min(a.ReactExt, c.Low);
                    bool reacted = a.Bear ? (c.Close < a.ZB && c.Close < c.Open) : (c.Close > a.ZT && c.Close > c.Open);
                    bool failed = a.Bear ? c.Close > a.WT : c.Close < a.WB;
                    if (reacted)
                    {
                        decimal rSL = a.Bear ? a.ReactExt + SLBufPips * Pip : a.ReactExt - SLBufPips * Pip; decimal rPips = Math.Abs(rSL - c.Close) / Pip;
                        if (rPips <= MaxSLPips && Math.Abs(a.Ext - c.Close) >= MinTargetRR * Math.Abs(rSL - c.Close)) { a.Entry = c.Close; a.SL = rSL; EmitSignal(bar, a, c, tUtc); }
                        else AddText("sig" + bar, "reaction rejected (SL " + rPips.ToString("F0") + "p)", !a.Bear, bar, a.Bear ? c.High : c.Low, Colors.White, Colors.Gray, 8f, DrawingText.TextAlign.Center);
                        a.WaitReact = false;
                    }
                    else if (failed || bar - a.TouchBar > ReactMaxBars) a.WaitReact = false;
                }
                bool invalid = (((a.Bear && c.Close > a.SL) || (!a.Bear && c.Close < a.SL)) && !a.WaitReact) || bar - a.Born > ZoneLife;
                if (invalid) { if (a.ZoneRect != null) a.ZoneRect.SecondBar = bar; _act = null; }
                else if (a.ZoneRect != null) a.ZoneRect.SecondBar = bar + 3;
            }
        }

        private (decimal, int) HighestSince(int from, int to) { decimal m = decimal.MinValue; int b = from; for (int i = from; i <= to; i++) { var x = GetCandle(i).High; if (x > m) { m = x; b = i; } } return (m, b); }
        private (decimal, int) LowestSince(int from, int to) { decimal m = decimal.MaxValue; int b = from; for (int i = from; i <= to; i++) { var x = GetCandle(i).Low; if (x < m) { m = x; b = i; } } return (m, b); }
        private void EmitSignal(int bar, Setup a, IndicatorCandle c, DateTime tUtc)
        {
            int of = OrderflowScore(bar, a.Bear, a.Bear ? MaxDeltaSince(a.Born, bar) : MinDeltaSince(a.Born, bar));
            _ofScore[bar] = of;
            if (RequireOF && of < 2) { AddText("sig" + bar, "OF weak (" + of + "/4)", !a.Bear, bar, a.Bear ? c.High : c.Low, Colors.White, Colors.Gray, 8f, DrawingText.TextAlign.Center); return; }
            if (a.Bear) _sell[bar] = c.High + Pip * 5; else _buy[bar] = c.Low - Pip * 5;
            _score[bar] = a.Score + of; _entry[bar] = a.Entry; _sl[bar] = a.SL; _tp[bar] = a.Ext;
            AddText("sig" + bar, (a.Bear ? "SELL " : "BUY ") + a.Model + " " + (a.Score + of) + "/13\nE " + a.Entry.ToString("F2") + " SL " + a.SL.ToString("F2") + " TP " + a.Ext.ToString("F2") + "\nOF " + of + "/4",
                !a.Bear, bar, a.Bear ? c.High : c.Low, a.Bear ? Colors.White : Colors.Black, a.Bear ? Colors.Red : Colors.Lime, 10f, DrawingText.TextAlign.Center);
        }

        private decimal MaxDeltaSince(int from, int to) { decimal m = decimal.MinValue; for (int i = from; i < to; i++) m = Math.Max(m, GetCandle(i).MaxDelta); return m; }
        private decimal MinDeltaSince(int from, int to) { decimal m = decimal.MaxValue; for (int i = from; i < to; i++) m = Math.Min(m, GetCandle(i).MinDelta); return m; }

        private void TryCreate(int bar, bool bearish, string model, bool sessLiq, decimal bxH, decimal bxL, int bxN, DateTime tUtc)
        {
            if (!FindZone(bar, bxN, bearish, out var zt, out var zb, out var wt, out var wb, out var zbar, out var fvg)) return;
            decimal entry = bearish ? (EntryBody ? zb : wb) : (EntryBody ? zt : wt);
            decimal sl = bearish ? wt + SLBufPips * Pip : wb - SLBufPips * Pip;
            decimal slPips = Math.Abs(sl - entry) / Pip;
            if (slPips > MaxSLPips) return;
            if (HtfFilter)
            {
                var (rh, _) = HighestSince(Math.Max(0, bar - HtfLookback + 1), bar); var (rl, _) = LowestSince(Math.Max(0, bar - HtfLookback + 1), bar);
                decimal mid = (rh + rl) / 2;
                if (bearish ? entry < mid : entry > mid) return;
            }
            int score = 4 + (fvg ? 1 : 0) + (sessLiq ? 1 : 0) + (HiVol(GetCandle(zbar).Time.ToUniversalTime()) ? 1 : 0) + (model == "TR2" ? 1 : 0) + (slPips <= 20 ? 1 : 0);
            if (score < MinScore) return;
            var c = GetCandle(bar);
            var s = new Setup
            {
                Bear = bearish, Model = model, ZT = zt, ZB = zb, WT = wt, WB = wb, ZBar = zbar, BoxH = bxH, BoxL = bxL, BoxStart = bar - bxN,
                Born = bar, Entry = entry, SL = sl, Anchor = bearish ? bxH : bxL, Ext = bearish ? c.Low : c.High, Score = score, Fvg = fvg, SessLiq = sessLiq
            };
            var zoneColor = bearish ? System.Drawing.Color.FromArgb(70, 255, 82, 82) : System.Drawing.Color.FromArgb(70, 0, 230, 118);
            s.BoxRect = new DrawingRectangle(s.BoxStart, bxH, bar, bxL, new Pen(System.Drawing.Color.Gray), new SolidBrush(System.Drawing.Color.FromArgb(30, 144, 164, 174)));
            s.ZoneRect = new DrawingRectangle(zbar, EntryBody ? zt : wt, bar + 3, EntryBody ? zb : wb, new Pen(zoneColor), new SolidBrush(zoneColor));
            Rectangles.Add(s.BoxRect); Rectangles.Add(s.ZoneRect);
            AddText("zone" + bar, (bearish ? "SELL " : "BUY ") + model + " " + score + "/9  SL " + slPips.ToString("F0") + "p", bearish, bar, bearish ? wt : wb, Colors.White, bearish ? Colors.DarkRed : Colors.DarkGreen, 9f, DrawingText.TextAlign.Left);
            _act = s;
        }
    }
}
