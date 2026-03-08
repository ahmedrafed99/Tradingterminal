# Conditional Orders

Place orders automatically when a candle closes above or below a price. Runs 24/7 on a remote server (Synology NAS, VPS, etc.) independent of the browser.

## How it works

```
+-----------+         +-------------------------------+         +------------+
|  Frontend |--REST-->|  Backend (remote server)       |--WS--->|  Exchange   |
|  (your PC)|<--SSE---|  condition engine + SignalR sub |<--WS---|  (SignalR)  |
+-----------+         +-------------------------------+         +------------+
```

1. **You create a condition** via the frontend (e.g. "if 15m candle closes above 21500 -> buy 1 MNQ at market")
2. The condition is sent to the **remote backend** via REST and saved to `data/conditions.json`
3. The **condition engine** subscribes to live bar updates via the exchange's real-time feed (SignalR for TopstepX)
4. When a bar closes on the subscribed timeframe, the engine evaluates all armed conditions for that contract+timeframe
5. If the bar's close price meets the condition, it **places the order** via the exchange adapter
6. The frontend receives a **live SSE event** (triggered/failed) and shows a toast

## Architecture

- The condition engine lives inside the **existing Express backend** -- no separate server process
- It uses the same **adapter pattern** (`getAdapter().orders.place()`) so it works with any future exchange
- The frontend talks to the remote server via a configurable URL in Settings ("Conditional Orders Server")
- When the remote server is a different machine than your PC, your normal trading still goes through your local backend
- Same port (3001), same backend -- just deployed to a different machine

## Deployment

### Build and push (from your dev PC)

```bash
# Build the image
docker build -t yourdockerhubuser/trading-conditions:latest .

# Push to Docker Hub
docker login
docker push yourdockerhubuser/trading-conditions:latest
```

### Run (on any machine -- second PC, Synology, VPS)

```bash
# 1. Copy .env.example -> .env and fill in credentials
cp .env.example .env

# 2. Pull and run
docker compose up -d
```

The `.env` file provides auto-connect credentials so the container authenticates on startup without needing the frontend open.

The `docker-compose.yml` references the Docker Hub image, so the target machine only needs Docker -- no Node.js, no source code.

### Testing

1. Build and push from your dev PC
2. On second PC: `docker compose up -d` (pulls image from Docker Hub)
3. In frontend Settings, set "Conditional Orders Server" to `http://<other-pc-ip>:3001`
4. Once confirmed working, repeat on Synology/VPS

## Condition types

Currently supported:
- **Closes Above** -- triggers when candle close > trigger price
- **Closes Below** -- triggers when candle close < trigger price

Future candidates: crosses MA, volume spike, multi-condition chains.

## Chart-first interaction

The primary way to create and manage conditions is directly on the chart, not through a form. The form (modal) is kept as an alternative for precise entry.

### Creating a condition from the chart

1. User clicks a **"+ Condition"** button (toolbar or right-click context menu) → enters condition-placement mode
2. **Trigger line** appears as a dashed horizontal line (labeled "Close Above" or "Close Below") that follows the crosshair vertically
3. User clicks to anchor the trigger price → the trigger line locks in place
4. **Order line** appears (solid, labeled "Limit" or "Market") — for limit orders, this follows the crosshair; for market orders, this step is skipped
5. User clicks to anchor the order price (limit) or the system auto-sets market
6. A **compact inline popover** appears near the lines to confirm: side (buy/sell), size, timeframe, expiry, and bracket toggle (see below)
7. User clicks "Arm" → condition is sent to the backend

Both the trigger line and order line are **draggable** after placement (same drag system as existing order lines via `PriceLevelLine`). Dragging updates the condition on the backend via REST.

### Condition line rendering

Each armed condition renders **two lines** on the chart (reusing `PriceLevelLine`):
- **Trigger line** — dashed, color-coded (e.g. cyan/orange), label shows condition type + timeframe (e.g. "Close Above 15m")
- **Order line** — solid, same color family but dimmer, label shows order details (e.g. "Buy 1 MKT" or "Buy 1 LMT 21500")

Lines are only visible when the chart's contract matches the condition's contract.

### Editing from the chart

- **Drag** either line to adjust trigger price or order price → PATCH to backend
- **Click** the trigger line label → opens the inline popover for full editing (side, size, timeframe, bracket, expiry)
- **Right-click** either line → context menu with Edit (opens modal), Delete, Pause/Resume

### Deleting from the chart

- Click the **✕** button on the trigger line label, or right-click → Delete
- Condition is removed from backend and lines disappear

### Traditional form (modal)

The **ConditionModal** is still available for:
- Creating conditions from the bottom-panel Conditions tab ("+ New" button)
- Editing conditions via right-click → Edit on chart lines
- Editing conditions via the edit button in the Conditions tab row

The modal provides the same fields as the inline popover but in a full form layout.

## Bracket orders

Each condition can optionally arm a **bracket order** (SL + TP) that activates after the condition-triggered order fills.

### How it works

- In the creation popover/modal, a **"Bracket" toggle** controls whether SL/TP are attached
- When enabled, SL and TP fields appear (points or price, matching the existing bracket config UX)
- On the chart, enabling bracket shows additional **preview lines** (SL in red, TP in green) that are draggable
- The bracket config is stored with the condition and sent to the backend

### Execution flow

1. Condition triggers → backend places the entry order
2. If bracket is enabled:
   - Backend monitors for fill (same SignalR feed)
   - On fill → places SL and TP orders via the adapter
   - Uses the same bracket logic as the existing `bracketEngine` (gateway-native for 0-1 TPs, client-side for 2+ TPs)
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
| `backend/src/services/conditionEngine.ts` | Real-time bar subscription + condition evaluation + order execution + bracket follow-up |
| `backend/src/routes/conditionRoutes.ts` | REST API + SSE endpoint |
| `frontend/src/services/conditionService.ts` | API client + SSE connection |
| `frontend/src/components/bottom-panel/ConditionsTab.tsx` | Conditions table in bottom panel |
| `frontend/src/components/bottom-panel/ConditionModal.tsx` | Create/edit condition form (modal) |
| `frontend/src/components/chart/hooks/useConditionLines.ts` | Condition line rendering, dragging, creation mode, inline popover |
| `Dockerfile` | Multi-stage build for the backend |
| `docker-compose.yml` | Container orchestration (references Docker Hub image) |
| `.env.example` | Auto-connect credential template |

## Files to modify

| Path | Change |
|------|--------|
| `backend/src/index.ts` | Add condition routes, auto-connect from env vars, load conditions on boot, make PORT configurable |
| `frontend/src/store/useStore.ts` | Add `conditionServerUrl`, `conditions[]`, `editingConditionId`, `conditionPlacementMode`, and related setters |
| `frontend/src/components/SettingsModal.tsx` | Add "Conditional Orders Server" URL input |
| `frontend/src/components/bottom-panel/BottomPanel.tsx` | Add "Conditions" tab (visible when server URL is set) |
| `frontend/src/components/chart/CandlestickChart.tsx` | Wire `useConditionLines` hook into chart refs |
| `frontend/src/components/chart/hooks/types.ts` | Add condition-related line roles and drag state types |
| `frontend/src/App.tsx` | Mount `<ConditionModal />` |

## Key design decisions

- **Chart-first UX**: Creating and adjusting conditions happens directly on the chart via draggable `PriceLevelLine` instances — same interaction model as existing order lines. The modal form is a secondary path for precision or bulk editing.
- **Real-time bar detection**: Subscribes to live bar updates via the exchange's WebSocket feed (SignalR for TopstepX). When a completed bar arrives, conditions are evaluated immediately -- no timers, no polling, no risk of delayed data causing missed triggers.
- **Optional bracket**: Each condition can optionally carry SL/TP config. On fill, the backend places bracket orders using the same adapter pattern. This is a toggle, not mandatory.
- **Exchange-agnostic**: Only calls through the generic `ExchangeAdapter` interface. Only auto-connect env vars are exchange-specific.
- **JSON file persistence**: `data/conditions.json` with in-memory array and debounced disk writes (500ms). Simple, no database needed.
- **SSE for live updates**: Frontend opens an EventSource to the condition server. Events: `triggered`, `failed`, `expired`, `deleted`, `updated`.
- **CORS `origin: true`**: Required so the frontend on your PC can talk to the remote backend.
