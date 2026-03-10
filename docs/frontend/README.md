# Frontend Architecture Index

Full index of shared components, constants, store slices, hooks, utilities, and services. Use this as a starting point when implementing new features to **reuse existing abstractions** instead of duplicating code.

---

## Zustand Store (`store/`)

The store is split into **7 domain slices** combined in `useStore.ts` via Zustand's `persist` middleware with `partialize` for selective localStorage persistence.

```
store/
├── useStore.ts              ← combines all slices, re-exports common types
└── slices/
    ├── connectionSlice.ts   ← auth state, accounts, connection status
    ├── instrumentSlice.ts   ← contracts, timeframes, pinned instruments
    ├── tradingSlice.ts      ← orders, positions, order panel state, bracket presets
    ├── drawingsSlice.ts     ← drawing tools, templates, defaults, custom colors
    ├── layoutSlice.ts       ← dual chart, split ratio, bottom panel, VP settings
    ├── conditionsSlice.ts   ← conditional orders, condition server URL
    └── toastSlice.ts        ← toast notifications queue
```

Import everything from `useStore.ts` — it re-exports commonly used types (`Timeframe`, `ToastItem`, `TIMEFRAMES`, etc.) so consumers don't need to import from individual slices.

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

**Important**: `useInstrumentSearch` is a **data/logic hook only**. The two instrument selector components (InstrumentSelector and InstrumentSelectorPopover) have different UI — do not merge their visual implementations.

---

## Shared Utilities (`utils/`)

| Utility | File | Exports | Used by |
|---------|------|---------|---------|
| `formatters` | `utils/formatters.ts` | `shortSymbol()`, `formatPrice()`, `getPnlColorClass()`, `formatTime()`, `formatDuration()` | OrdersTab, TradesTab, ConditionsTab, TopBar, PositionDisplay |
| `dedup` | `utils/dedup.ts` | `dedup(fn)`, `dedupByKey(fn, keyFn)` — in-flight promise deduplication | authService, persistenceService, databaseService, newsService, tradeService |
| `instrument` | `utils/instrument.ts` | `calcPnl()`, `pointsToPrice()`, tick/point helpers | PositionDisplay, overlay hooks, chart trading |
| `cmeSession` | `utils/cmeSession.ts` | `getCmeSessionStart()`, `getDateRange()`, `DatePreset` type | App.tsx, TradesTab, DatePresetSelector |
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

### `useOverlayLabels` → 5 files
| Hook | Responsibility |
|------|---------------|
| `usePositionLabel` | Position label lifecycle |
| `useOrderLabels` | Open order labels |
| `usePreviewLabels` | Preview ghost labels |
| `useQoPendingLabels` | Quick-order pending labels |
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
