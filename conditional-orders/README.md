# Conditional Orders

Place orders automatically when a candle closes above or below a price. Runs 24/7 on a remote server (Synology NAS, VPS, etc.) independent of the browser.

## How it works

```
+-----------+         +---------------------------+
|  Frontend |--REST-->|  Backend (remote server)   |
|  (your PC)|<--SSE---|  condition engine + timers  |
+-----------+         +---------------------------+
```

1. **You create a condition** via the frontend (e.g. "if 15m candle closes above 21500 -> buy 1 MNQ at market")
2. The condition is sent to the **remote backend** via REST and saved to `data/conditions.json`
3. The **condition engine** sets a timer aligned to the timeframe boundary (e.g. every 15 minutes)
4. When the timer fires, it fetches the last closed bar from the exchange API
5. If the bar's close price meets the condition, it **places the order** via the exchange adapter
6. The frontend receives a **live SSE event** (triggered/failed) and shows a toast

## Architecture

- The condition engine lives inside the **existing Express backend** -- no separate server process
- It uses the same **adapter pattern** (`getAdapter().orders.place()`) so it works with any future exchange
- The frontend talks to the remote server via a configurable URL in Settings ("Conditional Orders Server")
- When the remote server is a different machine than your PC, your normal trading still goes through your local backend
- Same port (3001), same backend -- just deployed to a different machine

## Deployment

The backend is containerized with Docker for easy deployment anywhere:

```bash
# 1. Copy .env.example -> .env and fill in credentials
cp .env.example .env

# 2. Build and run
docker compose up -d
```

The `.env` file provides auto-connect credentials so the container authenticates on startup without needing the frontend open.

### Local testing

To simulate the remote server locally, run a second backend instance on a different port:

```bash
cd backend && PORT=3002 PROJECTX_USERNAME=you@email.com PROJECTX_API_KEY=your-key npm run dev
```

Then set the "Conditional Orders Server" URL to `http://localhost:3002` in Settings.

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
| `backend/src/services/conditionEngine.ts` | Timer management + bar evaluation + order execution |
| `backend/src/routes/conditionRoutes.ts` | REST API + SSE endpoint |
| `frontend/src/services/conditionService.ts` | API client + SSE connection |
| `frontend/src/components/bottom-panel/ConditionsTab.tsx` | Conditions table in bottom panel |
| `frontend/src/components/bottom-panel/ConditionModal.tsx` | Create/edit condition form |
| `Dockerfile` | Multi-stage build for the backend |
| `docker-compose.yml` | Container orchestration |
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

- **Timer-based bar detection**: Aligns to timeframe boundaries from epoch + 2s delay, then fetches the official closed bar via REST. No WebSocket needed.
- **Exchange-agnostic**: Only calls through the generic `ExchangeAdapter` interface. Only auto-connect env vars are exchange-specific.
- **JSON file persistence**: `data/conditions.json` with in-memory array and debounced disk writes (500ms). Simple, no database needed.
- **SSE for live updates**: Frontend opens an EventSource to the condition server. Events: `triggered`, `failed`, `expired`, `deleted`, `updated`.
- **CORS `origin: true`**: Required so the frontend on your PC can talk to the remote backend.
