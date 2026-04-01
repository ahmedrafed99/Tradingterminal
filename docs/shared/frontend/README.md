# Frontend Architecture Index

Full index of shared components, constants, store slices, hooks, utilities, and services. Use this as a starting point when implementing new features to **reuse existing abstractions** instead of duplicating code.

---

## Zustand Store (`store/`)

The store is split into **9 domain slices** combined in `useStore.ts` via Zustand's `persist` middleware with `partialize` for selective localStorage persistence.

```
store/
├── useStore.ts              ← combines all slices, re-exports common types
└── slices/
    ├── connectionSlice.ts   ← auth state, accounts, connection status
    ├── instrumentSlice.ts   ← contracts, timeframes, pinned instruments
    ├── tradingSlice.ts      ← orders, positions, order panel state, bracket presets
    │                           upsertOrder enrichments: (1) injects prices from pendingBracketInfo
    │                           for Suspended bracket legs that arrive without prices; (2) price-
    │                           preserving merge for all orders (status-only updates do not erase
    │                           previously known prices)
    ├── drawingsSlice.ts     ← drawing tools, templates, defaults, custom colors
    ├── layoutSlice.ts       ← dual chart, split ratio, bottom panel, VP settings
    ├── conditionsSlice.ts   ← conditional orders, condition server URL
    ├── chartSettingsSlice.ts← bar colors, canvas background, FPS counter, trade zone settings
    ├── shortcutsSlice.ts    ← custom keyboard shortcut bindings
    └── toastSlice.ts        ← toast notifications queue
```

Import everything from `useStore.ts` — it re-exports commonly used types (`Timeframe`, `ToastItem`, `TIMEFRAMES`, etc.) so consumers don't need to import from individual slices.

### Store subscription rules

**Never** call `useStore()` without a selector — this subscribes to the entire store and re-renders the component on every state change (including 60/sec price ticks). Always use one of these patterns:

```tsx
// ✅ Individual selector (best for 1-2 values — re-renders only when that value changes)
const openOrders = useStore((s) => s.openOrders);

// ✅ useShallow for multiple values (re-renders only when any selected value changes)
import { useShallow } from 'zustand/react/shallow';
const { positions, lastPrice, activeAccountId } = useStore(useShallow((s) => ({
  positions: s.positions,
  lastPrice: s.lastPrice,
  activeAccountId: s.activeAccountId,
})));

// ❌ NEVER — subscribes to entire store, re-renders on ANY change
const { positions, lastPrice } = useStore();
```

---

## Shared Components (`components/shared/`)

| Component | File | Purpose | Used by |
|-----------|------|---------|---------|
| `Modal` | `shared/Modal.tsx` | Backdrop overlay + centered panel + Escape key + backdrop click-to-close | SettingsModal, ConditionModal, BracketSettingsModal, SnapshotPreview |
| `TabButton` | `shared/TabButton.tsx` | Reusable tab button with active/inactive styling | BottomPanel, SettingsModal |

### Using `<Modal>`

The Modal provides only the shell behavior (backdrop, Escape, click-outside). Callers style the panel via `className`/`style` props:

```tsx
import { Modal } from '../shared/Modal';

<Modal onClose={handleClose} className="bg-[#1e222d] border border-[#2a2e39] rounded-2xl w-[480px]">
  {/* Panel content */}
</Modal>
```

Props:
- `onClose` — called on Escape key or backdrop click
- `className` / `style` — applied to the inner panel `<div>`
- `backdropClassName` / `backdropStyle` — applied to the backdrop (e.g. animation classes, `backdropFilter`)

The backdrop always uses `bg-black/60` (design token). Do **not** add a second backdrop div when using this component.

---

## Shared Icons (`components/icons/`)

| Icon | File | Props | Used by |
|------|------|-------|---------|
| `ChevronDown` | `icons/ChevronDown.tsx` | `className?: string` | TopBar, ChartToolbar |

10×10 SVG, `stroke="currentColor"`. BracketSettingsModal has its own 14×14 variant with absolute positioning — do not merge them.

---

## Constants (`constants/`)

### `shortcuts.ts` — Keyboard Shortcut Definitions

Defines `SHORTCUT_IDS` and default key combinations for configurable shortcuts (e.g. drawing tools, quick actions). Used by `shortcutsSlice.ts` and `ShortcutsTab.tsx`.

### `colors.ts` — Semantic Color Tokens (JS contexts)

For **inline styles**, **canvas drawing**, and **JS logic** (not Tailwind classes — JIT needs literal strings).

| Constant | Value | Usage |
|----------|-------|-------|
| `COLOR_BUY` | `#26a69a` | Profit, long, buy side |
| `COLOR_SELL` | `#ef5350` | Loss, short, sell side |
| `COLOR_ACCENT` | `#2962ff` | Primary action, selection |
| `COLOR_ACCENT_HOVER` | `#1e4fcc` | Accent hover state |
| `COLOR_TEXT` | `#d1d4dc` | Primary text |
| `COLOR_TEXT_MUTED` | `#787b86` | Labels, secondary info |
| `COLOR_TEXT_DIM` | `#434651` | Placeholders, empty states |
| `COLOR_SURFACE` | `#1e222d` | Modal/hover surface |
| `COLOR_BORDER` | `#2a2e39` | All borders |
| `COLOR_BG` | `#131722` | Page/chart background |
| `COLOR_INPUT` | `#111111` | Input/control background |
| `COLOR_WARNING` | `#f0a830` | Active accent, warnings |
| `COLOR_ERROR` | `#f23645` | Error states |

**When to use**: Chart primitives, canvas renderers, theme config, inline `style={{}}` props.
**When NOT to use**: Tailwind class strings — use hex literals directly (e.g. `text-[#d1d4dc]`).

### `styles.ts` — Tailwind Class-String Constants

Reusable class strings for patterns that repeat 5+ times across components.

| Constant | Value | Usage |
|----------|-------|-------|
| `SECTION_LABEL` | `'text-[10px] uppercase tracking-wider text-[#787b86]'` | All panel section headers (14+ sites) |
| `TABLE_ROW_STRIPE` | `'bg-[#0d1117]/40'` | Alternating row backgrounds in bottom-panel tabs |
| `TABLE_ROW_HOVER` | `'hover:bg-[#1e222d]/50 transition-colors'` | Row hover effect |
| `TABLE_ROW` | `TABLE_ROW_HOVER` | Alias |
| `INPUT_BASE` | Full border/text/focus/disabled classes | Base input styling (never use alone) |
| `INPUT_DARK` | `INPUT_BASE + 'bg-[#111] border-[#2a2e39]'` | Standard dark inputs (SettingsModal) |
| `INPUT_SURFACE` | `INPUT_BASE + 'bg-[#131722] ...'` | Surface-colored inputs (ConditionModal) |

**Usage**: Compose with template literals for extra classes:
```tsx
import { SECTION_LABEL } from '../../constants/styles';
<div className={`${SECTION_LABEL} mb-1 text-center`}>Order Type</div>
```

**Note**: BracketSettingsModal uses its own `bg-white/[0.05]` input style — this is intentional (different design language for that modal).

---

## Shared Hooks (`hooks/`)

| Hook | File | Purpose | Used by |
|------|------|---------|---------|
| `useClickOutside` | `hooks/useClickOutside.ts` | Close dropdowns/popovers on outside click | TopBar, BracketSummary, DatePresetSelector, ConditionsTab, InstrumentSelector, InstrumentSelectorPopover |
| `useInstrumentSearch` | `hooks/useInstrumentSearch.ts` | Debounced contract search, bookmark resolution, `isBookmarked`, `toggleBookmark` | InstrumentSelector, InstrumentSelectorPopover |
| `useSettingsSync` | `hooks/useSettingsSync.ts` | Two-way sync between Zustand store and backend file persistence | App.tsx |
| `useRemoteDrawings` | `hooks/useRemoteDrawings.ts` | Connects to SSE stream at `/drawings/events` and syncs remote drawings into store in real-time. Supports `_command: 'clearAll'` and `_command: 'remove'` | App.tsx |

**Important**: `useInstrumentSearch` is a **data/logic hook only**. The two instrument selector components (InstrumentSelector and InstrumentSelectorPopover) have different UI — do not merge their visual implementations.

---

## Shared Utilities (`utils/`)

| Utility | File | Exports | Used by |
|---------|------|---------|---------|
| `formatters` | `utils/formatters.ts` | `shortSymbol()`, `formatPrice()`, `getPnlColorClass()`, `formatTime()`, `formatDuration()` | OrdersTab, TradesTab, ConditionsTab, TopBar, PositionDisplay |
| `dedup` | `utils/dedup.ts` | `dedup(fn)`, `dedupByKey(fn, keyFn)` — in-flight promise deduplication | authService, persistenceService, databaseService, newsService, tradeService |
| `instrument` | `utils/instrument.ts` | `calcPnl()`, `pointsToPrice()`, `roundToTick()`, tick/point helpers | PositionDisplay, overlay hooks, chart trading, bracketEngine |
| `cmeSession` | `utils/cmeSession.ts` | `getCmeSessionStart()`, `getDateRange()`, `DatePreset` type | App.tsx, TradesTab, DatePresetSelector |
| `marketHours` | `utils/marketHours.ts` | `MarketType` (`'futures' \| 'crypto'`); `getSchedule(type?)` — returns `{ isOpen, getNextOpenLabel, getNextCloseLabel, getSessionInfo }` per market type; `useMarketStatus(type?)` — reactive hook returning `{ open, reopenLabel, closeLabel, session }` (skips timer for crypto); `SessionInfo` — progress, dayLabel, start/end labels, countdown text | ChartToolbar, BuySellButtons, MarketStatusBadge, useQuickOrder, buildPreviewLabels, useChartBars |
| `toast` | `utils/toast.ts` | `showToast()`, `errorMessage()` | All components that show notifications |
| `retry` | `utils/retry.ts` | Axios retry interceptor for cold-start handling | conditionService |

---

## Service Layer (`services/`)

All services call the local Express proxy (never ProjectX directly). See `docs/api-layer/` for full API signatures.

| Service | File | Responsibility |
|---------|------|---------------|
| `authService` | `services/authService.ts` | Connect, disconnect, status |
| `accountService` | `services/accountService.ts` | List accounts |
| `marketDataService` | `services/marketDataService.ts` | Bars history, contract search, caching |
| `orderService` | `services/orderService.ts` | Place, cancel, modify, list orders |
| `tradeService` | `services/tradeService.ts` | Search trades by date range |
| `realtimeService` | `services/realtimeService.ts` | SignalR hub manager (quotes, orders, positions) |
| `persistenceService` | `services/persistenceService.ts` | Load/save settings to backend file |
| `conditionService` | `services/conditionService.ts` | Conditional orders CRUD + SSE events |
| `bracketEngine` | `services/bracketEngine.ts` | Client-side SL/TP management after fill |
| `databaseService` | `services/databaseService.ts` | Local SQLite candle storage |
| `newsService` | `services/newsService.ts` | Economic calendar events |
| `audioService` | `services/audioService.ts` | Voice notification playback on fills |
| `api` | `services/api.ts` | Base axios instance with error-handling interceptor |
| `credentialService` | `services/credentialService.ts` | Load/save/clear encrypted credentials via backend |
| `positionService` | `services/positionService.ts` | Open positions REST query (graceful degradation to SignalR-only) |
| `conditionTickForwarder` | `services/conditionTickForwarder.ts` | WebSocket bridge forwarding quote ticks to condition engine |
| `manualCloseTracker` | `services/manualCloseTracker.ts` | Tracks manual position closes to prevent wrong sound alerts |

---

## Types (`types/`)

| File | Contents |
|------|----------|
| `types/enums.ts` | OrderType, OrderSide, OrderStatus, PositionType enums |
| `types/bracket.ts` | BracketConfig, BracketCondition, ConditionTrigger, ConditionAction, BracketPreset |
| `types/drawing.ts` | Drawing union type, DrawingBase, all drawing subtypes, DrawingText, AnchoredPoint, constants |
| `types/news.ts` | EconomicEvent type for calendar markers |

### `OrderStatus` enum (`types/enums.ts`)

| Value | Name | Meaning |
|-------|------|---------|
| 1 | `Working` | Order is live and working on the exchange |
| 2 | `Filled` | Order fully filled |
| 3 | `Cancelled` | Order cancelled |
| 4 | `Rejected` | Order rejected by gateway or exchange |
| 5 | `Expired` | Order expired (e.g. day order past session close) |
| 6 | `Pending` | Accepted by gateway but not yet confirmed working |
| 8 | `Suspended` | Contingent bracket leg, waiting for parent entry to fill |

**Important gateway behavior for `Suspended` orders**:
- Never appears in `searchOpenOrders` REST responses — the gateway only returns Working orders
- SignalR delivers Suspended bracket legs with no `limitPrice` / `stopPrice` — prices must be sourced from `pendingBracketInfo` in the store and injected by `upsertOrder`
- `modifyOrder` called on a Suspended order is acknowledged (no error) but silently ignored by the gateway until the parent entry fills

---

## Chart Hook Decomposition (`components/chart/hooks/`)

Large chart hooks have been split into focused sub-hooks:

### `useConditionLines` → 5 files
| Hook | Responsibility |
|------|---------------|
| `useArmedConditionLines` | Armed condition line lifecycle |
| `useArmedConditionDrag` | Armed condition drag handling |
| `useConditionPreview` | Preview creation/destruction |
| `useConditionPreviewDrag` | Preview drag handling |
| `useConditionLinesSync` | Repositioning sync loop |

### `useOverlayLabels` → 4 files
| Hook | Responsibility |
|------|---------------|
| `usePositionLabel` | Position label lifecycle |
| `useOrderLabels` | Open order labels (Working + Suspended) |
| `usePreviewLabels` | Preview ghost labels |
| `useOverlaySyncLoop` | Sync loop setup |

### `useChartDrawings` → 4 files
| Hook/Module | Responsibility |
|-------------|---------------|
| `drawingInteraction.ts` | DrawingState/DrawingContext types + coordinate helpers |
| `drawingHandlers.ts` | Mouse handlers |
| `drawingInputHandlers.ts` | Input handlers |
| `useChartDrawings.ts` | Orchestrator (198 lines) |

---

## Backend Middleware (`backend/src/middleware/`)

| Middleware | File | Purpose |
|------------|------|---------|
| `withConnection` | `middleware/withConnection.ts` | Auth guard — wraps route handlers, checks adapter connection, returns 401 if not connected | Used by accountRoutes, orderRoutes, marketDataRoutes, tradeRoutes |

### Zod Validation (`backend/src/validate.ts`)

| Helper | Purpose |
|--------|---------|
| `validateBody(schema)` | Express middleware — validates `req.body` against a Zod schema |
| `validateQuery(schema)` | Express middleware — validates `req.query` against a Zod schema |

Used by: settingsRoutes (`validateBody`), marketDataRoutes (`validateQuery` for contract search), orderRoutes, conditionRoutes.
