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
| `TradesTab.tsx` | Grid of session trades with click-to-show-on-chart |

## Store (Zustand)

State lives in the `BottomPanelState` slice of `useStore`:

| Field | Type | Default | Persisted |
|-------|------|---------|-----------|
| `bottomPanelOpen` | `boolean` | `false` | Yes |
| `bottomPanelRatio` | `number` | `0.3` | Yes |
| `bottomPanelTab` | `'orders' \| 'trades'` | `'orders'` | Yes |
| `sessionTrades` | `Trade[]` | `[]` | No |
| `visibleTradeIds` | `number[]` | `[]` | No |

Actions: `setBottomPanelOpen`, `setBottomPanelRatio`, `setBottomPanelTab`, `setSessionTrades`, `toggleTradeVisibility`, `clearVisibleTradeIds`.

## Orders Tab

- Reads `openOrders` from store (kept in sync by OrderPanel's SignalR handlers).
- Columns: Side, Type, Symbol, Size, Price, Cancel button.
- Cancel calls `orderService.cancelOrder(accountId, orderId)`.
- No additional data fetching needed — store is already live via SignalR.

## Trades Tab

- Fetches trades on mount via `tradeService.searchTrades(accountId, getCmeSessionStart())`.
- Re-fetches on SignalR trade events (debounced 500ms).
- Columns: Time, Side, Symbol, Qty, Entry, Exit, P&L, Fees, Net.
- All columns are center-aligned. Data grid is constrained to 70% width while row backgrounds (stripes, hover, selection) extend full width.
- **Sortable columns**: Click any column header to sort by that column (descending by default). Click the same column again to toggle between ascending and descending. Active sort column is highlighted in white with a ▲/▼ indicator. Default sort: Time descending (most recent first).
- **Click-to-show-on-chart**: Clicking a closing trade row (one with P&L) toggles `toggleTradeVisibility(tradeId)`. Selected rows get a blue tint (`bg-[#2962ff]/15`) and a left accent border (`border-l-2 border-l-[#2962ff]`). Visible trade IDs are consumed by `CandlestickChart.tsx` to render trade zone overlays on the chart via `TradeZonePrimitive`.
- Entry prices resolved via `buildEntryMap()` from `TradeZonePrimitive.ts` (FIFO matching).
- Opening half-turns (`profitAndLoss === null`) and voided trades are filtered out.
- Trades displayed in reverse chronological order (most recent first) by default.

## Chart Trade Markers

When a trade ID is in `visibleTradeIds`, `CandlestickChart.tsx` renders a series marker:

- Buy fills: green (`#26a69a`) upward arrow at the trade price
- Sell fills: red (`#ef5350`) downward arrow at the trade price
- Marker time is snapped to the candle boundary via `floorToCandlePeriod()`
- Markers reposition when the timeframe changes

## Shared Utility

`frontend/src/utils/cmeSession.ts` exports `getCmeSessionStart()` — returns the UTC ISO timestamp for the current CME session start (6 PM New York time). Used by both `TradesTab` and `TopBar` for trade search queries.

## Styling

Consistent with the app's dark theme:

- Panel/header background: `bg-black`
- Borders: `border-[#2a2e39]`
- Tab text: `text-[#787b86]` (inactive), `text-[#d1d4dc]` (active) with blue underline
- Buy: `text-[#26a69a]`, Sell: `text-[#ef5350]`
- Row hover: `hover:bg-[#1e222d]/50`
- Alternating stripes: `bg-[#0d1117]/40`
- Tabular numbers: `fontFeatureSettings: '"tnum"'`
