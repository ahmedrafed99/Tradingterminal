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

## Files to create

| Path | Purpose |
|------|---------|
| `backend/src/types/condition.ts` | Zod schemas + TypeScript types |
| `backend/src/services/conditionStore.ts` | JSON file persistence |
| `backend/src/services/conditionEngine.ts` | Real-time bar subscription + condition evaluation + order execution |
| `backend/src/routes/conditionRoutes.ts` | REST API + SSE endpoint |
| `frontend/src/services/conditionService.ts` | API client + SSE connection |
| `frontend/src/components/bottom-panel/ConditionsTab.tsx` | Conditions table in bottom panel |
| `frontend/src/components/bottom-panel/ConditionModal.tsx` | Create/edit condition form |
| `Dockerfile` | Multi-stage build for the backend |
| `docker-compose.yml` | Container orchestration (references Docker Hub image) |
| `.env.example` | Auto-connect credential template |

## Files to modify

| Path | Change |
|------|--------|
| `backend/src/index.ts` | Add condition routes, auto-connect from env vars, load conditions on boot, make PORT configurable |
| `frontend/src/store/useStore.ts` | Add `conditionServerUrl`, `conditions[]`, `editingConditionId`, and related setters |
| `frontend/src/components/SettingsModal.tsx` | Add "Conditional Orders Server" URL input |
| `frontend/src/components/bottom-panel/BottomPanel.tsx` | Add "Conditions" tab (visible when server URL is set) |
| `frontend/src/App.tsx` | Mount `<ConditionModal />` |

## Key design decisions

- **Real-time bar detection**: Subscribes to live bar updates via the exchange's WebSocket feed (SignalR for TopstepX). When a completed bar arrives, conditions are evaluated immediately -- no timers, no polling, no risk of delayed data causing missed triggers.
- **Exchange-agnostic**: Only calls through the generic `ExchangeAdapter` interface. Only auto-connect env vars are exchange-specific.
- **JSON file persistence**: `data/conditions.json` with in-memory array and debounced disk writes (500ms). Simple, no database needed.
- **SSE for live updates**: Frontend opens an EventSource to the condition server. Events: `triggered`, `failed`, `expired`, `deleted`, `updated`.
- **CORS `origin: true`**: Required so the frontend on your PC can talk to the remote backend.
