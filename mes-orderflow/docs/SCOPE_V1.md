# ES/MES order-flow desk — v1 scope (instrument decision)

**Status:** scope update, 21 Sep 2026, plus the data-provider update of the same day. Supersedes any earlier
wording that treated NQ or GC as v1 instruments, that let the engines run on the chart's own symbol, or that assumed
Rithmic data (MBO, Market Replay, non-time bar types).

**Decision in one line:** the trader trades **MES only**. Every engine analyses **ES** on a **dxFeed** data
connection; every order goes to **MES** through ATAS Cross-Trading on a separate execution connector. NQ and GC are
out of v1. MBO and Market Replay are out of v1 because dxFeed does not provide them.

Engine numbers (E1, E2, ...) and phase numbers (Phase 1, Phase 7) below follow the numbering of the main engine
spec; this document only records scope decisions against them.

---

## 1. Instrument roles

| Role | Instrument | Why |
|---|---|---|
| **Analysis** | **ES** (CME E-mini S&P 500) | The deep book. Depth (MBP on dxFeed), big prints, walls and absorption are measured on ES because that is where the size sits. |
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

Every measurement in Phase 1 is taken on an **ES** chart on the **dxFeed** connection, with the entitlement the
trader actually has. Nothing is measured on NQ, and nothing from the earlier MES recording (25 Aug – 3 Sep,
`MESU6`) is reused for thresholds, because it was taken on the thin book.

| # | Measurement | What we record | Pass condition for v1 |
|---|---|---|---|
| 1 | **Depth history** | Levels each side ATAS actually stores for ES (10? 20? full?), how far back depth history survives a restart, size of the local depth store per session. | At least 10 levels each side, history covering a full RTH session. |
| 2 | **MBO rate** | *Deferred.* dxFeed has no Market-By-Order. This row is measured only when a Rithmic connection exists (see section 3c). | Not required for v1. |
| 3 | **Candle-series limits** | Maximum bars per series ATAS will load for ES at 1 s, 30 s, 1 m, 5 m under the current data plan; days of history; whether loading the max stalls the platform. | Enough 30 s bars for the opening range and enough 5 m bars for 20 sessions of value areas. |
| 4 | **Depth snapshots (dxFeed)** | Whether `GetMarketDepthSnapshotsAsync` returns anything for ES on dxFeed, and if so how many levels and how far back. | Returns data. If it returns nothing, depth history comes only from the live recorder (section 3b). |
| 5 | **Cumulative trades (dxFeed)** | Whether `GetCumulativeTradesMaxDepth` returns a non-zero depth for ES on dxFeed, and whether Big Trades reconstruction produces the same prints as the raw tape. | Non-zero depth and reconstruction matches. Until then no engine relies on cumulative-trade (Big Trades) reconstruction. |
| 6 | **Trade direction (dxFeed)** | Whether ES trades arrive with an exchange-tagged aggressor side, or whether ATAS infers direction from bid/ask. Record the inference rule if inferred. | Direction source known and written into the threshold block. Inferred delta means every delta threshold is marked "inferred" in the panel. |
| 7 | **Depth update rate and levels (dxFeed)** | Depth updates per second for ES at the open and mid-day, and the number of price levels each side dxFeed actually delivers. | ≥ 10 levels each side, updates keep pace at the open. |
| 8 | **Candle-series timeframes (dxFeed)** | Which second and minute timeframes ATAS will build for ES on dxFeed, and which ones carry footprint (bid/ask per level). | 1 m and 5 m with footprint; 30 s if available for the opening range, otherwise the opening range is built from 1 m. |

Deliverable from Phase 1 is a filled-in copy of this table with the numbers, plus the threshold block in section 4
computed from the ES recording. Until that exists, the engines run with the placeholder thresholds and the
data-quality panel says so.

### 3a. Data provider: dxFeed

The live data provider is **dxFeed**, not Rithmic. What that changes:

| Capability | On dxFeed | Consequence for v1 |
|---|---|---|
| Market-By-Order (MBO) | Not available | **E2 (MBO engine) disabled.** No use of `IMboAnalyticsDataProvider`. Dashboard shows **"MBO: NOT AVAILABLE (dxFeed)"**. **Phase 7 deferred** until a Rithmic connection exists. |
| Market Replay | Does not work on dxFeed charts | Replay removed from the test plan. See section 3b. |
| Depth | Price-level only (MBP) | Every liquidity, absorption and delta feature must work on MBP alone. No feature may require order-level data. |
| Bar types | No Delta, Reversal, Order Flow, Cumulative Trades, or Range X / XV / Z / US bars | **Build and test only on minute bars.** Footprints exist only on minute and second bars. |
| Cumulative trades (Big Trades) | Unconfirmed | Not relied on until Phase 1 row 5 confirms reconstruction works on dxFeed. Whale-print engine runs from the raw tape until then. |
| Trade direction | Unconfirmed | Phase 1 row 6 decides whether delta is exchange-tagged or inferred. |

### 3b. Integration testing without Replay

Integration testing is two things, and nothing else:

1. **Live-session logging to CSV.** The bridge writes every depth update, trade and bar it receives from the ES
   dxFeed connection during a live session, with receive timestamps, into per-session CSV files. These are the
   fixtures.
2. **Recorded fixtures replayed through Core unit tests.** The engine core takes a fixture and produces the same
   signals, panel states and recorded ideas every run. A change to an engine is validated by re-running every
   stored fixture; a difference in output is a test failure unless the change intended it.

Fixtures are kept for at least one full RTH session, one London session, and one session that contains a red
data-quality state, so the guard behaviours in section 5 have a regression test.

### 3c. Rithmic / MBO path kept as a feature flag

The Rithmic and MBO code path stays in the design behind a single feature flag (`DataProvider = dxFeed | Rithmic`,
default `dxFeed`). With the flag on `dxFeed`:

- E2 is not constructed, `IMboAnalyticsDataProvider` is never requested, and the MBO panel row is fixed to
  "NOT AVAILABLE (dxFeed)".
- Engines that can use MBO when present (walls, absorption) take an MBP-only input by default and an optional MBO
  input that is `null` on dxFeed. They must be complete and correct with the MBO input absent.

Switching the flag to `Rithmic` later enables E2, Phase 7 and the MBO measurements without restructuring any
engine. No engine may branch on the provider anywhere except at construction.

### 3d. Connections

- **dxFeed is data only.** It is the Quote Provider for the ES chart and for the engines.
- **The execution account is a separate connector** (the broker connection that carries MES) with **Quote Provider
  unticked**, so it never streams ES or MES quotes into the platform.
- **The data layer must detect and warn if two connectors both stream ES.** On start and on every connector state
  change, the bridge lists the connectors that publish ES quotes. If more than one does, the data-quality panel
  shows **"TWO FEEDS ON ES — untick Quote Provider on the execution connector"** in red, and the engines keep
  running on the dxFeed connector only.

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
| CVD impulse | ES contracts per 1 m bar | **p85** of ES 1-minute |delta| | Measured on ES. If Phase 1 row 6 shows delta is inferred on dxFeed, this and every delta threshold carry an "inferred" tag in the panel. |
| Bar basis | timeframe | 1 m (engines), 5 m (value area), 30 s if dxFeed builds it (opening range) | Minute and second bars only. No Delta, Reversal, Order Flow, Cumulative Trades or Range bars on dxFeed. |
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
| **Data provider** | Provider name and connector, e.g. `dxFeed` | dxFeed connected, Quote Provider on | Disconnected, or a second connector also streaming ES ("TWO FEEDS ON ES") |
| **MBO** | Fixed text on dxFeed: **"MBO: NOT AVAILABLE (dxFeed)"**. With the Rithmic flag: on / off, messages per second | Rithmic: present and flowing. dxFeed: row is grey, not red, because it is expected | Rithmic: absent (E2 shows "OFF") |
| **Depth type** | `MBP` (price-level) on dxFeed; `MBO` when the Rithmic flag is on | Matches the active provider | Mismatch between provider and depth type |
| **Bars** | Series loaded and bar counts per timeframe, age of newest bar | Newest bar younger than one interval | Stale (this reuses the existing STALE banner) |
| **Thresholds** | "Measured on ES, 20 sessions ending <date>" or "PLACEHOLDER", plus "delta: exchange-tagged" or "delta: inferred" | Measured | Placeholder |
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
- E2 (MBO engine), `IMboAnalyticsDataProvider`, and Phase 7, until a Rithmic connection exists.
- ATAS Market Replay as a test tool.
- Any bar type other than minute (and second, where dxFeed builds it) bars.
- Any feature that needs order-level (MBO) depth rather than price-level (MBP) depth.

## 7. v2 backlog

1. **MES-only mode (optional, lower quality).** For a trader without an ES depth entitlement. Engines run on the MES
   book with thresholds rescaled by the micro ratio and re-measured on MES. It is opt-in, it is labelled
   **"MES-ONLY — LOWER QUALITY DATA"** in the data-quality panel and on every signal, depth-dependent engines carry
   a permanent warning, and ideas recorded in this mode are tagged so they are never pooled with ES-fed results.
2. Activate the NQ / MNQ row after its own Phase 1 measurement.
3. Activate the GC / MGC row after its own Phase 1 measurement; GC's tick logic (0.10, $10.00) is the first case
   where the tick block is not the ES one, so the profile table must be proven there before any other instrument.
4. Cluster-level absorption on ES (per price level per candle), carried over from the evidence memo.
5. **Rithmic connection:** flip the provider flag, run the MBO measurements (Phase 1 row 2), enable E2 and Phase 7.
6. Cumulative-trade (Big Trades) reconstruction as a whale-print source, once Phase 1 row 5 confirms it on dxFeed.
