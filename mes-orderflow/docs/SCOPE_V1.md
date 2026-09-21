# ES/MES order-flow desk — v1 scope (instrument decision)

**Status:** scope update, 21 Sep 2026. Supersedes any earlier wording that treated NQ or GC as v1 instruments or that
let the engines run on the chart's own symbol.

**Decision in one line:** the trader trades **MES only**. Every engine analyses **ES**; every order goes to **MES**
through ATAS Cross-Trading. NQ and GC are out of v1.

---

## 1. Instrument roles

| Role | Instrument | Why |
|---|---|---|
| **Analysis** | **ES** (CME E-mini S&P 500) | The deep book. Depth, MBO, big prints, walls and absorption are measured on ES because that is where the size sits. |
| **Execution** | **MES** (Micro E-mini S&P 500) | The contract actually traded. 1 MES = 1/10 of an ES in notional and dollar-per-tick. |
| **Bridge** | ATAS **Cross-Trading** | Chart and engines read ES; the order panel is bound to MES. One chart, two symbols. |

Rules that follow from this:

1. **No engine ever reads the MES book.** Depth, MBO, whale prints, walls, absorption, CVD, POC/VA are all computed
   from ES data. MES data is used for one thing only: the trader's own fills and P&L.
2. **Price is shared.** ES and MES track the same index to the tick. Levels found on ES (POC, VAH/VAL, walls,
   opening range) are placed on the MES order ticket at the same price.
3. **Size is not shared.** A size threshold is in ES contracts. When the same idea is expressed on MES, contracts are
   multiplied by 10 for notional comparison, never treated as equal.
4. Front month at the time of writing is the **December 2026** contract (`ESZ6` / `MESZ6`); September expired on
   18 Sep 2026. Rollover is a dated event in this spec, not a setting the engines discover on their own.

## 2. Instrument profile table

The table stays even though only one row is active. Adding NQ or GC later is a new row and a set of measured
thresholds, not a code change to the engines.

| Key | Exchange | Tick | Analysis tick value | Micro | Micro tick value | Session (ET) | v1 |
|---|---|---|---|---|---|---|---|
| **ES** | CME | **0.25** | **$12.50** | **MES** | **$1.25** | RTH 09:30–16:00, Globex 18:00–17:00 | **Active** |
| NQ | CME | 0.25 | $5.00 | MNQ | $0.50 | RTH 09:30–16:00, Globex 18:00–17:00 | Deferred (v2+) |
| GC | COMEX | 0.10 | $10.00 | MGC | $1.00 | Pit 08:20–13:30, Globex 18:00–17:00 | Deferred (v2+) |

Profile fields every row must carry before it can be activated: `tick_size`, `tick_value_analysis`,
`tick_value_execution`, `micro_ratio` (10 for all three), `analysis_symbol_pattern`, `execution_symbol_pattern`,
`session_calendar`, `roll_date_rule`, and the **measured** threshold block from section 4. A row without a measured
threshold block cannot be selected in the UI.

## 3. Phase 1 measurement — all on ES

Every measurement in Phase 1 is taken on an **ES** chart, with the feed and entitlement the trader actually has.
Nothing is measured on NQ, and nothing from the earlier MES recording (25 Aug – 3 Sep, `MESU6`) is reused for
thresholds, because it was taken on the thin book.

| # | Measurement | What we record | Pass condition for v1 |
|---|---|---|---|
| 1 | **Depth history** | Levels each side ATAS actually stores for ES (10? 20? full?), how far back depth history survives a restart, size of the local depth store per session. | At least 10 levels each side, history covering a full RTH session. |
| 2 | **MBO rate** | Whether the feed delivers Market-By-Order for ES, messages/second at the open (09:30–09:35 ET) and mid-day, dropped or coalesced updates. | MBO present and the bridge keeps up at the open without falling more than 1 s behind. |
| 3 | **Candle-series limits** | Maximum bars per series ATAS will load for ES at 1 s, 30 s, 1 m, 5 m under the current data plan; days of history; whether loading the max stalls the platform. | Enough 30 s bars for the opening range and enough 5 m bars for 20 sessions of value areas. |
| 4 | **Replay** | Whether ATAS Market Replay has ES depth recorded, replay speed at which the bridge still receives every event, and whether replay output is byte-for-byte the same as live for the same minute. | Replay usable for engine regression on at least one full ES session. |

Deliverable from Phase 1 is a filled-in copy of this table with the numbers, plus the threshold block in section 4
computed from the ES recording. Until that exists, the engines run with the placeholder thresholds and the
data-quality panel says so.

## 4. Thresholds, percentiles and tick logic — ES-denominated

All defaults below are **ES** numbers. They are expressed in ES ticks and ES contracts so that a threshold reads the
same on the chart, in the recorder and in the backtest.

| Item | Unit | Default | How it is set |
|---|---|---|---|
| Tick | price | **0.25** | Fixed by the exchange. |
| Tick value, analysis | USD | **$12.50** | ES. Used for every R-multiple, expectancy and "what the tape did" number. |
| Tick value, execution | USD | **$1.25** | MES. Used only for the trader's own fills, position P&L and risk-per-trade sizing. |
| Stop / target distances | ES ticks | from ATR, min 6 ticks (1.5 pts) | Never in dollars. Converting to MES dollars is display only. |
| Whale print size | ES contracts | **p95** of ES prints, measured per session bucket | Measured in Phase 1 on ES. Placeholder until then: 50 ES contracts. |
| Liquidity wall size | ES contracts resting at one level | **p90** of ES level sizes within 20 ticks of price | Measured on ES depth. Placeholder: 500 ES contracts. |
| Stacked imbalance | ratio, levels | 3:1, three consecutive ES levels | Ratio unchanged from earlier spec; must be re-verified on ES footprint. |
| Absorption | ES contracts at a level with ≤ 1 tick of movement | **p90** of ES cluster volume | Measured on ES cluster data. |
| CVD impulse | ES contracts per 1 m bar | **p85** of ES 1-minute |delta| | Measured on ES. |
| Percentile window | sessions | rolling 20 ES sessions, recomputed at 18:00 ET | Same window for all thresholds. |

Sizing bridge: risk per trade in dollars ÷ (stop distance in ticks × $1.25) = MES contracts to send. The same trade
expressed in ES contracts is that number ÷ 10, and that is the figure the analysis compares against the whale and wall
thresholds.

## 5. Data-quality panel

The panel is the guard that stops an MES chart from silently running the engines on MES's own thin book. It is
always visible and it is the first thing on the page.

Required rows:

| Row | Shows | Green | Red |
|---|---|---|---|
| **Analysis instrument** | Resolved symbol feeding the engines, e.g. `ESZ6`, plus feed name | Symbol matches the ES pattern in the profile table | Symbol is MES, another micro, or empty |
| **Execution instrument** | Symbol bound in Cross-Trading, e.g. `MESZ6`, plus account | Symbol matches the MES pattern and Cross-Trading is on | Cross-Trading off, or execution symbol equals analysis symbol |
| **Depth** | Levels received each side, age of last depth update | ≥ 10 levels, updated < 2 s ago | Fewer levels, stale, or not entitled |
| **MBO** | On / off, messages per second | Present and flowing | Absent (engines that need MBO show "OFF" in their own cards) |
| **Bars** | Series loaded and bar counts per timeframe, age of newest bar | Newest bar younger than one interval | Stale (this reuses the existing STALE banner) |
| **Thresholds** | "Measured on ES, 20 sessions ending <date>" or "PLACEHOLDER" | Measured | Placeholder |
| **Delay** | Live or delayed, and by how much | Live | Delayed (this reuses the existing DELAYED banner; signals not tradeable) |

Hard behaviours:

- If the analysis row is red because the engines are being fed by an **MES** symbol, the panel shows
  **"ANALYSIS ON MES BOOK — NOT SUPPORTED IN v1"**, every depth-dependent engine (walls, absorption, MBO, whale
  prints) is suppressed, and the signal reads `NODATA` rather than `WAIT`. It must not look like a quiet market.
- If the execution row is red, the signal still shows but the MANAGE panel and any size suggestion are hidden,
  because the numbers would be for the wrong contract.
- The panel is also written into every recorded idea, so a backtest can exclude ideas taken while any row was red.

## 6. Out of scope for v1

- NQ, MNQ, GC, MGC as analysis or execution instruments. Their profile rows exist; they cannot be activated.
- Any engine input taken from the MES book.
- Automatic contract rollover. Rollover is a dated manual switch of both symbols in the profile.

## 7. v2 backlog

1. **MES-only mode (optional, lower quality).** For a trader without an ES depth entitlement. Engines run on the MES
   book with thresholds rescaled by the micro ratio and re-measured on MES. It is opt-in, it is labelled
   **"MES-ONLY — LOWER QUALITY DATA"** in the data-quality panel and on every signal, depth-dependent engines carry
   a permanent warning, and ideas recorded in this mode are tagged so they are never pooled with ES-fed results.
2. Activate the NQ / MNQ row after its own Phase 1 measurement.
3. Activate the GC / MGC row after its own Phase 1 measurement; GC's tick logic (0.10, $10.00) is the first case
   where the tick block is not the ES one, so the profile table must be proven there before any other instrument.
4. Cluster-level absorption on ES (per price level per candle), carried over from the evidence memo.
