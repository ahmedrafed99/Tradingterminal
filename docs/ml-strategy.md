# ML Live Strategy

Live trading strategy that feeds 1-minute NQ bars to a Python ML server and executes market orders based on its signals.

---

## Architecture

```
Trading Terminal (Node.js backend)
  └── mlNQStrategy.ts
        ├── spawns / connects to ML server (Python/Flask, port 17654)
        ├── warm-up: replays 220 historical 100-tick bars through /bar
        ├── live: polls every 30 s — fetches latest completed 100-tick bar
        │         POSTs bar → gets signal (long/short/flat)
        │         if signal != flat AND no open position → place market order + trailing stop/SL + TP brackets
        └── reports fills back to ML server via /trade_event
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
| `backend/src/services/liveStrategyManager.ts` | Registry + SSE broadcast hub |
| `backend/src/routes/liveStrategyRoutes.ts` | REST endpoints (`/strategies/*`) |
| `frontend/src/components/bottom-panel/StrategiesTab.tsx` | UI tab (status, signal, start/stop) |
| `frontend/src/services/liveStrategyService.ts` | Frontend API + SSE client |
| `frontend/src/store/slices/liveStrategySlice.ts` | Zustand store slice (not persisted) |

---

## How to Use

1. Make sure the trading terminal backend and frontend are running
2. Open the **Strategies** tab in the bottom panel
3. Set your chart to the NQ contract you want to trade
4. Click **Start** on the ML NQ row
5. Pick account, confirm contract ID — click **Start Strategy**
6. Status: `Starting` → `Warming up (N bars)` → `Running`
7. Once running, signals and confidence update every 1m bar close

---

## Signal Execution Rules

- Only fires on `long` or `short` signals (never `flat`)
- **Ignores signals while already in a position** — exits are handled by the SL bracket set at entry
- SL distance and contract size come from the deployed model's `trade_config` (`sl_pts`, `total_contracts`)
- Bid/ask sent to the ML server is approximated as `close ± (tickSize / 2)` — actual spread not available from the bar API

---

## Env Vars (optional overrides)

| Var | Default |
|-----|---------|
| `ML_SERVICE_URL` | `http://127.0.0.1:17654` |
| `ML_TRADING_DIR` | `C:\Users\ahmed\projects\MLTrading` |

---

## Adding Another Strategy

1. Create `backend/src/strategies/yourStrategy.ts` implementing `ILiveStrategy`
2. Add it to the `REGISTRY` array in `liveStrategyManager.ts`
3. It appears in the Strategies tab automatically

---

## Known Issues / Status (as of 2026-05-21)

- **`Feature matrix contains NaN or Inf`** — fixed. Three sources identified and resolved in `MLTrading/pipeline/features.py`:
  1. `_rolling_zscore`: `sigma + 1e-8` → `np.maximum(sigma, 1e-4)` — constant spread features (bid/ask) had sigma=0
  2. `atr_safe`: `atr + 1e-8` → `np.maximum(atr, 1e-4)` — ATR can be 0.0 on flat overnight windows
  3. `pos5`: replaced `(c - lo5) / (hi5 - lo5 + 1e-8)` with `np.where(hi5 == lo5, 0.5, ...)` — float32 rounding residuals (~3e-4) divided by 1e-8 produced Inf; short-circuit avoids division entirely on flat windows
  A column-level diagnostic was also added — if NaN/Inf still appears, the log will name the exact column(s).
- **`bars:hard-fail` 400 on live polls** — benign. The ProjectX primary API rejects the request but the chartApi fallback succeeds. Bars are received correctly.
