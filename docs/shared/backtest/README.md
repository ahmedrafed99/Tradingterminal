# Feature: Strategy Lab (Backtesting)

Full backtesting engine for crypto tick data. Replays raw trade ticks from Binance CSV exports, renders a progressive candlestick chart, and executes user-written strategies with tick-accurate stop/target fills.

**Status**: Implemented  
**Route branch**: `Strategy-feature`

---

## Overview

| Concern | Approach |
|---|---|
| Data source | Binance trade CSV files (`{SYMBOL}-trades-{YYYY}-{MM}.zip`) |
| Storage layout | `backend/data/tick-data/{EXCHANGE}/{SYMBOL}/{YYYY}-{MM}.csv` |
| Speed cache | `{YYYY}-{MM}.1m.json` — pre-aggregated 1-minute OHLCV per month |
| Chart delivery | SSE stream — months sent one-by-one, chart renders each chunk immediately |
| Strategy fills | Tick-accurate — every raw tick is checked against stop/target price |
| Sandbox | `vm.runInNewContext` — strategy code runs in an isolated V8 context |

---

## Data Pipeline

### Step 1 — Extract

```
npm run extract-ticks --prefix backend
```

Script: `backend/src/scripts/extractTickData.ts`

- Scans `TICK_DATA_PATH` (default `C:/Users/ahmed/projects/cryptoBot/tick_data`) for Binance ZIP/CSV files
- Parses filename: `BTCUSDT-trades-2025-05.zip` → exchange=`BINANCE`, symbol=`BTCUSDT`, month=`2025-05`
- **Step 1**: Extracts ZIP → `data/tick-data/BINANCE/BTCUSDT/2025-05.csv`
- **Step 2**: Streams CSV → builds `2025-05.1m.json` (44 640 bars for a full month)
- Both steps are individually skipped if the output already exists

### CSV Schema (no header)

```
trade_id, price, qty_base, qty_quote, timestamp_microseconds, is_buyer_maker, is_best_match
```

Timestamp is in **microseconds**. Converted to seconds with `/ 1_000_000`.

### Step 2 — Runtime aggregation

When a chart or strategy run is requested, `backtestDataService.ts`:

1. Reads the `.1m.json` file(s) for every month in the requested range (builds on first access if missing)
2. Filters bars to `[fromMs, toMs]`
3. Re-aggregates to the target timeframe using `aggregateBars(bars1m, periodSec)`

---

## Backend API

All routes mounted at `/backtest`.

| Method | Path | Description |
|---|---|---|
| GET | `/symbols` | Lists all `{exchange, symbol}` pairs that have extracted CSV data |
| GET | `/range` | Returns `{ from, to }` for the available date range of a symbol |
| GET | `/bars` | Returns all aggregated bars for a range (used internally; cached) |
| GET | `/bars/stream` | **SSE** — streams aggregated bars month-by-month as they load |
| POST | `/run` | **SSE** — runs a strategy over ticks, streams equity points + final result |

### SSE event types

**`/bars/stream`**

| Event | Payload |
|---|---|
| `chunk` | `OhlcvBar[]` — one month of aggregated bars |
| `done` | `{}` |
| `error` | `{ message: string }` |

**`/run`**

| Event | Payload |
|---|---|
| `status` | `{ message: string }` — e.g. "Processing 2025-06..." |
| `equity` | `{ t: string, equity: number }` — mark-to-market equity after each closed bar |
| `done` | Full `StrategyResult` object |
| `error` | `{ message: string }` |

---

## Strategy Execution Engine

File: `backend/src/routes/backtestRoutes.ts` → `runStrategy()`

### Tick loop

```
for each raw tick (tickMs, price, qty):
  1. Determine bar period (floor tickMs to periodSec boundary)
  2. If new period → finalize previous bar → call strategy onBar
  3. Update current bar OHLCV
  4. If position open → check stop/target at EXACT tick price → fill if hit
```

Stops and targets fill at the exact tick price that crosses them, not at bar high/low. This is the primary reason for using tick data.

### Strategy context (per closed bar)

```js
bar        // { open, high, low, close, volume, time }
prevBars   // last 100 closed bars (same shape)
position   // current qty: positive = long, negative = short, 0 = flat
equity     // current equity (realised only)
state      // persistent plain object — survives across bars

buy(qty)           // open long at bar close price
sell(qty)          // open short at bar close price
close()            // close position at bar close price
setStop(price)     // set stop price (checked tick-by-tick)
setTarget(price)   // set target price (checked tick-by-tick)
```

Only one position at a time. `buy`/`sell` are no-ops if already in a position.

### Result metrics

| Field | Description |
|---|---|
| `trades` | Full trade log (entry/exit time, side, prices, qty, P&L) |
| `equityCurve` | Mark-to-market equity after every closed bar |
| `finalEquity` | Realised equity at end |
| `totalReturn` | `(finalEquity - initialEquity) / initialEquity * 100` |
| `winRate` | Winners / total trades (%) |
| `totalTrades` | Count |
| `maxDrawdown` | Max peak-to-trough drawdown (%) |
| `sharpe` | Annualised Sharpe ratio (bar-level returns, √252 scaling) |

---

## Frontend

### UI entry point

`frontend/src/components/backtest/StrategyLabModal.tsx` — full-screen modal, opened from the top bar.

Header controls:
- **Symbol selector** — dropdown populated from `GET /backtest/symbols`
- **Date range** — opens `DateRangePicker`, dates constrained to available data range
- **Timeframe** — 1m, 3m, 15m, 1h, 4h, D
- **Script** — toggle collapsible strategy code editor
- **Run / Stop** — starts or aborts the strategy run

### Chart

`CandlestickChart` with `chartId="backtest"` and `backtestConfig={{ exchange, symbol, dateFrom, dateTo }}`.

`useChartBars` detects `backtestConfig` and switches to streaming mode:
- Calls `backtestService.streamBars()` (SSE fetch)
- Appends each incoming chunk to an accumulated array
- Calls `series.setData(accumulated)` after each chunk — candles appear progressively
- On first chunk: configures price format, enables autoScale, sets initial viewport
- Viewport: `from = total - 200`, `to = total + 50` — consistent zoom regardless of bar count

### Services / Store

| File | Purpose |
|---|---|
| `frontend/src/services/backtestService.ts` | `streamBars()`, `runStrategy()`, `getBars()`, `getSymbols()` |
| `frontend/src/store/slices/backtestSlice.ts` | Persisted: exchange, symbol, timeframe, date range, strategy code |
| `frontend/src/components/backtest/EquityCurveChart.tsx` | Live equity curve chart (lightweight-charts line series) |

---

## Adding a new symbol

1. Place Binance ZIP/CSV files in `TICK_DATA_PATH` with the naming pattern `{SYMBOL}-trades-{YYYY}-{MM}.zip`
2. Run `npm run extract-ticks --prefix backend [-- --exchange BYBIT]` (default exchange is `BINANCE`)
3. Symbol appears automatically in the Strategy Lab dropdown

To override the data path: set `TICK_DATA_DIR` env var on the backend.
