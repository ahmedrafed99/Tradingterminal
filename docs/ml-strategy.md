# ML Live Strategy

Live trading strategy that feeds **100-tick NQ bars** to a Python ML server and executes market orders based on its signals.

---

## Architecture

```
Trading Terminal (Node.js backend)
  └── mlNQStrategy.ts
        ├── spawns / connects to ML server (Python/Flask, port 17654)
        ├── warm-up: replays 220 historical 100-tick bars through /bar
        ├── live: polls every 30 s — fetches latest completed 100-tick bar
        │         POSTs bar → gets signal (long/short/flat)
        │         if signal != flat AND no open position:
        │           → place bare market entry (no brackets attached)
        │           → bracketEngine.trackEntry() waits for SignalR fill event
        │           → on fill: places SL (trailing or fixed) + all TPs as
        │             standalone limit orders concurrently
        └── reports actual fill price back to ML server via /trade_event
```

**ML server repo:** `C:\Users\ahmed\projects\MLTrading`  
**Entry point:** `live_server.py` (Flask, localhost only)  
**Model:** `models/deployed/model.pkl` + `models/deployed/metadata.json`

---

## Files

| File | Purpose |
|------|---------|
| `backend/src/strategies/ILiveStrategy.ts` | Interface all live strategies must implement |
| `backend/src/strategies/mlNQStrategy.ts` | ML NQ strategy implementation |
| `backend/src/services/bracketEngine.ts` | Event-driven bracket manager — places SL + multi-TP after actual fill |
| `backend/src/services/realtimeService.ts` | SignalR order event bus (bracketEngine subscribes for fill events) |
| `backend/src/services/liveStrategyManager.ts` | Registry + SSE broadcast hub |
| `backend/src/routes/liveStrategyRoutes.ts` | REST endpoints (`/strategies/*`) |
| `backend/src/types/bracket.ts` | Type definitions for BracketConfig, TrackEntryParams, etc. |
| `backend/src/utils/instrument.ts` | `ticksToPrice()`, `roundToTick()` helpers |
| `frontend/src/components/bottom-panel/StrategiesTab.tsx` | UI tab (status, signal, start/stop) |
| `frontend/src/services/liveStrategyService.ts` | Frontend API + SSE client |
| `frontend/src/store/slices/liveStrategySlice.ts` | Zustand store slice (not persisted) |
| `log/strategy-results.json` | Persisted trade results + running stats (created at runtime) |

---

## How to Use

1. Make sure the trading terminal backend and frontend are running
2. Open the **Strategies** tab in the bottom panel
3. Set your chart to the NQ contract you want to trade
4. Click **Start** on the ML NQ row
5. Pick account, confirm contract ID — click **Start Strategy**
6. Status: `Starting` → `Warming up (N bars)` → `Running`
7. Once running, signals and confidence update every 30 s (100-tick bar poll)

---

## Signal Execution Rules

- Only fires on `long` or `short` signals (never `flat`)
- **Ignores signals while already in a position** — exits are handled by the bracket set at entry
- Entry is a bare market order (no brackets attached at placement)
- **bracketEngine** picks up the actual fill price via SignalR, then places:
  - SL: trailing stop if `trade_config.trailing_stop=true`, otherwise fixed stop
  - TPs: all levels from `trade_config.targets` as separate limit orders, concurrently
- SL/TP distances and contract sizes come from the deployed model's `trade_config`
- Bid/ask sent to the ML server is approximated as `close ± (tickSize / 2)` — actual spread not available from the bar API
- Trade results (PnL, win rate, etc.) are appended to `log/strategy-results.json` when the position closes

---

## Constants (mlNQStrategy.ts)

| Constant | Value | Notes |
|----------|-------|-------|
| `WARMUP_BARS` | 220 | `atr_z` needs 200 bars min; 20 extra buffer |
| `POLL_INTERVAL_MS` | 30,000 ms | 100-tick bars have no fixed boundary |
| `WARMUP_LOOKBACK_MS` | 8 h | Enough to contain 220 tick bars in any session |
| `LIVE_LOOKBACK_MS` | 10 min | Latest completed tick bar |
| `TF_UNIT` | 7 | ProjectX chartApi: tick bars |
| `TF_UNIT_NUMBER` | 100 | 100-tick bars — matches model training |

---

## bracketEngine Integration

`bracketEngine.trackEntry()` is called right after placing the market entry order:

```typescript
bracketEngine.trackEntry({
  sessionId: orderId,          // doubles as session key
  accountId, contractId,
  entryOrderId: orderId,
  entryOrderPlacedAt,          // ISO timestamp captured before placing order
  entrySide,
  entrySize: total_contracts,
  config: {
    stopLoss: { ticks: slTicks, type: 'TrailingStop' | 'Stop' },
    takeProfits: [{ id: 'tp0', ticks, size }, ...],  // from model targets
    conditions: [],
  },
  contract: { tickSize, tickValue: tickSize * 2 },   // NQ: 1 tick = tickSize × $2
  callbacks: { onEntryFilled, onTpFilled, onSlFilled, onSlPlacementFailed, onSessionEnd },
});
```

- `onEntryFilled` — notifies ML server of actual fill price via `/trade_event`
- `onSlPlacementFailed` — logs CRITICAL warning (position is unprotected)
- On `stop()`: `bracketEngine.cancelSession(orderId)` cancels open SL + TP orders

---

## Trade Results (`log/strategy-results.json`)

```json
{
  "trades": [
    {
      "date": "2026-05-22",
      "entryTime": "...", "exitTime": "...",
      "signal": "short",
      "contracts": 2,
      "orderId": "...",
      "entryPrice": 21450.00, "exitPrice": 21445.00,
      "pnl": 25.00,
      "outcome": "win"
    }
  ],
  "stats": {
    "total": 1, "wins": 1, "losses": 0, "unknown": 0,
    "winRate": 100.0, "totalPnl": 25.00,
    "avgWin": 25.00, "avgLoss": null,
    "lastUpdated": "..."
  }
}
```

Exit is detected when the position closes (poll sees no open position for the contract). PnL uses size-weighted average fill prices across all entry + exit fills.

---

## Env Vars (optional overrides)

| Var | Default |
|-----|---------|
| `ML_SERVICE_URL` | `http://127.0.0.1:17654` |
| `ML_TRADING_DIR` | `C:\Users\ahmed\projects\MLTrading` |

---

## ML Server (`live_server.py`) — Key Details

- `MIN_BARS = 2 * ZSCORE_WINDOW + 1 = 201` — warm-up bars required before `ready=true`
- `BUFFER_MAX = MIN_BARS + 50 = 251` — ring buffer capacity
- Python logger writes to **stderr** → captured by Node.js → appears in debug log
- `ready = n_bars >= MIN_BARS and clf is not None`

---

## Adding Another Strategy

1. Create `backend/src/strategies/yourStrategy.ts` implementing `ILiveStrategy`
2. Add it to the `REGISTRY` array in `liveStrategyManager.ts`
3. It appears in the Strategies tab automatically

---

## Known Issues / Status (as of 2026-05-22)

- **`Feature matrix contains NaN or Inf`** — fixed. Three sources resolved in `MLTrading/pipeline/features.py`:
  1. `_rolling_zscore`: `sigma + 1e-8` → `np.maximum(sigma, 1e-4)` — constant spread features (bid/ask) had sigma=0
  2. `atr_safe`: `atr + 1e-8` → `np.maximum(atr, 1e-4)` — ATR can be 0.0 on flat overnight windows
  3. `pos5`: replaced `(c - lo5) / (hi5 - lo5 + 1e-8)` with `np.where(hi5 == lo5, 0.5, ...)` — float32 rounding residuals divided by 1e-8 produced Inf on flat 5-bar windows
  Column-level diagnostic added — if NaN/Inf reappears, the log names the exact column(s).

- **`bars:hard-fail` 400 on live polls** — benign. The ProjectX primary API rejects the request but the chartApi fallback succeeds. Bars are received correctly.

- **Warm-up fetches more bars than requested** — chartApi ignores `Countback` for tick resolutions. Fixed: 8 h window + `slice(-WARMUP_BARS)` defensive clamp.

- **Trailing stop distance unit** — ProjectX expects ticks, not points. Fixed: `Math.round(trailing_dist_pts / tickSize)` before passing to bracketEngine.

- **sklearn UserWarning `X does not have valid feature names`** — fires every bar. Benign. Can suppress with `warnings.filterwarnings` in `live_server.py` if noise is a problem.

- **Market hours filter not enforced** — model's `trade_config` has `market_hours_filter` but `live_server.py` never checks it. Signals can fire during maintenance hours. Not yet wired up.
