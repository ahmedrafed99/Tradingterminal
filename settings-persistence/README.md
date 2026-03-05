# Feature: Settings Persistence (File-Based)

User settings, presets, drawings, and layout preferences are persisted to a JSON file on disk via the Express backend. This provides a resilient backup layer that survives browser cache clears, localStorage wipes, and origin/port changes (e.g. opening the app from an Edge `--app` shortcut on a different URL).

---

## Problem

The app originally relied solely on Zustand's `persist` middleware writing to `localStorage` (key: `chart-store`). This broke in several scenarios:

- **Browser cache clear** — all settings, presets, and drawings lost
- **Different origin/port** — Edge `--app=http://localhost:5173` uses isolated storage from regular `http://localhost:5173` tabs
- **Different browser or profile** — separate `localStorage` per browser
- **Selected instruments** (`contract`, `secondContract`) were never persisted at all — they reset to `null` on every page reload

---

## Solution

A dual-layer persistence strategy:

1. **Primary (new)**: JSON file on disk at `backend/data/user-settings.json`, read/written via two Express endpoints
2. **Fallback (existing)**: Zustand `persist` → `localStorage` continues to work for fast hydration

On startup, the file-based settings take priority over localStorage. On every store change, settings are debounce-saved (500ms) to both layers simultaneously.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Browser (React App)                     │
│                                                           │
│  Zustand Store ──persist──► localStorage (fast, fragile)  │
│       │                                                   │
│       └──subscribe──► useSettingsSync hook                │
│                          │           │                    │
│                     on mount     on change                │
│                     (load)     (debounced save)           │
└──────────────────────┼───────────────┼────────────────────┘
                       │               │
                  GET /settings   PUT /settings
                       │               │
┌──────────────────────▼───────────────▼────────────────────┐
│              Express Backend (port 3001)                    │
│                                                            │
│  settingsRoutes.ts                                         │
│    GET  /settings  → read  backend/data/user-settings.json │
│    PUT  /settings  → write backend/data/user-settings.json │
└────────────────────────────────────────────────────────────┘
```

---

## What Gets Persisted

| Category | Store Fields |
|----------|-------------|
| Bracket presets | `bracketPresets`, `activePresetId` |
| Drawings | `drawings`, `hlineTemplates`, `drawingToolbarOpen` |
| Last selected instruments | `contract`, `secondContract` |
| Chart layout | `dualChart`, `secondTimeframe`, `splitRatio` |
| Bookmarked timeframes | `pinnedTimeframes`, `timeframe` |
| Pinned instruments | `pinnedInstruments` |
| Connection | `baseUrl`, `activeAccountId` |
| Order panel | `orderSize` |
| Volume profile | `vpEnabled`, `vpColor`, `secondVpEnabled`, `secondVpColor` |
| Bottom panel | `bottomPanelOpen`, `bottomPanelRatio`, `bottomPanelTab` |

**Not persisted** (ephemeral/live): `connected`, `accounts`, `openOrders`, `positions`, `lastPrice`, `toasts`, `drawingUndoStack`, draft/ad-hoc bracket overrides, `settingsOpen`, `editingPresetId`, `activeTool`, `selectedDrawingId`, `selectedChart`, `vpTradeMode`, `sessionTrades`, `visibleTradeIds`, `qoPendingPreview`

---

## Files

### Backend

| File | Purpose |
|------|---------|
| `backend/src/routes/settingsRoutes.ts` | GET/PUT endpoints, reads/writes JSON file |
| `backend/src/index.ts` | Mounts `/settings` route |
| `backend/data/user-settings.json` | Data file (gitignored, created automatically) |

### Frontend

| File | Purpose |
|------|---------|
| `frontend/src/services/persistenceService.ts` | API wrapper (`loadSettings`, `saveSettings`) |
| `frontend/src/hooks/useSettingsSync.ts` | Hydration on mount + debounced save on change |
| `frontend/src/store/useStore.ts` | `contract` and `secondContract` added to `partialize` |
| `frontend/src/App.tsx` | Calls `useSettingsSync()` |
| `frontend/vite.config.ts` | `/settings` added to proxy table |

---

## Backend Endpoints

### `GET /settings`

Returns persisted settings from disk.

```
Response: { success: true, data: { ...settings } }
```

If the file doesn't exist yet, returns `{ success: true, data: {} }`.

### `PUT /settings`

Writes the request body as the new settings file.

```
Request body: { bracketPresets: [...], drawings: [...], ... }
Response: { success: true }
```

The `backend/data/` directory is created automatically if it doesn't exist.

No auth guard — the backend is local-only (CORS locked to `localhost:5173`).

---

## Sync Lifecycle

### Startup (hydration)

1. Zustand `persist` hydrates store from `localStorage` (synchronous, instant)
2. `useSettingsSync` hook fires `GET /settings` (async)
3. If file has data → shallow-compares each key by value (`JSON.stringify`) and only patches keys that actually changed (avoids re-triggering effects with identical data)
4. If file is empty (first run) → seeds the file with current store state (backs up localStorage data)
5. Sets `settingsHydrated: true` in store — chart bars loading is gated on this flag to prevent wasted requests on stale localStorage contract data

### Runtime (ongoing saves)

1. `useStore.subscribe()` fires on every store mutation
2. Hook debounces 500ms, then calls `PUT /settings` with the full persisted subset
3. Zustand `persist` middleware also writes to `localStorage` (its own mechanism)

### Failure modes

| Scenario | Behavior |
|----------|----------|
| Backend not running on startup | Hook catches error silently, falls back to localStorage |
| Backend not running during save | Save fails silently, localStorage still works |
| localStorage cleared | Next reload fetches from file, full restore |
| File deleted | Next reload uses localStorage, file re-seeded on first state change |
| Both cleared | Store initializes with defaults (same as fresh install) |

---

## Data File

**Location**: `backend/data/user-settings.json`

- Created automatically on first `PUT /settings`
- Gitignored (see `.gitignore` → `backend/data/`)
- Pretty-printed JSON (2-space indent) for easy inspection
- Contains the exact same fields as the `partialize` function output

Example:
```json
{
  "baseUrl": "https://api.topstepx.com",
  "bracketPresets": [
    { "id": "abc123", "name": "2pt SL / 4pt TP", "config": { ... } }
  ],
  "drawings": [ ... ],
  "contract": { "id": "CON.F.US.NQ.H26", "name": "NQH6", ... },
  "pinnedTimeframes": [
    { "unit": 2, "unitNumber": 1, "label": "1m" },
    { "unit": 2, "unitNumber": 15, "label": "15m" }
  ],
  "dualChart": false,
  "splitRatio": 0.5
}
```
