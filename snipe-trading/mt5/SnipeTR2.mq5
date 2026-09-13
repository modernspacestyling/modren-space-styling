//+------------------------------------------------------------------+
//|  SnipeTR2.mq5  — Snipe TR2/TC setup Expert Advisor (v3 logic)     |
//|  Same rules as tradingview/SnipeSetup.pine and atas/SnipeOrderflow|
//|  Attach to XAUUSD M5 or M15. Backtest: Strategy Tester, "Every    |
//|  tick based on real ticks", 1 pip = 0.10 on gold.                 |
//+------------------------------------------------------------------+
#property copyright "snipe-trading"
#property version   "3.00"
#property strict
#include <Trade\Trade.mqh>

//---------------- inputs ----------------
input group "Structure"
input int    SwingLen      = 50;    // Swing structure length (external)
input int    IntLen        = 5;     // Internal structure length
input bool   StrictSweep   = true;  // Sweep must close back inside the swing level
input int    SweepMaxBars  = 60;    // Max bars sweep -> internal CHoCH
input int    ChochMaxBars  = 60;    // Max bars CHoCH -> consolidation break
input double DispMult      = 1.2;   // Break body >= x * avg body(10)
input bool   UseTR2        = true;
input bool   UseTC         = true;
input group "Fibonacci / bias"
input double FibLvl        = 0.764;
input double MinTargetRR   = 2.0;   // Min reward to ultimate target (R)
input bool   BiasFilter    = true;  // Sell only in premium / buy only in discount of swing range
input bool   TrendFilter   = true;  // Trade only with higher-timeframe structure
input ENUM_TIMEFRAMES TrendTF = PERIOD_H1;
input int    TrendLen      = 10;    // Trend swing length (HTF bars)
input group "Zone / risk"
input bool   EntryBody     = true;  // Zone edge on candle body (else wick)
input bool   ReactionEntry = true;  // Wait for a close back inside the zone, else limit at edge
input int    ReactMaxBars  = 6;
input double MaxSLPips     = 28;
input double SLBufPips     = 3;
input int    ZoneLife      = 100;
input bool   CancelOnFlip  = true;  // Cancel untested zone when structure flips against it
input double VolMult       = 2.0;   // Ignore candles with range >= x*ATR200 as zone
input double PipSize       = 0.10;
input group "Session (UTC)"
input int    SessStartUTC  = 7;
input int    SessEndUTC    = 15;
input bool   SkipFridayPM  = true;  // Skip Friday from 13:00 UTC
input int    ServerUTCOffset = 0;   // Broker server time minus UTC, hours (e.g. 3 for UTC+3)
input int    MinScore      = 5;
input group "Money management"
input double RiskPct       = 1.0;   // Risk per trade % of equity
input double BE_RR         = 1.0;   // Breakeven at (R), 0 = never
input double TP1_RR        = 2.0;
input double TP1_Pct       = 50;
input double TP2_RR        = 3.0;
input double TP2_Pct       = 30;
input int    MaxHoldBars   = 288;   // Time stop (bars)
input int    MaxTradesPerDay = 2;
input ulong  Magic         = 20260913;

//---------------- state ----------------
CTrade trade;
datetime lastBarTime = 0;
// swing tier
double sHigh = 0, sLow = 0; int sHighBar = -1, sLowBar = -1; bool sHighX = false, sLowX = false, sHighSet = false, sLowSet = false;
int sBias = 0, sLeg = 0; double trailTop = 0, trailBot = 0; bool trailSet = false;
int sweepHiBar = -1, sweepLoBar = -1;
// internal tier
double iHigh = 0, iLow = 0; int iHighBar = -1, iLowBar = -1; bool iHighX = false, iLowX = false, iHighSet = false, iLowSet = false;
int iBias = 0, iLeg = 0; int chochBearBar = -1, chochBullBar = -1;
int barCount = 0;   // running bar index of closed bars
// setup
struct Setup { bool active, bear, armed, touched, waitReact; string model; double zt, zb, wt, wb, entry, sl, anchor, ext, reactExt; int born, touchBar, score; };
Setup A;
// trade
double tRisk = 0, tTarget = 0, tSL0 = 0; bool tBear = false, tBE = false, tp1Done = false, tp2Done = false; double tMfe = 0; datetime tOpenTime = 0; double tLots0 = 0;
int tradesToday = 0; int tradesDay = -1;
// history buffers (series: index 0 = last CLOSED bar)
double H[], L[], O[], C[]; datetime T[];
double atr200 = 0;

//---------------- helpers ----------------
int  UtcHour(datetime t){ MqlDateTime d; TimeToStruct(t - ServerUTCOffset*3600, d); return d.hour; }
int  UtcDow(datetime t){ MqlDateTime d; TimeToStruct(t - ServerUTCOffset*3600, d); return d.day_of_week; }
bool InWindow(datetime t){ int h = UtcHour(t); if(h < SessStartUTC || h >= SessEndUTC) return false; if(SkipFridayPM && UtcDow(t) == 5 && h >= 13) return false; return true; }
bool HiVol(datetime t){ int h = UtcHour(t); return h == 7 || (h >= 12 && h < 14); }
double HighestN(int from, int n){ double m = -1e9; for(int i = from; i < from + n && i < ArraySize(H); i++) m = MathMax(m, H[i]); return m; }
double LowestN(int from, int n){ double m = 1e9; for(int i = from; i < from + n && i < ArraySize(L); i++) m = MathMin(m, L[i]); return m; }
double AvgBody(int n){ double s = 0; for(int i = 0; i < n; i++) s += MathAbs(C[i] - O[i]); return s / n; }
double Atr(int n){ double s = 0; for(int i = 0; i < n && i + 1 < ArraySize(H); i++){ double tr = MathMax(H[i] - L[i], MathMax(MathAbs(H[i] - C[i+1]), MathAbs(L[i] - C[i+1]))); s += tr; } return s / n; }

// structure bias on an arbitrary rates array (oldest -> newest order), leg-state pivots
int BiasOf(const MqlRates &r[], int n, int len)
{
   double sh = 0, sl = 0; bool shx = false, slx = false, shs = false, sls = false; int leg = 0, b = 0;
   for(int i = len; i < n; i++)
   {
      int prev = leg; double hp = r[i-len].high, lp = r[i-len].low; bool nh = true, nl = true;
      for(int k = i-len+1; k <= i; k++){ if(r[k].high >= hp) nh = false; if(r[k].low <= lp) nl = false; }
      if(nh) leg = -1; else if(nl) leg = 1;
      if(leg == -1 && prev != -1){ sh = hp; shx = false; shs = true; }
      if(leg == 1 && prev != 1){ sl = lp; slx = false; sls = true; }
      if(shs && !shx && r[i].close > sh){ shx = true; b = 1; }
      if(sls && !slx && r[i].close < sl){ slx = true; b = -1; }
   }
   return b;
}
int HtfBias()
{
   MqlRates r[]; ArraySetAsSeries(r, false);
   int n = CopyRates(_Symbol, TrendTF, 1, 400, r); if(n < TrendLen + 5) return 0;
   return BiasOf(r, n, TrendLen);
}

double LotsForRisk(double entry, double sl)
{
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE), tickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double lossPerLot = MathAbs(entry - sl) / tickSize * tickVal; if(lossPerLot <= 0) return 0;
   double lots = AccountInfoDouble(ACCOUNT_EQUITY) * RiskPct / 100.0 / lossPerLot;
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), mn = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), mx = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   lots = MathFloor(lots / step) * step; return MathMin(MathMax(lots, mn), mx);
}
bool HavePosition(){ for(int i = PositionsTotal()-1; i >= 0; i--){ ulong tk = PositionGetTicket(i); if(PositionSelectByTicket(tk) && PositionGetInteger(POSITION_MAGIC) == (long)Magic && PositionGetString(POSITION_SYMBOL) == _Symbol) return true; } return false; }

//---------------- setup creation ----------------
void TryCreate(bool bear, string model, int lookN, double biasMid, int htf)
{
   lookN = MathMax(lookN, 1);
   int best = -1;                      // series index of order-block candle among 0..lookN-1 (closed bars)
   for(int k = 0; k < lookN; k++){ if(H[k] - L[k] >= VolMult * atr200) continue; if(best < 0){ best = k; continue; } if(bear ? H[k] > H[best] : L[k] < L[best]) best = k; }
   if(best < 0) return;
   double zt = MathMax(O[best], C[best]), zb = MathMin(O[best], C[best]), wt = H[best], wb = L[best];
   double entry = bear ? (EntryBody ? zb : wb) : (EntryBody ? zt : wt);
   double sl = bear ? wt + SLBufPips * PipSize : wb - SLBufPips * PipSize;
   double slPips = MathAbs(sl - entry) / PipSize; if(slPips > MaxSLPips) return;
   if(BiasFilter && (bear ? entry < biasMid : entry > biasMid)) return;
   if(TrendFilter && (bear ? htf != -1 : htf != 1)) return;
   bool fvg = (best >= 2) ? (bear ? H[best-2] < L[best] : L[best-2] > H[best]) : false;
   int score = 4 + (fvg?1:0) + (HiVol(T[best])?1:0) + (model == "TR2"?1:0) + (slPips <= 20?1:0);
   if(score < MinScore) return;
   double cH = HighestN(0, lookN + 1), cL = LowestN(0, lookN + 1);
   A.active = true; A.bear = bear; A.model = model; A.zt = zt; A.zb = zb; A.wt = wt; A.wb = wb; A.entry = entry; A.sl = sl;
   A.anchor = bear ? cH : cL; A.ext = bear ? L[0] : H[0]; A.score = score; A.born = barCount; A.armed = false; A.touched = false; A.waitReact = false;
   PrintFormat("zone %s %s score %d entry %.2f sl %.2f", bear ? "SELL" : "BUY", model, score, entry, sl);
}

void OpenTrade(double entry, double sl, double target, bool bear)
{
   if(HavePosition()) return;
   MqlDateTime d; TimeToStruct(TimeCurrent(), d); if(tradesDay != d.day_of_year){ tradesDay = d.day_of_year; tradesToday = 0; }
   if(tradesToday >= MaxTradesPerDay) return;
   double lots = LotsForRisk(entry, sl); if(lots <= 0) return;
   trade.SetExpertMagicNumber(Magic);
   bool ok = bear ? trade.Sell(lots, _Symbol, 0, sl, 0, "SNIPE " + A.model) : trade.Buy(lots, _Symbol, 0, sl, 0, "SNIPE " + A.model);
   if(ok){ tRisk = MathAbs(entry - sl); tTarget = target; tSL0 = sl; tBear = bear; tBE = false; tp1Done = false; tp2Done = false; tMfe = 0; tOpenTime = TimeCurrent(); tLots0 = lots; tradesToday++; }
}

//---------------- per closed bar ----------------
void OnBar()
{
   int need = MathMax(SwingLen, 210) + 5;
   ArraySetAsSeries(H, true); ArraySetAsSeries(L, true); ArraySetAsSeries(O, true); ArraySetAsSeries(C, true); ArraySetAsSeries(T, true);
   if(CopyHigh(_Symbol, PERIOD_CURRENT, 1, need, H) < need) return;
   CopyLow(_Symbol, PERIOD_CURRENT, 1, need, L); CopyOpen(_Symbol, PERIOD_CURRENT, 1, need, O); CopyClose(_Symbol, PERIOD_CURRENT, 1, need, C); CopyTime(_Symbol, PERIOD_CURRENT, 1, need, T);
   barCount++;
   atr200 = Atr(200);
   int htf = TrendFilter ? HtfBias() : 0;

   // ---- swing tier (leg state)
   int prevS = sLeg;
   if(H[SwingLen] > HighestN(0, SwingLen)) sLeg = -1; else if(L[SwingLen] < LowestN(0, SwingLen)) sLeg = 1;
   if(sLeg == -1 && prevS != -1){ sHigh = H[SwingLen]; sHighBar = barCount - SwingLen; sHighX = false; sHighSet = true; trailTop = sHigh; trailSet = true; }
   if(sLeg == 1 && prevS != 1){ sLow = L[SwingLen]; sLowBar = barCount - SwingLen; sLowX = false; sLowSet = true; trailBot = sLow; }
   if(!trailSet){ trailTop = H[0]; trailBot = L[0]; trailSet = true; }
   trailTop = MathMax(trailTop, H[0]); trailBot = MathMin(trailBot, L[0]); double biasMid = (trailTop + trailBot) / 2;
   bool sBullBreak = sHighSet && !sHighX && C[0] > sHigh, sBearBreak = sLowSet && !sLowX && C[0] < sLow;
   if(sBullBreak){ sHighX = true; sBias = 1; }
   if(sBearBreak){ sLowX = true; sBias = -1; }
   if(sHighSet && !sHighX && H[0] > sHigh && (!StrictSweep || C[0] < sHigh)) sweepHiBar = barCount;
   if(sLowSet && !sLowX && L[0] < sLow && (!StrictSweep || C[0] > sLow)) sweepLoBar = barCount;
   // ---- internal tier
   int prevI = iLeg;
   if(H[IntLen] > HighestN(0, IntLen)) iLeg = -1; else if(L[IntLen] < LowestN(0, IntLen)) iLeg = 1;
   if(iLeg == -1 && prevI != -1){ iHigh = H[IntLen]; iHighBar = barCount - IntLen; iHighX = false; iHighSet = true; }
   if(iLeg == 1 && prevI != 1){ iLow = L[IntLen]; iLowBar = barCount - IntLen; iLowX = false; iLowSet = true; }
   bool iBullBreak = iHighSet && !iHighX && C[0] > iHigh, iBearBreak = iLowSet && !iLowX && C[0] < iLow;
   bool iBullCHoCH = iBullBreak && iBias == -1, iBearCHoCH = iBearBreak && iBias == 1, iBullBOS = iBullBreak && iBias == 1, iBearBOS = iBearBreak && iBias == -1;
   int brokenLowBar = iBearBreak ? iLowBar : -1, brokenHighBar = iBullBreak ? iHighBar : -1;
   if(iBullBreak){ iHighX = true; iBias = 1; }
   if(iBearBreak){ iLowX = true; iBias = -1; }
   if(iBearCHoCH) chochBearBar = (sweepHiBar >= 0 && barCount - sweepHiBar <= SweepMaxBars) ? barCount : -1;
   if(iBullCHoCH) chochBullBar = (sweepLoBar >= 0 && barCount - sweepLoBar <= SweepMaxBars) ? barCount : -1;
   bool disp = MathAbs(C[0] - O[0]) >= DispMult * AvgBody(10);
   bool tr2Bear = UseTR2 && iBearBOS && disp && chochBearBar >= 0 && barCount - chochBearBar <= ChochMaxBars;
   bool tr2Bull = UseTR2 && iBullBOS && disp && chochBullBar >= 0 && barCount - chochBullBar <= ChochMaxBars;
   bool tcBear = UseTC && iBearBOS && disp && sBias == -1 && !tr2Bear, tcBull = UseTC && iBullBOS && disp && sBias == 1 && !tr2Bull;
   if(tr2Bear || tcBear) TryCreate(true, tr2Bear ? "TR2" : "TC", barCount - brokenLowBar, biasMid, htf);
   else if(tr2Bull || tcBull) TryCreate(false, tr2Bull ? "TR2" : "TC", barCount - brokenHighBar, biasMid, htf);

   // ---- manage active setup
   if(A.active)
   {
      if(!A.touched && barCount > A.born)
      {
         A.ext = A.bear ? MathMin(A.ext, L[0]) : MathMax(A.ext, H[0]);
         double rng = MathAbs(A.anchor - A.ext), gate = A.bear ? A.ext + FibLvl * rng : A.ext - FibLvl * rng;
         bool rewardOK = MathAbs(A.ext - A.entry) >= MinTargetRR * MathAbs(A.sl - A.entry);
         A.armed = rewardOK && (A.bear ? A.entry >= gate - PipSize : A.entry <= gate + PipSize);
         bool touch = A.bear ? H[0] >= A.entry : L[0] <= A.entry;
         if(touch)
         {
            A.touched = true; A.touchBar = barCount;
            if(A.armed && InWindow(T[0]))
            {
               if(ReactionEntry){ A.waitReact = true; A.reactExt = A.bear ? H[0] : L[0]; }
               else OpenTrade(A.entry, A.sl, A.ext, A.bear);   // market at next tick (limit fill approximation)
            }
         }
      }
      else if(A.waitReact && barCount > A.touchBar)
      {
         A.reactExt = A.bear ? MathMax(A.reactExt, H[0]) : MathMin(A.reactExt, L[0]);
         bool reacted = A.bear ? (C[0] < A.zb && C[0] < O[0]) : (C[0] > A.zt && C[0] > O[0]);
         bool failed = A.bear ? C[0] > A.wt : C[0] < A.wb;
         if(reacted)
         {
            double rSL = A.bear ? A.reactExt + SLBufPips * PipSize : A.reactExt - SLBufPips * PipSize, rPips = MathAbs(rSL - C[0]) / PipSize;
            if(rPips <= MaxSLPips && MathAbs(A.ext - C[0]) >= MinTargetRR * MathAbs(rSL - C[0])) OpenTrade(C[0], rSL, A.ext, A.bear);
            A.waitReact = false;
         }
         else if(failed || barCount - A.touchBar > ReactMaxBars) A.waitReact = false;
      }
      bool flip = CancelOnFlip && !A.touched && (A.bear ? (iBullCHoCH || sBullBreak) : (iBearCHoCH || sBearBreak));
      bool invalid = (((A.bear && C[0] > A.sl) || (!A.bear && C[0] < A.sl)) && !A.waitReact) || barCount - A.born > ZoneLife || flip;
      if(invalid) A.active = false;
   }
}

//---------------- trade management (every tick) ----------------
void ManageTrade()
{
   for(int i = PositionsTotal()-1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i); if(!PositionSelectByTicket(tk)) continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)Magic || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      double ep = PositionGetDouble(POSITION_PRICE_OPEN), vol = PositionGetDouble(POSITION_VOLUME), cur = PositionGetDouble(POSITION_PRICE_CURRENT), sl = PositionGetDouble(POSITION_SL);
      if(tRisk <= 0) tRisk = MathAbs(ep - sl);
      double r = tBear ? (ep - cur) / tRisk : (cur - ep) / tRisk; tMfe = MathMax(tMfe, r);
      double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), mn = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      if(!tp1Done && r >= TP1_RR && TP1_Pct > 0){ double q = MathFloor(tLots0 * TP1_Pct / 100 / step) * step; if(q >= mn && q < vol) trade.PositionClosePartial(tk, q); tp1Done = true; }
      if(!tp2Done && r >= TP2_RR && TP2_Pct > 0){ vol = PositionGetDouble(POSITION_VOLUME); double q = MathFloor(tLots0 * TP2_Pct / 100 / step) * step; if(q >= mn && q < vol) trade.PositionClosePartial(tk, q); tp2Done = true; }
      if(!tBE && BE_RR > 0 && tMfe >= BE_RR){ double be = NormalizeDouble(ep, _Digits); if((tBear && be < sl) || (!tBear && be > sl)) trade.PositionModify(tk, be, PositionGetDouble(POSITION_TP)); tBE = true; }
      bool hitTarget = tBear ? cur <= tTarget : cur >= tTarget;
      int barsHeld = (int)((TimeCurrent() - tOpenTime) / PeriodSeconds());
      if(hitTarget || barsHeld >= MaxHoldBars) trade.PositionClose(tk);
   }
}

//---------------- events ----------------
int OnInit(){ trade.SetExpertMagicNumber(Magic); trade.SetDeviationInPoints(30); A.active = false; return INIT_SUCCEEDED; }
void OnTick()
{
   ManageTrade();
   datetime t0 = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(t0 != lastBarTime){ lastBarTime = t0; OnBar(); }
}
