# Conditional Orders

Place orders automatically when a candle closes above or below a price. Runs 24/7 on a remote server (Synology NAS, VPS, etc.) independent of the browser.

## How it works

```
+-----------+         +-------------------------------+         +------------+
|  Frontend |--REST-->|  Backend (remote server)       |--REST->|  Exchange   |
|  (your PC)|<--SSE---|  condition engine + bar poller  |        |  (Gateway)  |
+-----------+         +-------------------------------+         +------------+
```

1. **You create a condition** via the frontend (e.g. "if 15m candle closes above 21500 -> buy 1 MNQ at market")
2. The condition is sent to the **remote backend** via REST and saved to `data/conditions.json`
3. The **bar aggregator** polls the exchange REST API (`/api/History/retrieveBars` with `includePartialBar: false`) aligned to candle boundaries — not on a fixed interval, but waking up exactly when each timeframe's candle closes (+ 3s buffer). When a new condition is armed, `reschedule()` also does an **immediate poll** for any timeframes whose candle closed within the last 10s, preventing a race where the reschedule cancels the pending poll timer
4. When a completed bar is detected, the engine evaluates all armed conditions for that contract+timeframe
5. If the bar's close price meets the condition, it **places the order** via the exchange adapter and validates the response (`success` field)
6. The frontend receives a **live SSE event** (triggered/failed) and shows a toast

## Architecture

- The condition engine lives inside the **existing Express backend** -- no separate server process
- It uses the same **adapter pattern** (`getAdapter().orders.place()`) so it works with any future exchange
- The frontend talks to the remote server via a configurable URL in Settings ("Conditional Orders Server")
- When the remote server is a different machine than your PC, your normal trading still goes through your local backend
- Same port (3001), same backend -- just deployed to a different machine

## Deployment

The backend is containerized and deployed to **Render** (free tier). It runs 24/7 independently of the frontend.

**Live URL**: `https://trading-conditions.onrender.com`

### Docker image

```bash
# Build (from project root)
docker build -t greenberet9/trading-conditions:latest .

# Push to Docker Hub
docker login
docker push greenberet9/trading-conditions:latest
```

### Render (current production)

1. Create a **Web Service** on [render.com](https://render.com)
2. Deploy from existing Docker Hub image: `greenberet9/trading-conditions:latest`
3. Set environment variables: `TOPSTEP_USERNAME`, `TOPSTEP_PASSWORD`
4. Render assigns a public HTTPS URL automatically — no port config needed

Render free tier spins down after inactivity. The frontend's axios client has a built-in retry (2s delay) to handle cold-start CORS errors transparently.

### Self-hosted alternative (Docker Compose)

For a second PC, Synology NAS, or VPS:

```bash
# 1. Copy .env.example -> .env and fill in credentials
cp .env.example .env

# 2. Pull and run
docker compose up -d
```

The `docker-compose.yml` references the Docker Hub image, so the target machine only needs Docker -- no Node.js, no source code.

### Frontend setup

In Settings, set **"Conditional Orders Server"** to the backend URL:
- Render: `https://trading-conditions.onrender.com`
- Self-hosted: `http://<machine-ip>:3001`

## Condition types

Currently supported:
- **Closes Above** -- triggers when candle close > trigger price
- **Closes Below** -- triggers when candle close < trigger price

Future candidates: crosses MA, volume spike, multi-condition chains.

## Chart-first interaction

The primary way to create conditions is directly on the chart via **Preview mode**. The form (modal) is kept as an alternative for precise entry.

### Preview mode (quick-create)

1. Open the **Conditions tab** in the bottom panel
2. Check the **Preview** checkbox in the tab bar
3. Two draggable dashed lines appear mid-chart, offset ~20 ticks above/below last price:
   - **Condition line** (blue): `[▲] [If Close Above 5m] [limit] [ARM] [✕]` — the trigger
   - **Order line** (green): `[Buy Limit] [1] [+SL] [+TP] [✕]` — the limit order to place
4. The **timeframe** is automatically set to whatever the chart is showing (e.g. 1m, 15m)

### Direction (auto-derived from line positions)

The condition direction is **automatically determined** by the relative position of the two lines — no manual toggle needed:
- **Condition line above order line** → Close Above + Buy Limit (▲ blue `#4a7dff`)
- **Condition line below order line** → Close Below + Sell Limit (▼ red `#d32f2f`)

When dragging either line past the other, the direction **flips in real-time**: arrow, condition text, line colors, order side, and SL/TP PnL labels all update instantly. This prevents accidental mis-configuration (e.g. a Close Above with a Sell).

### Order type toggle (limit/market)

The `limit` / `market` cell on the condition line toggles the order type:
- **limit** → order line is visible and draggable, SL/TP can be added
- **market** → a `[Buy Market] [size] [+SL] [+TP] [✕]` label appears to the **right** of the condition label on the same line. The condition label shifts to 30% of chart width and the market label sits at 65%. Both labels share the same Y position (same price). Dragging the condition line moves both labels together.

Both states share the same greyish-white bg (`#cac9cb`). Click to toggle. Switching from limit to market destroys existing SL/TP (user can re-add). Switching from market to limit restores the draggable order line at the condition price.

All clickable cells (limit/market, ARM, ✕, +SL, +TP) brighten on hover (`brightness(1.25)`) with a 0.15s transition. The arrow cell is not interactive — direction is controlled by line positions (limit only; direction is locked in market mode).

### Market mode details

- The market label has the same interaction as the limit order label: +/− size buttons, +SL, +TP
- The market label is **not draggable** (market orders have no target price)
- The ✕ on the market label **closes the preview**; the ✕ on the limit label switches to market mode
- SL/TP lines are placed relative to the market label's position; P&L updates in real-time when dragging the condition line
- At arm time, SL/TP **distances are computed from the current lastPrice** (not the visual label position), since the market order fills at current price

### Size adjustment (+/- buttons)

When no bracket preset is selected, the order line's size cell has **+/−** buttons (revealed on hover), built via `installSizeButtons()` from `labelUtils.ts` (same shared factory used by quick-order and overlay labels). These adjust `orderSize` directly. The **−** button is disabled when the order size equals the total TP contract sum, preventing the user from reducing order size below allocated TP contracts.

### Adding SL/TP (no preset)

When no bracket preset is selected, the order line label shows **+SL** and **+TP** buttons:
- **+SL** → adds a red SL line (draggable, ✕ to remove), offset 15 ticks from order price. Shows projected P&L via `formatSlPnl()`.
- **+TP** → adds a green TP line (draggable, ✕ to remove), offset 30+ ticks from order price. Shows projected P&L via `formatTpPnl()`.
- **Multiple TPs**: each TP has an independent size with its own +/− buttons (via `installSizeButtons()`). Click +TP again to add another TP as long as total TP contracts < order size.
- SL always tracks order size. TP sizes are independent.
- SL/TP distances are computed as price difference from the order line when arming
- Dragging the order line (limit) or condition line (market) updates SL/TP P&L labels in real-time

### Arming

- Click the **ARM** button on the condition line label → sends the condition to the backend via REST
- On success, a toast confirms and preview mode auto-closes
- **If a bracket preset is selected** when preview is toggled on → the condition **auto-arms immediately** with the preset's SL/TP config (no manual ARM click needed)

### Armed condition lines

Each armed condition renders **one line** on the chart:
- Dashed, color-coded: blue (`#2962ff`) for Close Above, red (`#d32f2f`) for Close Below
- Label: `[▲] [Above 1m] [✕]` — arrow cell uses directional color (blue `#4a7dff` / red `#d32f2f`)
- **Drag** → adjust trigger price on the server (PATCH)
- **Click** → open edit modal
- **✕** → delete condition

Lines are only visible when the chart's contract matches the condition's contract.

### Traditional form (modal)

The **ConditionModal** uses the shared `<Modal>` component (`shared/Modal.tsx`) for backdrop, Escape key, and click-outside behavior. Input fields use `INPUT_SURFACE` from `constants/styles.ts`. It is available for:
- Creating conditions from the bottom-panel Conditions tab ("+" button)
- Editing conditions via clicking an armed condition's label on the chart
- Editing conditions via the Conditions tab row

The modal provides full fields: condition type, trigger price, timeframe, side, order type (market/limit), size, bracket config (with preset support), label, and expiry. The timeframe defaults to the **currently active chart timeframe** (instead of a hardcoded 15m).

## Bracket orders

Each condition can optionally arm a **bracket order** (SL + TP) that activates after the condition-triggered order fills.

### How it works

- In the creation popover/modal, a **"Bracket" toggle** controls whether SL/TP are attached
- When enabled, SL and TP fields appear (points or price, matching the existing bracket config UX)
- On the chart, enabling bracket shows additional **preview lines** (SL in red, TP in green) that are draggable
- The bracket config is stored with the condition and sent to the backend

### Execution flow

1. Condition triggers → backend places the entry order (with native bracket params for SL/TP)
2. If bracket is enabled:
   - SL/TP are sent as native bracket params on the order placement call
   - The exchange gateway handles bracket lifecycle (stop loss and take profit)
3. If bracket is disabled → just the entry order, no SL/TP

### Backend bracket fields on condition

```typescript
bracket?: {
  enabled: boolean;
  sl?: { points: number };           // SL distance from fill price
  tp?: { points: number; size?: number }[];  // TP levels (supports multiple)
}
```

## Files to create

| Path | Purpose |
|------|---------|
| `backend/src/types/condition.ts` | Zod schemas + TypeScript types (includes bracket fields) |
| `backend/src/services/conditionStore.ts` | JSON file persistence |
| `backend/src/services/barAggregator.ts` | Candle-boundary-aligned REST polling for completed bars |
| `backend/src/services/conditionEngine.ts` | Condition evaluation + order execution (called by barAggregator) + bracket follow-up |
| `backend/src/routes/conditionRoutes.ts` | REST API + SSE endpoint |
| `frontend/src/services/conditionService.ts` | API client + SSE connection |
| `frontend/src/components/bottom-panel/ConditionsTab.tsx` | Conditions table in bottom panel |
| `frontend/src/components/bottom-panel/ConditionModal.tsx` | Create/edit condition form (modal) |
| `frontend/src/components/chart/hooks/useConditionLines.ts` | Orchestrator (decomposed into 5 sub-hooks: useArmedConditionLines, useArmedConditionDrag, useConditionPreview, useConditionPreviewDrag, useConditionLinesSync) |
| `frontend/src/components/chart/hooks/labelUtils.ts` | Shared label utilities (size buttons, PnL formatting, colors) used by condition, overlay, and quick-order hooks |
| `Dockerfile` | Multi-stage build for the backend (Node 20 Alpine, two-stage) |
| `docker-compose.yml` | Container orchestration (references Docker Hub image) |
| `.env.example` | Auto-connect credential template |

## Files to modify

| Path | Change |
|------|--------|
| `backend/src/index.ts` | Add condition routes, auto-connect from env vars, load conditions on boot, make PORT configurable |
| `frontend/src/store/slices/conditionsSlice.ts` | `conditionServerUrl`, `conditions[]`, `editingConditionId`, `conditionPreview`, and related setters (in `conditionsSlice`) |
| `frontend/src/components/SettingsModal.tsx` | Add "Conditional Orders Server" URL input |
| `frontend/src/components/bottom-panel/BottomPanel.tsx` | Add "Conditions" tab (visible when server URL is set) |
| `frontend/src/components/chart/CandlestickChart.tsx` | Wire `useConditionLines` hook into chart refs |
| `frontend/src/components/chart/hooks/types.ts` | Add condition-related line roles and drag state types |
| `frontend/src/App.tsx` | Mount `<ConditionModal />` |

## Key design decisions

- **Chart-first UX**: Creating and adjusting conditions happens directly on the chart via draggable `PriceLevelLine` instances — same interaction model as existing order lines. The modal form is a secondary path for precision or bulk editing.
- **Candle-boundary polling**: The bar aggregator uses REST polling aligned to candle close times — for a 1m condition it wakes at :00, :01, :02; for 15m at :00, :15, :30, :45; for 4h at 00:00, 04:00, 08:00, etc. A 3s buffer is added after each boundary to let the API finalize the bar. This avoids needing a second WebSocket connection (exchanges like TopStepX limit one per user). When a new condition is armed or resumed, the scheduler reschedules to the next boundary **and** does an immediate poll for any timeframes whose candle closed within the last 10s (prevents the race where `reschedule()` cancels the pending poll timer right after a candle close, which would skip that bar).
- **Optional bracket**: Each condition can optionally carry SL/TP config. On fill, the backend places bracket orders using the same adapter pattern. This is a toggle, not mandatory.
- **Exchange-agnostic**: Only calls through the generic `ExchangeAdapter` interface. Only auto-connect env vars are exchange-specific.
- **JSON file persistence**: `data/conditions.json` with in-memory array and debounced disk writes (500ms). Simple, no database needed.
- **SSE for live updates**: Frontend opens an EventSource to the condition server. Events: `triggered`, `failed`, `expired`, `deleted`, `updated`.
- **CORS `origin: true`**: Required so the frontend on your PC can talk to the remote backend.
- **Axios retry interceptor**: Render free tier cold-starts return error pages without CORS headers. The frontend's `getApi()` retries once after 2s on network errors, making cold-starts transparent to the user.
- **Render deployment**: Dockerized backend deployed to Render free tier via Docker Hub image. No VPC/firewall config needed — just set env vars and deploy. Timeout bumped to 30s to accommodate cold-start wake-up.
