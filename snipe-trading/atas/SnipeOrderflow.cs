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
        [Display(Name = "Swing structure length (external)", GroupName = "Structure", Order = 10)] public int SwingLen { get; set; } = 50;
        [Display(Name = "Internal structure length", GroupName = "Structure", Order = 11)] public int IntLen { get; set; } = 5;
        [Display(Name = "Sweep must close back inside", GroupName = "Structure", Order = 12)] public bool StrictSweep { get; set; } = true;
        [Display(Name = "Max bars sweep->CHoCH", GroupName = "Structure", Order = 13)] public int SweepMaxBars { get; set; } = 60;
        [Display(Name = "Max bars CHoCH->BOS", GroupName = "Structure", Order = 14)] public int ChochMaxBars { get; set; } = 60;
        [Display(Name = "Break body >= x*avgBody10", GroupName = "Structure", Order = 15)] public decimal DispMult { get; set; } = 1.2m;
        [Display(Name = "Mark TR2", GroupName = "Structure", Order = 16)] public bool UseTR2 { get; set; } = true;
        [Display(Name = "Mark TC", GroupName = "Structure", Order = 17)] public bool UseTC { get; set; } = true;
        [Display(Name = "Ignore candles with range >= x*ATR200 as zone", GroupName = "Zone", Order = 49)] public decimal VolMult { get; set; } = 2.0m;

        [Display(Name = "Fib gate", GroupName = "Fibonacci", Order = 30)] public decimal FibLvl { get; set; } = 0.764m;
        [Display(Name = "Min reward to ultimate target (R)", GroupName = "Fibonacci", Order = 31)] public decimal MinTargetRR { get; set; } = 2m;
        [Display(Name = "Sell only in premium / buy only in discount of swing range", GroupName = "Fibonacci", Order = 32)] public bool BiasFilter { get; set; } = true;
        [Display(Name = "Trade only with higher-timeframe structure", GroupName = "Fibonacci", Order = 34)] public bool TrendFilter { get; set; } = true;
        [Display(Name = "Trend timeframe (minutes)", GroupName = "Fibonacci", Order = 35)] public int TrendMinutes { get; set; } = 60;
        [Display(Name = "Trend swing length (HTF bars)", GroupName = "Fibonacci", Order = 36)] public int TrendLen { get; set; } = 10;

        [Display(Name = "Entry on body (else wick)", GroupName = "Zone", Order = 41)] public bool EntryBody { get; set; } = true;
        [Display(Name = "Reaction entry (close back inside zone)", GroupName = "Zone", Order = 47)] public bool ReactionEntry { get; set; } = true;
        [Display(Name = "Reaction: max bars after touch", GroupName = "Zone", Order = 48)] public int ReactMaxBars { get; set; } = 6;
        [Display(Name = "Max SL pips (pip=0.10)", GroupName = "Zone", Order = 42)] public decimal MaxSLPips { get; set; } = 28m;
        [Display(Name = "SL buffer pips", GroupName = "Zone", Order = 43)] public decimal SLBufPips { get; set; } = 3m;
        [Display(Name = "Zone expiry bars", GroupName = "Zone", Order = 44)] public int ZoneLife { get; set; } = 100;
        [Display(Name = "Cancel untested zone on structure flip", GroupName = "Zone", Order = 45)] public bool CancelOnFlip { get; set; } = true;
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
        private decimal? _sHigh, _sLow, _iHigh, _iLow; private int _sHighBar, _sLowBar, _iHighBar, _iLowBar; private bool _sHighX, _sLowX, _iHighX, _iLowX;
        private int _sBias, _iBias; private decimal? _trailTop, _trailBot;
        private int _sweepHiBar = -1, _sweepLoBar = -1; private bool _sweepHiSess, _sweepLoSess;
        // higher-timeframe aggregation for the trend filter
        private readonly List<decimal[]> _htf = new(); private long _htfBucket = -1; private decimal[] _htfCur;
        private decimal? _hSH, _hSL; private bool _hSHX, _hSLX; private int _htfBias;
        private int _chochBearBar = -1, _chochBullBar = -1; private bool _chochBearSess, _chochBullSess;
        private decimal _asiaH, _asiaL, _ldnH, _ldnL, _pdH, _pdL, _dayH, _dayL; private int _lastDay = -1;

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
            _sHigh = _sLow = _iHigh = _iLow = null; _sHighX = _sLowX = _iHighX = _iLowX = false; _sBias = _iBias = 0; _trailTop = _trailBot = null;
            _sweepHiBar = _sweepLoBar = _chochBearBar = _chochBullBar = -1; _act = null; _lastDay = -1;
            _htf.Clear(); _htfBucket = -1; _htfCur = null; _hSH = _hSL = null; _hSHX = _hSLX = false; _htfBias = 0;
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

        // extreme normal-range candle among bars [bar-n .. bar-1] (order block candidate); returns bar index or -1
        private int OrderBlockBar(int bar, int n, bool bearish)
        {
            int best = -1; decimal atr = Atr(bar, 200);
            for (int k = 1; k <= n && bar - k >= 0; k++)
            {
                var c = GetCandle(bar - k); if (atr > 0 && c.High - c.Low >= VolMult * atr) continue;
                if (best < 0) { best = bar - k; continue; }
                var b = GetCandle(best);
                if (bearish ? c.High > b.High : c.Low < b.Low) best = bar - k;
            }
            return best;
        }
        private bool NewHigh(int bar, int size) { if (bar - size < 0) return false; var (m, _) = HighestSince(bar - size + 1, bar); return GetCandle(bar - size).High > m; }
        private bool NewLow(int bar, int size) { if (bar - size < 0) return false; var (m, _) = LowestSince(bar - size + 1, bar); return GetCandle(bar - size).Low < m; }

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
            if (bar < SwingLen + 20) return;
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

            // ---- higher-timeframe bias (built from chart bars, last completed HTF bar only)
            long bucket = (long)Math.Floor((tUtc - DateTime.UnixEpoch).TotalMinutes / TrendMinutes);
            if (bucket != _htfBucket)
            {
                if (_htfCur != null) { _htf.Add(_htfCur); UpdateHtfBias(); }
                _htfBucket = bucket; _htfCur = new[] { c.Open, c.High, c.Low, c.Close };
            }
            else { _htfCur[1] = Math.Max(_htfCur[1], c.High); _htfCur[2] = Math.Min(_htfCur[2], c.Low); _htfCur[3] = c.Close; }

            // ---- swing tier (one-sided confirmation)
            if (NewHigh(bar, SwingLen)) { _sHigh = GetCandle(bar - SwingLen).High; _sHighBar = bar - SwingLen; _sHighX = false; _trailTop = _sHigh; }
            if (NewLow(bar, SwingLen)) { _sLow = GetCandle(bar - SwingLen).Low; _sLowBar = bar - SwingLen; _sLowX = false; _trailBot = _sLow; }
            _trailTop = _trailTop == null ? c.High : Math.Max(_trailTop.Value, c.High); _trailBot = _trailBot == null ? c.Low : Math.Min(_trailBot.Value, c.Low);
            decimal biasMid = (_trailTop.Value + _trailBot.Value) / 2;
            bool sBullBreak = _sHigh != null && !_sHighX && c.Close > _sHigh, sBearBreak = _sLow != null && !_sLowX && c.Close < _sLow;
            if (sBullBreak) { _sHighX = true; _sBias = 1; }
            if (sBearBreak) { _sLowX = true; _sBias = -1; }
            decimal tol = 2 * Pip;
            if (_sHigh != null && !_sHighX && c.High > _sHigh && (!StrictSweep || c.Close < _sHigh)) { _sweepHiBar = bar; _sweepHiSess = Near(_sHigh.Value, _asiaH, tol) || Near(_sHigh.Value, _ldnH, tol) || Near(_sHigh.Value, _pdH, tol); }
            if (_sLow != null && !_sLowX && c.Low < _sLow && (!StrictSweep || c.Close > _sLow)) { _sweepLoBar = bar; _sweepLoSess = Near(_sLow.Value, _asiaL, tol) || Near(_sLow.Value, _ldnL, tol) || Near(_sLow.Value, _pdL, tol); }
            // ---- internal tier
            if (NewHigh(bar, IntLen)) { _iHigh = GetCandle(bar - IntLen).High; _iHighBar = bar - IntLen; _iHighX = false; }
            if (NewLow(bar, IntLen)) { _iLow = GetCandle(bar - IntLen).Low; _iLowBar = bar - IntLen; _iLowX = false; }
            bool iBullBreak = _iHigh != null && !_iHighX && c.Close > _iHigh, iBearBreak = _iLow != null && !_iLowX && c.Close < _iLow;
            bool iBullCHoCH = iBullBreak && _iBias == -1, iBearCHoCH = iBearBreak && _iBias == 1, iBullBOS = iBullBreak && _iBias == 1, iBearBOS = iBearBreak && _iBias == -1;
            int brokenLowBar = iBearBreak ? _iLowBar : -1, brokenHighBar = iBullBreak ? _iHighBar : -1;
            if (iBullBreak) { _iHighX = true; _iBias = 1; }
            if (iBearBreak) { _iLowX = true; _iBias = -1; }
            if (iBearCHoCH) { _chochBearBar = (_sweepHiBar >= 0 && bar - _sweepHiBar <= SweepMaxBars) ? bar : -1; _chochBearSess = _sweepHiSess; }
            if (iBullCHoCH) { _chochBullBar = (_sweepLoBar >= 0 && bar - _sweepLoBar <= SweepMaxBars) ? bar : -1; _chochBullSess = _sweepLoSess; }
            decimal body = Math.Abs(c.Close - c.Open), ab = AvgBody(bar, 10); bool disp = body >= DispMult * ab;
            bool tr2Bear = UseTR2 && iBearBOS && disp && _chochBearBar >= 0 && bar - _chochBearBar <= ChochMaxBars;
            bool tr2Bull = UseTR2 && iBullBOS && disp && _chochBullBar >= 0 && bar - _chochBullBar <= ChochMaxBars;
            bool tcBear = UseTC && iBearBOS && disp && _sBias == -1 && !tr2Bear, tcBull = UseTC && iBullBOS && disp && _sBias == 1 && !tr2Bull;
            _boxBreak[bar] = iBearBOS ? -1 : iBullBOS ? 1 : 0;
            int lookN = (tr2Bear || tcBear) ? bar - brokenLowBar : (tr2Bull || tcBull) ? bar - brokenHighBar : 0;

            if (bar != _lastBar) // create only once per bar
            {
                if (tr2Bear || tcBear) TryCreate(bar, true, tr2Bear ? "TR2" : "TC", tr2Bear && _chochBearSess, lookN, biasMid);
                else if (tr2Bull || tcBull) TryCreate(bar, false, tr2Bull ? "TR2" : "TC", tr2Bull && _chochBullSess, lookN, biasMid);
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
                bool flip = CancelOnFlip && !a.Touched && (a.Bear ? (iBullCHoCH || sBullBreak) : (iBearCHoCH || sBearBreak));
                bool invalid = (((a.Bear && c.Close > a.SL) || (!a.Bear && c.Close < a.SL)) && !a.WaitReact) || bar - a.Born > ZoneLife || flip;
                if (invalid) { if (a.ZoneRect != null) a.ZoneRect.SecondBar = bar; _act = null; }
                else if (a.ZoneRect != null) a.ZoneRect.SecondBar = bar + 3;
            }
        }

        // structure bias on the completed HTF bars: +1 after a bullish break of the last HTF swing high, -1 after a bearish break of the last swing low
        private void UpdateHtfBias()
        {
            int n = _htf.Count, L = TrendLen; if (n <= L) return;
            int i = n - 1; var piv = _htf[i - L];
            bool newHigh = true, newLow = true;
            for (int k = i - L + 1; k <= i; k++) { if (_htf[k][1] >= piv[1]) newHigh = false; if (_htf[k][2] <= piv[2]) newLow = false; }
            if (newHigh) { _hSH = piv[1]; _hSHX = false; }
            if (newLow) { _hSL = piv[2]; _hSLX = false; }
            decimal close = _htf[i][3];
            if (_hSH != null && !_hSHX && close > _hSH) { _hSHX = true; _htfBias = 1; }
            if (_hSL != null && !_hSLX && close < _hSL) { _hSLX = true; _htfBias = -1; }
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

        private void TryCreate(int bar, bool bearish, string model, bool sessLiq, int lookN, decimal biasMid)
        {
            lookN = Math.Max(lookN, 1);
            int j = OrderBlockBar(bar, lookN, bearish); if (j < 0) return;
            var z = GetCandle(j); decimal zt = Math.Max(z.Open, z.Close), zb = Math.Min(z.Open, z.Close), wt = z.High, wb = z.Low;
            decimal entry = bearish ? (EntryBody ? zb : wb) : (EntryBody ? zt : wt);
            decimal sl = bearish ? wt + SLBufPips * Pip : wb - SLBufPips * Pip;
            decimal slPips = Math.Abs(sl - entry) / Pip;
            if (slPips > MaxSLPips) return;
            if (BiasFilter && (bearish ? entry < biasMid : entry > biasMid)) return;
            if (TrendFilter && (bearish ? _htfBias != -1 : _htfBias != 1)) return;
            bool fvg = false; if (bar - j >= 2) { var c2 = GetCandle(j + 2); fvg = bearish ? c2.High < z.Low : c2.Low > z.High; }
            int score = 4 + (fvg ? 1 : 0) + (sessLiq ? 1 : 0) + (HiVol(z.Time.ToUniversalTime()) ? 1 : 0) + (model == "TR2" ? 1 : 0) + (slPips <= 20 ? 1 : 0);
            if (score < MinScore) return;
            var (cH, _) = HighestSince(bar - lookN, bar); var (cL, _) = LowestSince(bar - lookN, bar);
            var c = GetCandle(bar);
            var s = new Setup
            {
                Bear = bearish, Model = model, ZT = zt, ZB = zb, WT = wt, WB = wb, ZBar = j, BoxH = cH, BoxL = cL, BoxStart = bar - lookN,
                Born = bar, Entry = entry, SL = sl, Anchor = bearish ? cH : cL, Ext = bearish ? c.Low : c.High, Score = score, Fvg = fvg, SessLiq = sessLiq
            };
            var zoneColor = bearish ? System.Drawing.Color.FromArgb(70, 255, 82, 82) : System.Drawing.Color.FromArgb(70, 0, 230, 118);
            s.BoxRect = new DrawingRectangle(s.BoxStart, cH, bar, cL, new Pen(System.Drawing.Color.Gray), new SolidBrush(System.Drawing.Color.FromArgb(30, 144, 164, 174)));
            s.ZoneRect = new DrawingRectangle(j, EntryBody ? zt : wt, bar + 3, EntryBody ? zb : wb, new Pen(zoneColor), new SolidBrush(zoneColor));
            Rectangles.Add(s.BoxRect); Rectangles.Add(s.ZoneRect);
            AddText("zone" + bar, (bearish ? "SELL " : "BUY ") + model + " " + score + "/9  SL " + slPips.ToString("F0") + "p", bearish, bar, bearish ? wt : wb, Colors.White, bearish ? Colors.DarkRed : Colors.DarkGreen, 9f, DrawingText.TextAlign.Left);
            _act = s;
        }
    }
}
