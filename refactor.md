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

### 1.7 Shared inline icons → `components/icons/`

`ChevronDown` duplicated in TopBar and BracketSettingsModal. Move all inline SVG icons (Eye, EyeOff, ChevronDown, Settings) to `components/icons/`.

### 1.8 ✅ Backend `withConnection` middleware

Created `backend/src/middleware/withConnection.ts`. Applied to accountRoutes, orderRoutes, marketDataRoutes, tradeRoutes (~80 lines of boilerplate removed).

### 1.9 Missing Zod validation

Add schemas for 3 unvalidated routes: contract search, news, settings PUT. The settings PUT writes `req.body` directly to disk with no schema check.

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

### 2.4 Design token constants

Centralize repeated styling values:

| File | Purpose |
|------|---------|
| `constants/colors.ts` | All semantic colors (`#26a69a`, `#ef5350`, `#787b86`, etc.) |
| `constants/styles.ts` | Section label class, table row stripe, input variants, button variants |

### 2.5 Section label + table row constants

`text-[10px] uppercase tracking-wider text-[#787b86]` repeated 6+ times. `bg-[#0d1117]/40` stripe + `hover:bg-[#1e222d]/50` repeated in 3 tab components.

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

### 4.2 Shared `<Modal>` component

3 modal implementations (SettingsModal, BracketSettingsModal, ConditionModal) repeat the same backdrop + panel + header + body + footer structure (~50-80 lines each).

### 4.3 Shared `<Dropdown>` component

4 dropdown implementations (account selector, bracket preset, date preset, status filter) with identical toggle + absolute-div + item-list pattern.

### 4.4 Input/button variant system

3 different input styling constants (`#111` vs `#131722` vs `white/[0.05]`) and 3 button variant patterns. Unify into composable constants or components.

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
