# Refactor Plan

## Shared UI Primitives

### Problem
New UI components (popovers, buttons) get added with no shared shell — each one invents its own padding, margin, border-radius, and hover handling from scratch. Result: visually inconsistent UI across 60+ components.

### Root cause
`shared/` has a `Modal` primitive but nothing for popovers or buttons. So every context menu, dropdown, and button re-implements the same shell and interactive styles differently.

### Missing primitives

#### 1. `shared/Popover.tsx`
The shell used by all floating overlays (context menus, color pickers, dropdowns).  
Standardizes: `bg-(--color-panel)`, `border-(--color-border)`, `SHADOW.XL`, `rounded-lg`, `py-1`.

#### 2. `shared/MenuItem.tsx`
A single row inside a popover/menu.  
Standardizes: `px-3 py-2`, `hover:bg-(--color-surface)`, `text-xs`, icon+label layout, `cursor-default`.

#### 3. `shared/Button.tsx`
Button with variants:
- `ghost` — transparent bg, optional border, `hover:bg-(--color-surface)`
- `primary` — filled `bg-(--color-accent)`, white text
- `danger` — filled `bg-(--color-error)`, white text
- `icon` — square, no label, `p-1.5`

Standardizes: padding (sm/md/lg), font-size `text-xs`, `rounded`, `transition-colors`, `disabled:opacity-50 disabled:cursor-not-allowed`.

### Components to migrate after primitives are built

| Component | Uses |
|---|---|
| `ChartContextMenu` | Popover shell + MenuItem |
| `ChartTimeScaleContextMenu` | Popover shell + MenuItem |
| `ColorPopover` | Popover shell |
| `InstrumentSelectorPopover` | Popover shell |
| `LockoutButton` | Popover shell + Button (ghost, danger) |
| `DatePresetSelector` | Popover shell + MenuItem |
| `ChartToolbar` | Button (icon, ghost) |
| `DrawingEditToolbar` | Button (icon) |
| `BuySellButtons` | Button (primary) |
| `ConditionModal` | Button (primary, ghost) |
| `BracketSettingsModal` | Button (primary, ghost) |

---

## useChartBars Split

`useChartBars.ts` is 1183 lines across 7 concerns. Target: 4 focused hooks + a thin coordinator.

### Phase 1 — Bug fixes ✅
1. Added `if (cancelled) return;` after the partial-bar try/catch — prevents post-unmount state mutations and a subscription leak.
2. Rebuilt `dataMap` from `refs.bars.current` using `barToCandle()` instead of `candles` — partial bars now included in crosshair sync.

### Phase 2 — Pure moves ✅

| New file | Responsibility | Source lines |
|---|---|---|
| `useHistoricalBars.ts` | Backtest streaming + live load + cache + load-more + aggregation | 90–622 |
| `useRealtimeQuotes.ts` | Quotes + ticks + visibility backfill | 624–978 |
| `useMarketDepth.ts` | Depth subscription + DOM settings + hover | 980–1136 |
| `useChartInteraction.ts` | Dblclick chart-settings opener | 1138–1180 |
| `useChartBars.ts` | Thin coordinator | ~20 lines |

**Shared state** — coordinator owns, passes as args:
- `tradeAnchorMapRef` — written on load (historical), updated per tick (realtime)
- `ticksRemainingRef` — set on load (historical), decremented per tick (realtime)

Everything else owns cleanly: load-more refs + cache → `useHistoricalBars`; `domContractIdRef` → `useMarketDepth`; effect-local lets (`pendingBar`, `quoteRafId`, etc.) stay inside `useRealtimeQuotes`.

**Invariant:** hook call order in coordinator must match today's effect order — `useHistoricalBars` → `useRealtimeQuotes` → `useMarketDepth` → `useChartInteraction`. React fires effects in hook declaration order; reordering is an invisible behavior change.

**Do not split `useRealtimeQuotes` internally** — `handleQuote`, `flushQuote`, `triggerBackfill`, etc. share effect-local state. Splitting would force those into refs for no clarity gain.

### Phase 3 — Optional (separate PR)
- Consolidate the 6 DOM micro-effects in `useMarketDepth` into one.
- `useHistoricalBars` will still be ~530 lines — candidates for a further split: backtest vs live loading, load-more as `useLoadMore`.

### Verification (manual, after Phase 2)
1. Load chart → switch timeframe (aggregation fast-path + cache)
2. Switch contract (scroll reset, depth clear)
3. Watch live ticks update the forming bar
4. Switch to a tick-bar timeframe
5. Load backtest mode
6. Toggle market depth on/off
7. Simulate reconnect