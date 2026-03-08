# Bottom Panel

Collapsible, resizable panel below the chart displaying **Orders** and **Trades** tabs.

## Layout

- **Tab bar** (h-10, always visible) sits at the bottom of the screen with Orders / Trades tabs, item counts, and a collapse/expand chevron.
- **Content area** appears above the tab bar when expanded, rendered as a flex-ratio split with the chart area via `VerticalSeparator` in `App.tsx`.
- Panel ratio is draggable (15%–60%) and persisted to localStorage.

## Files

| File | Purpose |
|------|---------|
| `BottomPanel.tsx` | Container with tab bar, tab switching, collapse/expand toggle |
| `OrdersTab.tsx` | Table of open orders with cancel buttons |
| `TradesTab.tsx` | Grid of trades with date preset selector and click-to-show-on-chart |
| `DatePresetSelector.tsx` | Dropdown for choosing trade date range (Today, This Week, This Month) |

## Store (Zustand)

State lives in the `BottomPanelState` slice of `useStore`:

| Field | Type | Default | Persisted |
|-------|------|---------|-----------|
| `bottomPanelOpen` | `boolean` | `false` | Yes |
| `bottomPanelRatio` | `number` | `0.3` | Yes |
| `bottomPanelTab` | `'orders' \| 'trades' \| 'conditions'` | `'orders'` | Yes |
| `tradesDatePreset` | `DatePreset` | `'today'` | Yes |
| `sessionTrades` | `Trade[]` | `[]` | No |
| `visibleTradeIds` | `number[]` | `[]` | No |

Actions: `setBottomPanelOpen`, `setBottomPanelRatio`, `setBottomPanelTab`, `setTradesDatePreset`, `setSessionTrades`, `toggleTradeVisibility`, `toggleTradeVisibilityBulk`, `clearVisibleTradeIds`.

## Orders Tab

- Reads `openOrders` from store (kept in sync by OrderPanel's SignalR handlers).
- Columns: Side, Type, Symbol, Size, Price, Cancel button.
- Cancel calls `orderService.cancelOrder(accountId, orderId)`.
- No additional data fetching needed — store is already live via SignalR.

## Trades Tab

- **Date preset selector**: Dropdown in the tab bar (next to "Trades" tab) lets the user choose between Today (default), This Week, and This Month. The selected preset determines the `startTimestamp` passed to `tradeService.searchTrades()`. Preset is persisted to localStorage. Results are cached in memory per `accountId:preset` key.
- **Decoupled from RPNL**: Display trades (local state) are independent of `sessionTrades` in the store. Session trades (for TopBar RPNL) are fetched in `App.tsx` on connect and refreshed via SignalR — runs regardless of which bottom panel tab is active.
- Fetches filtered display trades on mount and whenever account or preset changes via `tradeService.searchTrades(accountId, startTimestamp, endTimestamp?)`.
- Re-fetches display trades on SignalR trade events (debounced 500ms). Cache is invalidated on new trade events.
- Time column shows `MM/DD HH:MM` format for week/month presets, `HH:MM:SS` for session/today.
- Columns: Time, Side, Symbol, Qty, Entry, Exit, Duration, P&L, Fees, Net.
- All columns are center-aligned. Data grid is constrained to 70% width while row backgrounds (stripes, hover, selection) extend full width.
- **Sortable columns**: Click any column header to sort by that column (descending by default). Click the same column again to toggle between ascending and descending. Active sort column is highlighted in white with a ▲/▼ indicator. Default sort: Time descending (most recent first).
- **Partial-exit grouping**: Closing trades that share the same entry (via `buildEntryMap()` FIFO matching) are grouped into a single parent row. Single-exit trades render as normal rows with no grouping UI. Multi-exit groups show:
  - **Parent row**: entry time, total qty, entry price, `N exits ▸/▾` toggle, total duration (entry → last exit), summed P&L / Fees / Net.
  - **Sub-rows** (when expanded): indented, dimmer text, showing each exit's time, qty, exit price, individual duration (entry → that exit), individual P&L / Fees / Net. Side, Symbol, and Entry columns are left blank (inherited from parent).
  - Expand/collapse is local UI state (`useState<Set<number>>`), toggled by clicking the "N exits" cell.
- **Duration column**: Shows elapsed time from entry to exit, formatted as `Xs`, `Xm Ys`, or `Xh Ym Zs`.
- **Click-to-show-on-chart**: Clicking a single-exit row toggles `toggleTradeVisibility(tradeId)`. Clicking a multi-exit parent row toggles all exit IDs at once via `toggleTradeVisibilityBulk(tradeIds)`. Clicking an individual sub-row toggles just that exit. Selected rows get a blue tint (`bg-[#2962ff]/15`) and a left accent border (`border-l-2 border-l-[#2962ff]`). Visible trade IDs are consumed by `CandlestickChart.tsx` to render trade zone overlays on the chart via `TradeZonePrimitive`.
- Entry prices resolved via `buildEntryMap()` from `TradeZonePrimitive.ts` (FIFO matching with size-aware claiming — a single entry trade can match multiple partial exits).
- Opening half-turns (`profitAndLoss === null`) and voided trades are filtered out.
- Trades displayed in reverse chronological order (most recent first) by default.

## Chart Trade Markers

When a trade ID is in `visibleTradeIds`, `CandlestickChart.tsx` renders a series marker:

- Buy fills: green (`#26a69a`) upward arrow at the trade price
- Sell fills: red (`#ef5350`) downward arrow at the trade price
- Marker time is snapped to the candle boundary via `floorToCandlePeriod()`
- Markers reposition when the timeframe changes

## Shared Utility

`frontend/src/utils/cmeSession.ts` exports:
- `getCmeSessionStart()` — UTC ISO timestamp for the current CME session start (6 PM New York time). Used by `App.tsx` for session trade fetching (RPNL).
- `DatePreset` type — `'today' | 'week' | 'month'`.
- `DATE_PRESET_LABELS` — display labels for each preset.
- `getDateRange(preset)` — returns `{ startTimestamp, endTimestamp? }` for the given preset. Used by `TradesTab` and `DatePresetSelector`.

## Styling

Consistent with the app's dark theme:

- Panel/header background: `bg-black`
- Borders: `border-[#2a2e39]`
- Tab text: `text-[#787b86]` (inactive), `text-[#d1d4dc]` (active) with blue underline
- Buy: `text-[#26a69a]`, Sell: `text-[#ef5350]`
- Row hover: `hover:bg-[#1e222d]/50`
- Alternating stripes: `bg-[#0d1117]/40`
- Tabular numbers: `fontFeatureSettings: '"tnum"'`
