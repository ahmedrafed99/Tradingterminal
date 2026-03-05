# Frontend — Chart Trading App

React 18 + TypeScript + Vite frontend for the TopstepX/ProjectX trading app.
Runs on **http://localhost:5173** and proxies all API calls to the Express backend on port 3001.

---

## Stack

| Tool | Version | Role |
|------|---------|------|
| React | 18 | UI framework |
| TypeScript | 5 | Type safety |
| Vite | 6 | Dev server + bundler |
| Tailwind CSS | v4 (`@tailwindcss/vite`) | Utility styling |
| Zustand | latest | Global state (with `persist`) |
| Axios | latest | HTTP client |
| `@microsoft/signalr` | latest | SignalR WebSocket client (isolated in ProjectX adapter) |
| Lightweight Charts | v5 | Candlestick chart rendering |
| Vitest | latest | Unit testing (`npm test`) |

---

## Directory Structure

```
frontend/
├── index.html
├── vite.config.ts              ← proxy config + Tailwind plugin
├── src/
│   ├── main.tsx
│   ├── App.tsx                 ← root shell, auth check, auto-load NQ, split layout with draggable separator
│   ├── index.css               ← Tailwind import + dark base styles + TradingView watermark hide
│   ├── types/
│   │   ├── bracket.ts          ← BracketConfig, BracketPreset, Condition types, buildNativeBracketParams
│   │   └── drawing.ts          ← Drawing (HLine|Oval|ArrowPath), DrawingTool, DrawingText, HLineTemplate types + constants
│   ├── utils/
│   │   ├── instrument.ts       ← calcPnl, pointsToPrice, priceToPoints, pointsToTicks, getTicksPerPoint
│   │   ├── cmeSession.ts       ← getCmeSessionStart() — CME session boundary (6 pm NY)
│   │   ├── toast.ts            ← showToast() + errorMessage() — toast helpers for non-React code
│   │   └── retry.ts            ← retryAsync() — exponential backoff with jitter
│   ├── adapters/
│   │   ├── types.ts            ← RealtimeAdapter interface + canonical data types (Quote, DepthEntry, etc.)
│   │   ├── registry.ts         ← getRealtimeAdapter / setRealtimeAdapter / clearRealtimeAdapter
│   │   └── projectx/
│   │       ├── index.ts        ← createProjectXRealtimeAdapter() factory
│   │       └── realtimeAdapter.ts ← ProjectXRealtimeAdapter (SignalR dual-hub implementation)
│   ├── services/
│   │   ├── api.ts              ← axios instance + error interceptor
│   │   ├── authService.ts      ← connect / disconnect / status
│   │   ├── accountService.ts   ← searchAccounts (filtered)
│   │   ├── marketDataService.ts← retrieveBars, searchContracts, listAvailable
│   │   ├── orderService.ts     ← place / cancel / modify / searchOpen
│   │   ├── tradeService.ts     ← searchTrades (session fills)
│   │   ├── realtimeService.ts  ← thin facade delegating to active RealtimeAdapter (re-exports types)
│   │   ├── persistenceService.ts ← file-based settings load/save (GET/PUT /settings)
│   │   └── bracketEngine.ts    ← client-side bracket order management (SL + multi-TP + conditions + retry + toasts)
│   ├── hooks/
│   │   └── useSettingsSync.ts  ← file-based persistence: hydrate on mount + debounced save on change
│   ├── store/
│   │   └── useStore.ts         ← Zustand combined store (11 slices, includes toast)
│   └── components/
│       ├── Toast.tsx            ← ToastContainer + ToastEntry — slide-in notifications (bottom-right)
│       ├── TopBar.tsx           ← header: account selector, balance, privacy toggle, status, settings
│       ├── SettingsModal.tsx    ← connect/disconnect modal
│       ├── InstrumentSelector.tsx ← contract search dropdown in toolbar
│       ├── chart/
│       │   ├── index.ts         ← barrel export
│       │   ├── CandlestickChart.tsx ← 342-line orchestrator (refs, chart init, hook calls, JSX)
│       │   ├── ChartArea.tsx    ← dual chart layout, crosshair sync, draggable separator
│       │   ├── ChartToolbar.tsx ← timeframe selector (pinned + dropdown + custom)
│       │   ├── chartTheme.ts    ← chart/candlestick style constants + NY timezone formatters
│       │   ├── barUtils.ts      ← bar conversion, sorting, period math
│       │   ├── DrawingToolbar.tsx   ← collapsible left-edge sidebar (select, hline, oval, arrow path)
│       │   ├── DrawingEditToolbar.tsx ← floating edit popup (color, text, stroke, template, delete)
│       │   ├── PriceLevelLine.ts       ← unified imperative class: horizontal line + label pill + axis label (HTML)
│       │   ├── CrosshairLabelPrimitive.ts ← HTML crosshair price label (z-index:30, above PriceLevelLine)
│       │   ├── TradeZonePrimitive.ts  ← ISeriesPrimitive for entry/exit trade zone visualization
│       │   ├── hooks/
│       │   │   ├── types.ts              ← ChartRefs interface, shared types (HitTarget, PreviewLineRole, etc.)
│       │   │   ├── resolvePreviewConfig.ts ← unifies preset+draft and ad-hoc state into BracketConfig
│       │   │   ├── useChartWidgets.ts    ← trade zones, OHLC tooltip, crosshair label, scroll button
│       │   │   ├── useChartBars.ts       ← bar fetching, real-time quotes, volume profile
│       │   │   ├── useChartDrawings.ts   ← drawing creation, drag, resize, undo, keyboard shortcuts
│       │   │   ├── useQuickOrder.ts      ← + button on price scale, bracket preview, order placement
│       │   │   ├── useOrderLines.ts      ← preview/order/position price lines, all drag interactions
│       │   │   └── useOverlayLabels.ts   ← HTML labels (P&L, cancel, +SL/+TP), hit targets, sync
│       │   └── drawings/
│       │       ├── DrawingsPrimitive.ts ← ISeriesPrimitive orchestrator for all drawings
│       │       ├── HLineRenderer.ts    ← horizontal line renderer + hit test
│       │       ├── OvalRenderer.ts     ← oval renderer + 4-handle resize + hit test
│       │       ├── ArrowPathRenderer.ts ← arrow path (multi-segment polyline + arrowhead) renderer + hit test
│       │       └── hitTesting.ts       ← geometry hit-test utilities
│       ├── bottom-panel/
│       │   ├── BottomPanel.tsx    ← tabbed panel (Orders/Trades) with tab bar
│       │   ├── OrdersTab.tsx      ← open orders table with cancel buttons
│       │   └── TradesTab.tsx      ← session trades table with trade zone toggle
│       └── order-panel/
│           ├── index.ts         ← barrel export
│           ├── OrderPanel.tsx   ← main panel: SignalR event wiring, preset suspend/restore
│           ├── OrderTypeTabs.tsx← Market/Limit toggle + limit price input
│           ├── ContractsSpinner.tsx ← order size +/- input
│           ├── BracketSummary.tsx   ← preset dropdown selector + config summary (SL/TP/conditions)
│           ├── BracketSettingsModal.tsx ← preset editor: name, SL, multi-TP, conditions
│           ├── BuySellButtons.tsx    ← BUY/SELL side-by-side, bracket arming logic
│           └── PositionDisplay.tsx   ← live position, unrealized P&L, SL-to-BE, close position
```

---

## Dev Server

```bash
cd frontend
npm run dev        # starts Vite on port 5173
```

The backend **must be running** on port 3001 first:

```bash
cd backend
npm run dev
```

---

## Vite Proxy

`vite.config.ts` forwards these paths to the backend so the frontend uses relative URLs:

| Prefix | Target |
|--------|--------|
| `/auth` | `http://localhost:3001` |
| `/accounts` | `http://localhost:3001` |
| `/market` | `http://localhost:3001` |
| `/orders` | `http://localhost:3001` |
| `/trades` | `http://localhost:3001` |
| `/health` | `http://localhost:3001` |
| `/hubs` | `http://localhost:3001` (WebSocket) |

---

## Tailwind Note

Tailwind v4 uses the `@tailwindcss/vite` plugin (no `tailwind.config.js` needed).
**Known quirk**: newly added utility classes (especially spacing like `px-*`, `py-*`) may
not regenerate during hot-reload. Use inline `style={{ padding: '...' }}` for any spacing
that doesn't visually apply — this is reliable and already the pattern used across components.

---

## Service Layer (`src/services/`)

### `api.ts`
Axios instance with `baseURL: ''` (relative, forwarded by Vite proxy) and `timeout: 30_000` (30s cap on all requests).

Response interceptor: if `res.data.success === false`, throws `new Error(res.data.errorMessage)`.
This means callers never need to check `success` manually — any failure throws.

### `authService.ts`

```ts
authService.connect(userName, apiKey, baseUrl?)  // POST /auth/connect
authService.disconnect()                          // POST /auth/disconnect
authService.getStatus()                           // GET  /auth/status → { connected, baseUrl }
```

### `accountService.ts`

```ts
accountService.searchAccounts()  // GET /accounts → Account[]
```

Filters response: only returns accounts where `isVisible === true && canTrade === true`.

### `marketDataService.ts`

```ts
marketDataService.retrieveBars(params)           // POST /market/bars → Bar[]
marketDataService.searchContracts(query, live?)  // GET  /market/contracts/search?q=...
marketDataService.listAvailableContracts()       // GET  /market/contracts/available
```

Bar unit values: `1`=Second, `2`=Minute, `3`=Hour, `4`=Day, `5`=Week, `6`=Month.
Max bars per request: 20,000. Use `live: false` for sim/TopstepX accounts.
In-flight request dedup: concurrent calls with the same `(contractId, unit, unitNumber)` key share a single network request (prevents duplicate fetches from React StrictMode or rapid re-renders).
Cache hierarchy: in-memory Map → sessionStorage (survives page refresh, 60s TTL) → in-flight dedup → network fetch. Chart renders instantly on refresh from sessionStorage.

### `orderService.ts`

```ts
orderService.placeOrder(params)                       // POST  /orders/place
orderService.cancelOrder(accountId, orderId)          // POST  /orders/cancel
orderService.modifyOrder(params)                      // PATCH /orders/modify
orderService.searchOpenOrders(accountId)              // GET   /orders/open?accountId=...
```

All methods wrapped with `retryAsync()` (3 attempts, exponential backoff with jitter) for transient network failures.

Order type enum: `1`=Limit, `2`=Market, `4`=Stop, `5`=TrailingStop.
Order side enum: `0`=Buy, `1`=Sell.

### `tradeService.ts`

```ts
tradeService.searchTrades(accountId, startTimestamp)  // GET /trades/search → Trade[]
```

```ts
interface Trade {
  id: number;
  accountId: number;
  contractId: string;
  price: number;
  profitAndLoss: number | null;  // null = opening half-turn, non-null = closing half-turn
  fees: number;
  side: number;                  // 0 = buy, non-0 = sell
  size: number;
  voided: boolean;
  orderId: number;
  creationTimestamp: string;     // ISO 8601
}
```

### `realtimeService.ts` (facade)

Thin delegating facade — proxies all calls to the active `RealtimeAdapter` from the adapter registry. Initializes with `ProjectXRealtimeAdapter` by default. Re-exports all canonical types (`Quote`, `DepthEntry`, `RealtimeOrder`, `RealtimePosition`, `RealtimeAccount`, `RealtimeTrade`) and a `GatewayQuote` backward-compat alias.

```ts
realtimeService.connect()                         // delegates to adapter.connect()
realtimeService.subscribeQuotes(contractId)
realtimeService.unsubscribeQuotes(contractId)
realtimeService.subscribeDepth(contractId)
realtimeService.unsubscribeDepth(contractId)
realtimeService.subscribeUserEvents(accountId)

realtimeService.onQuote(handler)     // (contractId, Quote) => void
realtimeService.onDepth(handler)     // (contractId, DepthEntry[]) => void
realtimeService.onOrder(handler)
realtimeService.onPosition(handler)
realtimeService.onAccount(handler)
realtimeService.onTrade(handler)

realtimeService.offQuote(handler)    // remove specific handler
realtimeService.offDepth(handler)
realtimeService.offOrder(handler)
realtimeService.offPosition(handler)
realtimeService.offAccount(handler)
realtimeService.offTrade(handler)

realtimeService.ping()               // WebSocket round-trip latency in ms
realtimeService.disconnect()
```

### Realtime Adapter (`adapters/`)

The `RealtimeAdapter` interface (`adapters/types.ts`) defines the contract for realtime data providers. The adapter registry (`adapters/registry.ts`) holds the active adapter singleton.

**ProjectX adapter** (`adapters/projectx/realtimeAdapter.ts`): manages two SignalR hubs proxied through the backend (JWT injected server-side). Uses `skipNegotiation: true` + `transport: WebSockets`. Auto-reconnects and resubscribes on reconnect. SignalR-specific helpers (`UserHubItem<T>`, `normalizeUserHubArgs`) are file-private.

| Hub | Frontend URL | Proxied To | Events |
|-----|-------------|------------|--------|
| Market | `/hubs/market` | `wss://rtc.topstepx.com/hubs/market` | `GatewayQuote(contractId, data)`, `GatewayDepth(contractId, entries[])` |
| User | `/hubs/user` | `wss://rtc.topstepx.com/hubs/user` | `GatewayUserOrder`, `GatewayUserPosition`, `GatewayUserAccount`, `GatewayUserTrade` |

### `persistenceService.ts`

File-based settings persistence — backs up store state to the Express backend's local filesystem.

```ts
persistenceService.loadSettings()   // GET  /settings → { bracketPresets, drawings, contract, ... }
persistenceService.saveSettings(data) // PUT  /settings — writes full persisted state to disk
```

Used by the `useSettingsSync` hook (see below). Survives browser cache clears, origin changes, and port differences. See `settings-persistence/README.md` for the full sync lifecycle.

### `bracketEngine.ts`

Client-side singleton that manages SL + multi-TP bracket orders after entry fill. Uses `retryAsync` for SL/TP placement and `showToast` for error notifications. `clearSession()` returns `Set<number>` of order IDs being cancelled. See [bracket-engine/](../bracket-engine/) for full documentation.

---

## Zustand Store (`src/store/useStore.ts`)

Combined store with `persist` middleware (key: `chart-store`). Dual-layer persistence: Zustand writes to `localStorage` (fast), `useSettingsSync` hook writes to `backend/data/user-settings.json` (resilient). On startup, file-based settings take priority. See `settings-persistence/README.md`.

**Persisted fields** (to localStorage + backend JSON file): `baseUrl`, `activeAccountId`, `timeframe`, `pinnedTimeframes`, `pinnedInstruments`, `orderSize`, `bracketPresets`, `activePresetId`, `drawings`, `drawingToolbarOpen`, `hlineTemplates`, `dualChart`, `secondTimeframe`, `splitRatio`, `bottomPanelOpen`, `bottomPanelRatio`, `bottomPanelTab`, `vpEnabled`, `vpColor`, `secondVpEnabled`, `secondVpColor`, `contract`, `secondContract`
**Not persisted** (live state): `connected`, `accounts`, `openOrders`, `positions`, `lastPrice`, `suspendedPresetId`, `settingsOpen`, `editingPresetId`, `draftSlPoints`, `draftTpPoints`, `adHocSlPoints`, `adHocTpLevels`, `activeTool`, `selectedDrawingId`, `selectedChart`, `vpTradeMode`, `sessionTrades`, `visibleTradeIds`, `toasts`

### Slices

| Slice | Fields | Actions |
|-------|--------|---------|
| Auth | `connected`, `baseUrl` | `setConnected(connected, baseUrl?)` |
| Accounts | `accounts[]`, `activeAccountId` | `setAccounts`, `setActiveAccountId` |
| Instrument | `contract`, `timeframe`, `pinnedTimeframes`, `pinnedInstruments` | `setContract`, `setTimeframe`, `pinTimeframe`, `unpinTimeframe`, `pinInstrument`, `unpinInstrument` |
| Orders | `openOrders[]` | `setOpenOrders`, `upsertOrder`, `removeOrder` |
| Positions | `positions[]` | `upsertPosition`, `clearPositions` |
| OrderPanel | `orderType`, `limitPrice`, `orderSize`, `previewEnabled`, `bracketPresets[]`, `activePresetId`, `suspendedPresetId`, `lastPrice`, `draftSlPoints`, `draftTpPoints[]`, `adHocSlPoints`, `adHocTpLevels[]` | `setOrderType`, `setLimitPrice`, `setOrderSize`, `togglePreview`, `setActivePresetId`, `suspendPreset`, `restorePreset`, `savePreset`, `deletePreset`, `setLastPrice`, `setDraftSlPoints`, `setDraftTpPoints`, `clearDraftOverrides`, `setAdHocSlPoints`, `addAdHocTp`, `removeAdHocTp`, `updateAdHocTpPoints`, `clearAdHocBrackets` |
| UI | `settingsOpen`, `editingPresetId` | `setSettingsOpen`, `setEditingPresetId` |
| Drawings | `activeTool`, `drawingToolbarOpen`, `selectedDrawingId`, `drawings[]` | `setActiveTool`, `setDrawingToolbarOpen`, `setSelectedDrawingId`, `addDrawing`, `updateDrawing`, `removeDrawing` |
| HLineTemplates | `hlineTemplates[]` | `addHLineTemplate`, `removeHLineTemplate` |
| BottomPanel | `bottomPanelOpen`, `bottomPanelRatio`, `bottomPanelTab`, `sessionTrades[]`, `visibleTradeIds[]` | `setBottomPanelOpen`, `setBottomPanelRatio`, `setBottomPanelTab`, `setSessionTrades`, `toggleTradeVisibility`, `clearVisibleTradeIds` |
| DualChart | `dualChart`, `secondContract`, `secondTimeframe`, `selectedChart`, `splitRatio` | `setDualChart`, `setSecondContract`, `setSecondTimeframe`, `setSelectedChart`, `setSplitRatio` |
| VolumeProfile | `vpEnabled`, `vpColor`, `secondVpEnabled`, `secondVpColor`, `vpTradeMode` | `setVpEnabled`, `setVpColor`, `setSecondVpEnabled`, `setSecondVpColor`, `setVpTradeMode` |
| Toast | `toasts[]` | `addToast`, `dismissToast`, `clearToasts` |

### Preset Suspend/Restore

When a position opens, the active preset is **suspended** (moved to `suspendedPresetId`, active set to null) so the next order is naked. Ad-hoc bracket state is also cleared and preview is turned off (real SL/TP orders now exist on the chart). When the position closes, the preset is **restored** automatically. Manual preset selection clears any suspended state.

### Timeframes

```ts
// Pinned in toolbar by default
export const DEFAULT_PINNED: Timeframe[] = [
  { unit: 2, unitNumber: 1,  label: '1m'  },
  { unit: 2, unitNumber: 15, label: '15m' },
];

// Available in dropdown menu
export const MORE_TIMEFRAMES: Timeframe[] = [
  { unit: 2, unitNumber: 3,  label: '3m'  },
  { unit: 3, unitNumber: 1,  label: '1h'  },
  { unit: 3, unitNumber: 4,  label: '4h'  },
  { unit: 4, unitNumber: 1,  label: 'D'   },
];
```

Users can pin/unpin timeframes — pinned ones appear as toolbar buttons, unpinned ones stay in the dropdown. Pin state persists across reloads.

---

## Types (`src/types/bracket.ts`)

```ts
StopLossConfig     { points: number; type: 'Stop' | 'TrailingStop' }
TakeProfitLevel    { id: string; points: number; size: number }   // size = whole contracts
Condition          { id: string; trigger: ConditionTrigger; action: ConditionAction }
BracketConfig      { stopLoss: StopLossConfig; takeProfits: TakeProfitLevel[]; conditions: Condition[] }
BracketPreset      { id: string; name: string; config: BracketConfig }
```

Constants: `MAX_TP_LEVELS = 8`

User-facing unit is **points** (1 point = `ticksPerPoint` ticks, e.g. 4 for MNQ). All UI inputs/displays use points. Conversion helpers in `utils/instrument.ts`: `pointsToPrice(points, contract)`, `priceToPoints(priceOffset, contract)`, `pointsToTicks(points, contract)`, `calcPnl(priceDiff, contract, size)`.

---

## Components

### `App.tsx`

Root shell. On mount:
1. `useSettingsSync()` — loads settings from backend file, sets up debounced save on store changes
2. Calls `authService.getStatus()` to restore connection state after page refresh
3. Auto-loads the NQ contract (searches for "NQ", selects first active contract) — skipped if `contract` was restored from persistence

Layout: `OrderPanel` (left sidebar, 240px) + main content area (chart + bottom panel).

**Split layout**: The main content area is vertically split between the chart and the bottom panel via a draggable `VerticalSeparator`. The split ratio (`bottomPanelRatio`, 0–0.6) is persisted in the store. Default ratio is `0` (tab bar visible, no content), the user drags the separator up to reveal the bottom panel. The bottom panel always renders with `minHeight: 40` so the tab bar is always accessible. No collapse animation — direct flex-based sizing for instant response.

### `TopBar.tsx`

Persistent header (40px tall). Three zones:

- **Left**: account `<select>` dropdown + eye icon (privacy toggle)
- **Centre**: balance display (`Balance : $50,000.00`)
- **Right**: connection status pill (green/red dot + label), settings gear icon

Privacy toggle: default on — account name masked to first 7 chars + `***`. Click to reveal.

### `SettingsModal.tsx`

Full-screen modal overlay (z-50). Fields: Username, API Key, Gateway URL.
Connect flow → disconnect flow with store sync.

### `InstrumentSelector.tsx`

Inline search input with favorites/bookmarks system. Debounced (300ms) contract search. Click result to set active contract.

- **Favorites**: When not searching, dropdown shows bookmarked instruments (resolved to active contracts via API). Default bookmarks: `['NQ', 'MNQ']`. Each result row has a star icon to toggle bookmark status.
- **Star toggle**: Extracts base symbol by stripping trailing month+year code (e.g. `NQM6` → `NQ`). Pinned symbols stored in `pinnedInstruments` (persisted to localStorage).
- **Dropdown alignment**: Dynamically positioned — toolbar variant aligns left edge with toolbar, order panel variant aligns with parent wrapper bounds.
- **Smooth animation**: Dropdown uses `animate-dropdown-in` keyframe.
- Used in both chart toolbar (selection-aware, switches on `selectedChart`) and order panel (`fixed` prop, independent `orderContract`).

### `Toast.tsx`

Toast notification system. `<ToastContainer />` is mounted in `App.tsx` (renders regardless of connection state).

- Fixed bottom-right (`z-[100]`), 320px wide, stacks up to 10 toasts
- Left accent strip colored by kind: error `#ef5350`, warning `#f0a830`, success `#26a69a`, info `#2962ff`
- Background `#1e222d`, border `#2a2e39`, shadow `0 4px 24px rgba(0,0,0,0.5)`
- Auto-dismiss via `useEffect` timers; `duration: null` = manual dismiss only (used for critical SL failures)
- Enter/exit animations via CSS classes `animate-toast-in` / `animate-toast-out` (defined in `index.css`)
- Triggered from anywhere via `showToast()` from `utils/toast.ts` (works from non-React code)

### `chart/CandlestickChart.tsx` (Orchestrator — 346 lines)

Full-height candlestick chart using Lightweight Charts v5. Wrapped in `React.memo` + `forwardRef`. Declares 28 refs bundled into a typed `ChartRefs` bag, runs the chart init effect (createChart, series, primitives, HTML crosshair label), then delegates all behavior to 6 hooks. Exposes `getChartApi()`, `getSeriesApi()`, `getDataMap()`, `isQoHovered()`, `setCrosshairPrice()` via `useImperativeHandle`.

Hook call order (preserves original effect ordering):
1. `useChartWidgets(refs, contract, timeframe)` → `{ showScrollBtn, scrollBtnPos }`
2. `useChartBars(refs, chartId, contract, timeframe)` → `{ loading, error }`
3. `useChartDrawings(refs, contract)`
4. `useQuickOrder(refs, contract, timeframe, isOrderChart)`
5. `useOrderLines(refs, contract, isOrderChart)`
6. `useOverlayLabels(refs, contract, isOrderChart)`

### `chart/PriceLevelLine.ts` (347 lines)

Unified imperative class that renders a horizontal price line, optional label pill, and axis label badge — all as HTML `<div>` elements in the chart overlay. Replaces the previous two-layer system (LWC `series.createPriceLine()` + separate HTML `buildRow()` labels). Only LWC dependency: `series.priceToCoordinate(price)` for Y positioning. Key API: `setPrice()`, `setLineColor()`, `setLabelLeft(fraction)`, `setLabel(sections)`, `updateSection()`, `syncPosition()`, `paintToCanvas()`, `destroy()`. Labels default to 50% horizontal position; entry/position labels use `setLabelLeft(0.65)` to avoid overlap with SL/TP labels. Axis labels use `z-index:20`.

### `chart/CrosshairLabelPrimitive.ts` (73 lines)

HTML crosshair price label in the overlay div (`z-index:30`). Positioned over the price scale, matching LWC's native crosshair label style (`#2a2e39` bg, `#d1d4dc` text, bold 12px). Updated via `updateCrosshairPrice(price)` from `subscribeCrosshairMove` (local chart) and `setCrosshairPrice()` imperative handle (dual-chart sync).

### `chart/hooks/useChartWidgets.ts` (193 lines)

Trade zone primitive sync, OHLC tooltip on crosshair hover, crosshair price label feed (calls `updateCrosshairPrice` on crosshair move), scroll-to-latest button visibility and positioning.

### `chart/hooks/useChartBars.ts` (270 lines)

- **Historical bars**: loads when `contract` or `timeframe` changes; gated on `settingsHydrated` flag so bars don't fire until file-based settings have loaded (prevents wasted requests on stale localStorage data)
- **Initial visible range**: shows last ~100 bars zoomed in (not `fitContent`), re-enables `autoScale` before each data load (so the price axis resets for the new instrument), then disables it after so vertical dragging works immediately
- **Real-time updates**: subscribes to `GatewayQuote` via SignalR, updates/creates candles
- Guards against race conditions with stale quotes
- **Volume profile**: depth subscription, color sync, hover tracking

### `chart/hooks/useChartDrawings.ts` (900 lines)

Complete drawing system: click-to-place (hline), drag-to-create (oval), multi-click creation (arrow path), click-to-select, drag-to-move, 4-handle resize (oval), per-node drag (arrow path), ruler creation. Keyboard shortcuts (Del, Ctrl+Z, Escape). Contains `onOverlayHitTest` handler registered on container mousedown.

### `chart/hooks/useQuickOrder.ts` (307 lines)

The + button on the price scale: appears on hover, creates `PriceLevelLine` instances with baked-in labels (P&L + size) for bracket preview. Places limit order on click with bracket engine arming. Full cleanup on error (disarm, clear preview, toast).

### `chart/hooks/useOrderLines.ts` (530 lines)

**Preview overlay** (when preview checkbox is ticked):
- Entry line always shown when preview is on (even with no preset)
- SL/TP lines shown when a bracket preset is active **or** ad-hoc SL/TP have been added
- Dashed `PriceLevelLine` instances for Entry (grey `#787b86`), SL (red `#ff0000`), each TP (green `#00c805`)
- `resolvePreviewConfig()` helper unifies preset+draft and ad-hoc state into a single `BracketConfig`
- Two-effect pattern: structural effect creates/destroys `PriceLevelLine` instances on config change; price-update effect calls `line.setPrice()` in-place to avoid flicker

**Live order & position lines** (always visible, regardless of preview):
- Position entry: solid grey `#cac8cb` at `averagePrice`
- Stop orders (type 4/5): solid red `#ff0000` at `stopPrice`
- Limit orders (type 1): solid green `#00c805` at `limitPrice` (all TPs are green regardless of side)
- Each line tracks its `Order` object via `orderLineMetaRef` for drag identification

**Drag interactions**: Preview line drag (entry/SL/TP), order drag-to-modify, position drag-to-create SL/TP. Drag updates use `line.setPrice()` + `line.setLineColor()` + `line.syncPosition()`.

### `chart/hooks/useOverlayLabels.ts` (700 lines)

**Overlay label system** (labels managed via `PriceLevelLine.setLabel(sections)` / `updateSection()`):
- `useOverlayLabels` does NOT create DOM elements directly — it configures label sections on existing `PriceLevelLine` instances created by `useOrderLines` and `useQuickOrder`
- **All labels use `pointer-events: none`** — mouse events pass through to the LWC canvas so the crosshair stays visible. Interactions detected via coordinate-based hit testing (`line.getLabelEl().getBoundingClientRect()`) at the container level using `hitTargetsRef` (priority: 0=buttons, 1=entry-click, 2=row-drag)
- Each label is a row of colored cells: `[P&L or label] [size] [✕]`
- **Position label**: real-time P&L (green/red), contract size, ✕ to close position (market order). Drag-to-create: mousedown on position label starts a drag — dragging in the loss direction creates a stop order (full position size), dragging in the profit direction creates a limit TP order (1 contract per drag)
- **Order labels**: TP orders show both P&L cell and size cell in green (`#00c805`); SL orders show both cells in red (`#ff0000`). When no position exists, label shows "SL"/"Buy Limit"/"Sell Limit" in grey (`#cac9cb`) with black text (size cell stays green/red). When a position exists, P&L is displayed with the order-type color (green for TP, red for SL). ✕ to cancel order
- **Preview labels**: Entry shows "Limit Buy"/"Limit Sell" in grey (`#cac9cb`) with black text (clickable to execute), size cell colored by side (green buy / red sell). SL/TP show projected P&L relative to entry price. Each TP shows its **individual** contract size from the preset or ad-hoc level (not total orderSize). SL shows total size. When no preset is active, entry label includes **+SL** and **+TP** buttons to add ad-hoc bracket lines
- P&L values update in real-time via `line.updateSection(index, text, bg, color)` — direct Zustand subscription (bypasses React render cycle)
- `updateOverlayRef` stores the position-update function, called by the sync effect

**Overlay sync** (smooth positioning for all `PriceLevelLine` instances):
- `updatePositions()` calls `line.syncPosition()` on every live line, then runs P&L updater closures
- `requestAnimationFrame` loop runs during any pointer interaction (pointerdown → rAF loop → pointerup stops)
- Also listens to `visibleLogicalRangeChange` (horizontal scroll), `ResizeObserver`, and `wheel` events
- Zero overhead when idle — rAF loop only active during pointer drag

### `chart/hooks/types.ts` (112 lines)

Shared type definitions: `ChartRefs` interface (28 refs), `PreviewLineRole`, `OrderLineMeta`, `HitTarget`, `QoPreviewLines`, `PosDragState`, `OrderDragState`. Uses `PriceLevelLine` type from `../PriceLevelLine` for line refs.

**Label-initiated drag** (click label to edit price):
- All labels are `pointer-events: none` — interaction detected by container-level `onOverlayHitTest` handler (in useChartDrawings) via coordinate hit testing
- `onOverlayHitTest` fires the registered drag handler, which sets shared drag state refs (`previewDragStateRef` or `orderDragStateRef`)
- `mousemove` / `mouseup` listeners on `window` handle the drag (works even when mouse leaves the label)
- Cursor switches to `grabbing` during drag, resets to `pointer` on release
- Close-✕ buttons registered as priority-0 hit targets fire before row drag (priority 2)
- **Crosshair stays visible during drag**: drag mousemove handlers do NOT call `stopPropagation()`, allowing LWC to see mouse events. `chartRef.applyOptions({ handleScroll: false, handleScale: false })` disables chart pan on drag start, re-enabled on mouseup.
- **Preview drag**: Entry → sets `orderType: 'limit'` + `limitPrice`; SL/TP → writes to `draftSlPoints` / `draftTpPoints` (preset mode) or `adHocSlPoints` / `updateAdHocTpPoints` (ad-hoc mode)
- **Order drag**: on mouse up calls `orderService.modifyOrder()` with new `stopPrice` or `limitPrice`
- **Position drag**: drag from position label to create SL/TP orders directly (see Position label above)
- Prices snap to tick size during drag

### `chart/TradeZonePrimitive.ts`

Canvas-rendered `ISeriesPrimitive<Time>` that visualizes trade entry/exit pairs as semi-transparent rectangles on the chart. Attached to the candlestick series with `zOrder: 'top'` so zones render above candles.

**Trade matching** (`buildEntryMap` + `matchTrades`):
- `buildEntryMap(sessionTrades)` — processes ALL session trades using FIFO matching per contract. Groups trades by `contractId`, separates opening (P&L null) from closing (P&L non-null) half-turns, sorts chronologically, then matches each closing trade to the oldest opening trade with opposite side that still has remaining size. Uses size-aware claiming: a single entry trade with size N can match multiple partial exits as long as their total size does not exceed N. Returns `Map<exitTradeId, entryTrade>`. This function is shared between the chart primitive and the Trades tab table.
- `matchTrades(sessionTrades, visibleTradeIds, contractId)` — filters `buildEntryMap` results to only trades the user has toggled visible, producing `TradeZone[]`.

**TradeZone**: `{ entryTrade: Trade; exitTrade: Trade; profitable: boolean }`

**Rendering** (per zone):
- Semi-transparent filled rectangle between entry price/time and exit price/time (`#26a69a25` green / `#ef535025` red)
- Dashed horizontal lines at entry and exit price levels (`color + '90'`)
- Dashed diagonal line from entry to exit coordinates (`color + '60'`)
- **Long/short aware placement**: Labels flip position based on trade direction (`entryTrade.side === 0` = long)
  - Long: entry label below candle low, exit label above candle high
  - Short: entry label above candle high, exit label below candle low
- Entry label: white text (`#d1d4dc`) with black outline, showing `"Entry  {size} @ {price}"` with steel-blue (`#4a80b0`) arrow pointing at candle
- Exit label: white text with black outline, showing `"Exit  {size} @ {price}"` with dark-red (`#a62a3d`) arrow pointing at candle
- Candle high/low looked up from series data to anchor labels outside candle wicks
- Timestamps snapped to candle boundaries via `floorToCandlePeriod()`
- Minimum rectangle width of 6px CSS when entry and exit are on the same candle

**Primitive lifecycle**:
- `attached()` stores chart/series refs from LWC
- `setData(zones)` updates zone data and triggers repaint via `requestUpdate()`
- `setPeriod(sec)` / `setDecimals(n)` configure candle snapping and price formatting

### `bottom-panel/BottomPanel.tsx`

Tabbed panel at the bottom of the main content area. Always visible (tab bar shows even when `bottomPanelRatio` is 0).

Layout: horizontal tab bar (40px) with "Orders" and "Trades" tabs + content area below. Each tab shows a count badge: Orders shows open order count, Trades shows completed trade count (P&L non-null, not voided). Active tab has a blue underline indicator (`#2962ff`).

### `bottom-panel/OrdersTab.tsx`

Table of open orders for the active account. Columns: Time, Side (Buy/Sell), Symbol, Qty, Type, Price, Status, Cancel (✕). Orders fetched from store (`openOrders`). Cancel button calls `orderService.cancelOrder()`.

### `bottom-panel/TradesTab.tsx`

Table of session trades (closing fills only — filtered to `profitAndLoss != null && !voided`). Fetches trades on mount and account change via `tradeService.searchTrades()` using `getCmeSessionStart()` as the start boundary. Re-fetches on SignalR trade events (debounced 500ms).

Columns (10-column grid): Time, Side (Long/Short), Symbol, Qty, Entry, Exit, Duration, P&L, Fees, Net.

- **Partial-exit grouping**: Closing trades sharing the same matched entry (via `buildEntryMap()`) are grouped into a single collapsible row. Single-exit trades render as normal rows. Multi-exit groups show a parent row with aggregated totals and an "N exits ▸" toggle that expands to show individual exit sub-rows (indented, dimmer styling).
- **Duration column**: Time elapsed from entry to exit. Parent row shows total duration (entry → last exit); sub-rows show individual duration (entry → that exit). Formatted as `Xs`, `Xm Ys`, or `Xh Ym Zs`.
- **Sortable columns**: Click any column header to sort. Default: Time descending (most recent first). Click same column to toggle asc/desc. Active column shows ▲/▼ indicator.
- Uses `buildEntryMap()` from `TradeZonePrimitive.ts` to resolve entry prices for each closing trade
- Side shows "Long"/"Short" based on trade direction (closed with sell = was long)
- Net = P&L - Fees, colored green/red
- Clicking a single-exit row calls `toggleTradeVisibility(tradeId)`. Clicking a multi-exit parent row calls `toggleTradeVisibilityBulk(tradeIds)` to toggle all exits at once. Clicking a sub-row toggles just that exit.
- Selected rows highlighted with `bg-[#2962ff]/15` and a left accent border (`border-l-2 border-l-[#2962ff]`)

### `chart/DrawingToolbar.tsx`

Collapsible vertical toolbar on chart's left edge (`z-30`). Four tools: Select (cursor), Horizontal Line, Oval, Arrow Path. Collapsed state: small chevron button. Expanded: 36px wide strip with stacked tool icons. Active tool highlighted with `bg-[#2a2e39]`.

### `chart/DrawingEditToolbar.tsx`

Floating toolbar above selected drawing. Dark theme (`#1e222d` bg, 8px radius, deep shadow). Layout: `[Pencil+color | T] | [─ 1px] | [Template v] | [Trash]` (Template button only for hlines) with vertical dividers between groups.

Sub-popovers:
- **ColorPopover**: 7×10 color palette grid + custom color picker
- **TextPopover**: color swatch + font size + bold/italic toggles, multiline textarea, alignment dropdowns, Cancel/Ok
- **StrokePopover**: visual line thickness previews (1-4px)
- **TemplatePopover** (hline only, 220px wide): saved templates list (color dot + stroke preview + name + delete), "Save as..." inline input, "Apply defaults" reset, Export/Import buttons for JSON file sharing

Auto-positions via coordinate transforms, repositions on viewport changes.

### `chart/drawings/` (primitive renderers)

Canvas rendering via LWC `ISeriesPrimitive` plugin:
- **DrawingsPrimitive**: orchestrator managing all drawing views, drag preview during oval creation, arrow path creation preview, hit testing
- **HLineRenderer**: full-width horizontal line, 3 selection handles (black fill, dark blue border), text labels with configurable typography
- **OvalRenderer**: ellipse in bounding rect, 4 cardinal resize handles, text labels
- **ArrowPathRenderer**: multi-segment polyline with open V-shaped arrowhead on last segment. Per-node selection handles. Text label at path midpoint. Arrowhead size clamped to 40% of final segment length.
- **hitTesting**: `hitTestHLine` (Y-distance), `hitTestOval` (normalized ellipse perimeter distance), `hitTestArrowPath` (point-to-segment distance across all segments)

Drawing interactions in `useChartDrawings.ts`: click-to-place (hline), drag-to-create (oval), multi-click creation (arrow path: left-click adds nodes, right-click finalizes with rubber-band preview), click-to-select, drag-to-move (hline vertical, oval 2D, arrow path shifts all nodes), 4-handle resize (oval), per-node drag (arrow path), Escape to cancel/revert, Delete to remove. Selection handles across all drawing types use black fill with dark blue border. Drawings scoped per contractId, persisted to localStorage.

### `chart/ChartToolbar.tsx`

Horizontal toolbar: `[InstrumentSelector] | [1m] [15m] [...pinned] [▼ dropdown]  20:05:24 New York`

### `order-panel/OrderPanel.tsx`

Main panel component (240px wide sidebar). Handles:
- SignalR event wiring for orders, positions, and quotes
- Bracket engine integration (forwards order events, clears sessions)
- Preset suspend/restore on position open/close
- Ad-hoc bracket cleanup on position fill (clears preview + ad-hoc state when real orders exist)
- **Position close cleanup**: when position goes to size 0, fetches fresh open orders from API and cancels all orders for that contract (uses `String()` coercion on `contractId` comparison due to type mismatch between SignalR events and API responses)

Layout (top to bottom):
1. Instrument selector
2. Order type tabs (Market/Limit)
3. Contracts spinner (+/- size input)
4. Bracket summary (preset dropdown + config display)
5. Preview toggle checkbox
6. BUY / SELL buttons (side-by-side)
7. Position display (live P&L + action buttons)

### `order-panel/OrderTypeTabs.tsx`

Market/Limit toggle buttons. When Limit is selected, shows a price input field with tick-size step.

### `order-panel/ContractsSpinner.tsx`

Order size input with +/- buttons. Minimum 1 contract. Value persisted to localStorage.
When a bracket preset is selected, `orderSize` is auto-synced to the sum of TP contract sizes (via store actions `setActivePresetId`, `restorePreset`, `savePreset`). User can freely override after auto-sync.

### `order-panel/BracketSummary.tsx`

Custom dropdown selector for bracket presets:
- "None" option for naked orders
- Each preset shows name; pencil icon appears on hover to edit
- [+] button in header to create new preset
- When a preset is active, shows a config summary box with:
  - SL distance in points (with trailing indicator)
  - Each TP level: `{points}pt / {size}ct`
  - Each condition: `TP{N} hit → {action description}`
- **Draft-aware**: when draft overrides exist (from dragging preview lines), displays the draft values with lighter color + asterisk indicator

### `order-panel/BracketSettingsModal.tsx`

Full preset editor modal. Opened via `editingPresetId` store state (`'new'` or existing ID).

Sections:
- **Name**: required text input
- **Stop Loss**: points input + type dropdown (Stop/TrailingStop)
- **Take Profits**: add/remove TP levels, each with points + contracts (size) inputs
- **Conditions**: trigger (TP index filled) → action (move SL to BE, move SL to price, cancel TPs, etc.)
- **Footer**: Save, Delete (edit mode only), Cancel

Draft-based editing: clones config on open, saves back on confirm.

### `order-panel/BuySellButtons.tsx`

Side-by-side BUY (green) / SELL (red) buttons. On click:
1. Builds bracket config from either preset+draft overrides or ad-hoc state (`adHocSlPoints` + `adHocTpLevels`)
2. If brackets active (SL >= 1pt **or** TPs exist): arms bracket engine before HTTP call, confirms entry order ID after
3. If no brackets: naked order (no bracket arming)
4. Clears draft overrides after placement. For market orders: also clears ad-hoc state + toggles preview off. For limit orders: keeps ad-hoc SL/TP visible (hides only entry line via `previewHideEntry`)

### `order-panel/PositionDisplay.tsx`

Shows current position when one exists:
- Position info: `+1 @ 24,905.00` (green for long, red for short)
- Unrealized P&L: `UP&L: +12.50 $` (uses `useRef` to retain last value between quote updates)
- **SL to BE** button: always visible when position exists, disabled when not in profit. Handles three cases: bracket session (delegates to engine), existing SL order (modifies to entry price), no SL (places new stop order at entry)
- **Close** button: places opposite-side market order

When no position: shows "No position" placeholder.

---

### Draft Overrides (Preview Line Dragging)

Ephemeral point overrides for bracket config, set by dragging preview lines on chart:
- `draftSlPoints: number | null` — overrides `config.stopLoss.points`
- `draftTpPoints: (number | null)[]` — overrides `config.takeProfits[i].points`
- Auto-cleared on: preview toggle off, preset change, preset suspend, order placement
- Used by: `BuySellButtons` (merged into bracket config), `BracketSummary` (visual indicator), `useOrderLines` hook (line positions)

### Ad-Hoc Brackets (No Preset Required)

Ephemeral SL/TP state for orders without a bracket preset:
- `adHocSlPoints: number | null` — SL distance in points (null = no SL)
- `adHocTpLevels: { points: number; size: number }[]` — each TP with distance + contract count

**Pre-fill mode** (preview on, no preset selected):
- Entry label shows `[Limit Buy] [1] [+SL] [+TP] [✕]`
- **+SL**: creates SL line at default 10pt distance. Hidden once SL exists.
- **+TP**: creates TP line (1 contract, staggered distance 20/40/60pt). Hidden when all contracts allocated.
- SL/TP lines are draggable to reposition. ✕ on each removes it.
- Clicking entry label executes with ad-hoc brackets via bracket engine.
- For limit orders, SL/TP preview lines persist after submission until the entry order fills.

**Post-fill mode** (position drag-to-create):
- Drag from position label on chart to create real SL/TP orders directly.
- Drag shows a live dashed price line + overlay label with projected P&L during drag.
- Drag in loss direction → stop order (type 4, full position size). Blocked if stop order already exists.
- Drag in profit direction → limit order (type 1, 1 contract per drag). Blocked if no remaining contracts.
- Position drag uses capture-phase event listeners to ensure events aren't consumed by the chart canvas.

**Position close → auto-cancel all orders**: When a position closes (size=0), all open orders for that contract are cancelled automatically. Uses fresh API fetch (`searchOpenOrders`) rather than store state (which may be stale due to SignalR event ordering). `contractId` comparison uses `String()` coercion (API may return number, SignalR sends string).

Auto-cleared on: preview toggle off, preset selection, position fill (real bracket orders take over).

---

## Utilities (`src/utils/`)

### `instrument.ts`

Centralized instrument helpers — all P&L and price conversion formulas go through here.

```ts
getTicksPerPoint(contract)              // contract.ticksPerPoint ?? Math.round(1 / tickSize)
pointsToPrice(points, contract)         // points * tickSize * ticksPerPoint
priceToPoints(priceOffset, contract)    // inverse of pointsToPrice
pointsToTicks(points, contract)         // points * ticksPerPoint (for gateway bracket API)
calcPnl(priceDiff, contract, size)      // (priceDiff / tickSize) * tickValue * size
```

The P&L formula is universal: for futures `tickValue ≠ tickSize` (e.g. MNQ: 0.25 tick, $0.50 value), for crypto `tickValue == tickSize` so P&L simplifies to `priceDiff * size`.

### `toast.ts`

```ts
showToast(kind, title, detail?, duration?)  // writes to Zustand toast store slice
errorMessage(err: unknown): string          // extracts user-friendly message from unknown error
```

Works from non-React code (services, bracket engine). Default durations: error=8s, warning=6s, success=3s, info=4s. Pass `duration: null` for non-dismissible toasts.

### `retry.ts`

```ts
retryAsync<T>(fn, options?): Promise<T>     // exponential backoff with jitter
```

Options: `maxAttempts` (3), `baseDelay` (500ms), `maxDelay` (4s), `jitter` (true), `onRetry(err, attempt)`, `onExhausted(err)`. Delay sequence: 500ms → 1000ms → 2000ms with ±25% jitter. Used by bracket engine for SL/TP placement.

### `cmeSession.ts`

```ts
getCmeSessionStart(): string  // returns UTC ISO timestamp for 6 pm New York (CME session start)
```

Calculates the current CME session boundary. If current NY time is before 6 pm, returns yesterday's 6 pm. Used by `TradesTab` to scope trade searches to the current session only.

---

## What's Next

| # | Feature | Status |
|---|---------|--------|
| 1 | API layer (services + store) | Done |
| 2 | Settings modal (connect UI) | Done |
| 3 | TopBar (account selector) | Done |
| 4 | Candlestick chart (historical + real-time + timeframe selector) | Done |
| 5 | Order panel (market/limit, buy/sell, position+P&L, SignalR events) | Done |
| 6 | Bracket settings (presets, multi-TP, conditions engine) | Done |
| 7 | Chart interaction (preview lines, draggable orders, live order/position lines) | Done |
| 8 | Chart overlay labels (P&L labels, label-initiated drag, smooth sync) | Done |
| 9 | Ad-hoc brackets (+SL/+TP buttons, position drag-to-create, no preset required) | Done |
| 10 | Drawing tools (hline, oval, arrow path, text labels, color/stroke editing, drag-to-move, resize) | Done |
| 11 | Bottom panel (Orders + Trades tabs, draggable separator, session trade list) | Done |
| 12 | Trade zone visualization (entry/exit rectangles, FIFO matching, chart overlay) | Done |
