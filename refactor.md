# Codebase Refactoring Plan

Audit of 82 frontend files, 28 backend files. ~1,900+ lines of refactorable code identified.

---

## Phase 1 — Quick Wins (Low Risk, ~400 lines saved)

Extract duplicated utilities, hooks, and components that already exist in one place but are reimplemented elsewhere.

### 1.1 ✅ Shared utility functions → `utils/formatters.ts`

| Function | Duplicated in | Lines saved |
|----------|--------------|-------------|
| `shortSymbol()` (CON.F.US.MNQ.H26 → MNQH6) | OrdersTab, TradesTab, ConditionsTab | 15 |
| `formatPrice()` | PositionDisplay, TopBar, TradesTab | 10 |
| `getPnlColorClass(value)` | TopBar, PositionDisplay, TradesTab, overlay hooks | 25 |
| `formatTime()`, `formatDuration()` | TradesTab (move for reuse) | 10 |

### 1.2 ✅ Chart utility functions → `barUtils.ts`

| Function | Duplicated in | Lines saved |
|----------|--------------|-------------|
| `snapToTickSize(price, tickSize)` | useOrderLines, useQuickOrder, useConditionLines (8 sites) | 15 |
| `getPriceScaleWidth(chart)` | useQuickOrder | 20 |
| `getDecimals(tickSize)` | useChartBars, useChartWidgets, primitives | 10 |

### 1.3 ✅ `useClickOutside` hook

Extracted to `hooks/useClickOutside.ts`. Consumers: TopBar, BracketSummary, DatePresetSelector, ConditionsTab.

### 1.4 ⏭️ Reuse `installSizeButtons` in useQuickOrder (deferred)

`useQuickOrder.ts` size buttons have additional complexity (dual-hover on text+size cells, store integration, preview rebuilds) that doesn't map cleanly to `installSizeButtons()`. Replacing would require extending the API and risking other consumers.

### 1.5 ✅ Extract `useInstrumentSearch` hook

Extracted to `hooks/useInstrumentSearch.ts`. Shared: debounced search, bookmark resolution, `isBookmarked`, `toggleBookmark`. Both components also now use `useClickOutside`. UI stays separate.

### 1.6 ✅ Shared `TabButton` component

Moved to `components/shared/TabButton.tsx`. Consumers: BottomPanel, SettingsModal.

### 1.7 ✅ Shared inline icons → `components/icons/`

Extracted `ChevronDown` to `components/icons/ChevronDown.tsx`. Replaced local definitions in TopBar and ChartToolbar. BracketSettingsModal's variant left as-is (different SVG + absolute positioning for select indicators).

### 1.8 ✅ Backend `withConnection` middleware

Created `backend/src/middleware/withConnection.ts`. Applied to accountRoutes, orderRoutes, marketDataRoutes, tradeRoutes (~80 lines of boilerplate removed).

### 1.9 ✅ Missing Zod validation

Added `ContractSearchQuery` schema to marketDataRoutes (validates `q` and `live` params). Added `SettingsBodySchema` to settingsRoutes (validates body is a plain object before writing to disk). News route takes no params — no validation needed.

---

## Phase 2 — Service & Type Consolidation (Medium Risk, ~200 lines saved)

### 2.1 ✅ `dedup()` / `dedupByKey()` utilities

Created `utils/dedup.ts`. Applied to: authService, persistenceService, databaseService, newsService (`dedup`), tradeService (`dedupByKey`). Left marketDataService (cache-interleaved) and conditionService (takes baseUrl arg) as-is.

### 2.2 ✅ Fix type name collisions

- `orderService.Bracket` → `OrderBracket` (gateway bracket with ticks+type)
- `conditionService.Bracket` → `ConditionBracket` (SL/TP config for conditions)
- `bracket.ts Condition` → `BracketCondition` (automation rule in bracket config)

### 2.3 ✅ Switch newsService to axios

Switched from raw `fetch()` to shared `api` axios instance + `dedup()` wrapper.

### 2.4 ✅ Design token constants

Created `constants/colors.ts` (semantic color tokens for JS contexts) and `constants/styles.ts` (SECTION_LABEL, TABLE_ROW_STRIPE, INPUT_BASE/INPUT_DARK/INPUT_SURFACE). Applied color constants to 8 chart/primitive files (chartTheme, TradeZonePrimitive, CrosshairLabelPrimitive, VolumeProfilePrimitive, NewsEventsPrimitive, addTimeBanner, drawing.ts, buildPositionLabel).

### 2.5 ✅ Section label + table row constants

Replaced 14 section-label class strings with `SECTION_LABEL` across 9 files. Replaced 5 `bg-[#0d1117]/40` stripe literals with `TABLE_ROW_STRIPE` across 3 bottom-panel tabs.

---

## Phase 3 — Hook Decomposition (Higher Risk, ~800 lines restructured)

### 3.1 ✅ Split `useConditionLines.ts` (1,107 lines → 7 files)

| New hook | Responsibility | Est. lines |
|----------|---------------|------------|
| `useArmedConditionLines` | Armed condition line lifecycle | 95 |
| `useArmedConditionDrag` | Armed condition drag handling | 57 |
| `useConditionPreview` | Preview creation/destruction | 350 |
| `useConditionPreviewDrag` | Preview drag handling | 142 |
| `useConditionLinesSync` | Repositioning sync loop | 45 |

### 3.2 ✅ Split `useOverlayLabels.ts` (1,041 lines → 5 files)

| New hook | Responsibility | Est. lines |
|----------|---------------|------------|
| `usePositionLabel` | Position label lifecycle | 95 |
| `useOrderLabels` | Open order labels | 230 |
| `usePreviewLabels` | Preview ghost labels | 260 |
| `useQoPendingLabels` | Quick-order pending labels | 150 |
| `useOverlaySyncLoop` | Sync loop setup | 54 |

Also: P&L computation duplicated 4 times within this file → extract to shared helper.

### 3.3 ✅ Split `useChartDrawings.ts` (962 lines → 4 files)

Extracted `DrawingState`/`DrawingContext` types + coordinate helpers (`drawingInteraction.ts`), mouse handlers (`drawingHandlers.ts`), input handlers (`drawingInputHandlers.ts`). Orchestrator reduced to 198 lines.

### 3.4 ⏭️ Drawing `GenericPaneView` wrapper (deferred)

Each PaneView has unique hitTest/renderer logic with only ~10 lines of shared boilerplate per class. Net savings too small to justify the abstraction.

---

## Phase 4 — Structural (Highest Effort)

### 4.1 ✅ Split mega-store (772 lines → 8 files)

Split into 7 domain slices in `store/slices/`: connectionSlice (48), instrumentSlice (70), tradingSlice (228), drawingsSlice (182), layoutSlice (154), conditionsSlice (44), toastSlice (39). Orchestrator `useStore.ts` reduced to 81 lines. All existing imports unchanged via re-exports.

### 4.2 ✅ Shared `<Modal>` component

Extracted `shared/Modal.tsx` — backdrop overlay + centered panel + Escape key + backdrop click. All 4 modals (SettingsModal, ConditionModal, BracketSettingsModal, SnapshotPreview) now use it, gaining consistent close behavior.

### 4.3 ⏭️ Shared `<Dropdown>` component (deferred)

Dropdowns already use `useClickOutside` hook. Remaining boilerplate is ~4 lines per dropdown, and content varies significantly (simple lists vs edit/delete actions vs search). Net savings too small.

### 4.4 ✅ Input variant constants

Created `INPUT_DARK` (bg-[#111]) and `INPUT_SURFACE` (bg-[#131722]) in `constants/styles.ts`. Applied to SettingsModal (4 inputs) and ConditionModal (replaced local `inp` constant). BracketSettingsModal's `white/[0.05]` variant left as-is (intentionally different design language).

---

## Previous Refactoring (Completed)

### Multi-Exchange Abstraction (Phases 1-4 done)

- **Phase 1 ✅** Internal enums & types — replaced raw numeric literals with named enums
- **Phase 2 ✅** Backend exchange adapter — `ExchangeAdapter` interface, ProjectX implementation
- **Phase 3 ✅** Frontend realtime adapter — `RealtimeAdapter` interface, SignalR isolated
- **Phase 4 ✅** Instrument model generalization — `calcPnl()`, `pointsToPrice()`, removed `TICKS_PER_POINT`

### Future Exchange Work (Phases 5-6 deferred)

- **Phase 5** UI flexibility — fractional sizes, exchange-specific settings, crypto fields
- **Phase 6** Add crypto exchange — new adapter implementation
