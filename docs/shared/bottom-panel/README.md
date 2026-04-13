# Bottom Panel

Collapsible, resizable panel below the chart displaying **Orders**, **Trades**, and **Conditions** tabs.

## Layout

- **Tab bar** (h-10, always visible) sits at the bottom of the screen with Orders / Trades / Conditions tabs, item counts, and a collapse/expand chevron.
- **Content area** appears above the tab bar when expanded, rendered as a flex-ratio split with the chart area via `VerticalSeparator` in `App.tsx`.
- Panel ratio is draggable (15%–60%) and persisted to localStorage.

## Files

| File | Purpose |
|------|---------|
| `BottomPanel.tsx` | Container with tab bar, tab switching, collapse/expand toggle. ConditionsTab stays mounted (hidden) to keep SSE alive |
| `OrdersTab.tsx` | Table of open orders with cancel buttons |
| `TradesTab.tsx` | Grid of trades with date preset selector and click-to-show-on-chart |
| `ConditionsTab.tsx` | Table of armed/paused/triggered conditions with SSE updates. Stays mounted (hidden) to keep SSE connection alive |
| `DatePresetSelector.tsx` | Dropdown for choosing trade date range (Today, This Week, This Month). Shows per-preset trade counts in both the trigger button and dropdown options. Animated open/close (fade + slide, 150ms) |

## Store (Zustand)

State lives in the `layoutSlice` (`store/slices/layoutSlice.ts`). See `docs/shared/frontend/` for the full slice breakdown.

| Field | Type | Default | Persisted |
|-------|------|---------|-----------|
| `bottomPanelOpen` | `boolean` | `false` | Yes |
| `bottomPanelRatio` | `number` | `0` | Yes |
| `bottomPanelPreviousRatio` | `number` | `0.3` | Yes |
| `bottomPanelTab` | `'orders' \| 'trades' \| 'conditions'` | `'orders'` | Yes |
| `tradesDatePreset` | `DatePreset` | `'today'` | Yes |
| `sessionTrades` | `Trade[]` | `[]` | No |
| `displayTrades` | `Trade[]` | `[]` | No |
| `visibleTradeIds` | `string[]` | `[]` | No |

Actions: `setBottomPanelOpen`, `setBottomPanelRatio`, `setBottomPanelPreviousRatio`, `setBottomPanelTab`, `toggleBottomPanel`, `setTradesDatePreset`, `setSessionTrades`, `setDisplayTrades`, `toggleTradeVisibility`, `toggleTradeVisibilityBulk`, `clearVisibleTradeIds`.

## Collapse / Expand Toggle

A chevron button is centered on the `VerticalSeparator` drag bar in `App.tsx`:

- **Hidden by default**, fades in on hover over the separator (`group-hover:opacity-100`).
- **Always visible when collapsed** (`opacity-100`) so the user can re-expand.
- Chevron points **down** when expanded (click to collapse), **up** when collapsed (click to expand).
- `toggleBottomPanel()` saves the current ratio to `bottomPanelPreviousRatio` before collapsing to 0, and restores it on expand.
- Toggle animates with a 200ms ease transition on the flex values; dragging remains instant (no transition during drag).
- Dragging the separator still respects the `minHeight: 40` floor (tab bar always visible). Only the toggle button can fully collapse the panel.

## Orders Tab

- Reads `openOrders` from store (kept in sync by OrderPanel's SignalR handlers).
- Columns: Side, Type, Symbol, Qty, Price, Cancel button.
- Cancel calls `orderService.cancelOrder(accountId, orderId)`.
- No additional data fetching needed — store is already live via SignalR.

## Trades Tab

- **Date preset selector**: Dropdown in the header row lets the user choose between Today (default), This Week, and This Month. The selected preset determines the `startTimestamp` passed to `tradeService.searchTrades()`. Preset is persisted to localStorage. Results are cached in memory per `accountId:preset` key. Each option displays a closing-trade count in parentheses (e.g. "Today (7)"). Counts are fetched in parallel for all three presets on mount and refresh when trades change. The selected preset's count also appears on the trigger button. The dropdown animates open/close with a fade + slide transition (150ms ease).
- **Decoupled from RPNL**: Display trades are stored in the global store (`displayTrades`) separately from `sessionTrades`. Session trades (for TopBar RPNL) are fetched in `App.tsx` on connect and refreshed via SignalR — runs regardless of which bottom panel tab is active. `displayTrades` is in the store (not local state) so the chart can access them for trade zone rendering.
- Fetches filtered display trades on mount and whenever account or preset changes via `tradeService.searchTrades(accountId, startTimestamp, endTimestamp?)`.
- Re-fetches display trades on SignalR trade events (debounced 500ms). Cache is invalidated on new trade events.
- Time column shows `MM/DD HH:MM` format for week/month presets, `HH:MM:SS` for session/today.
- Columns: Time, Side, Symbol, Qty, Entry, Exit, Duration, P&L, Fees, Comm., Net.
- All columns are center-aligned. Data grid is constrained to 70% width while row backgrounds (stripes, hover, selection) extend full width.
- **Sortable columns**: Click any column header to sort by that column (descending by default). Click the same column again to toggle between ascending and descending. Active sort column is highlighted in white with a ▲/▼ indicator. Default sort: Time descending (most recent first).
- **Partial-exit grouping**: Closing trades that share the same entry (via `buildEntryMap()` FIFO matching) are grouped into a single parent row. Single-exit trades render as normal rows with no grouping UI. Multi-exit groups show:
  - **Parent row**: entry time, total qty, entry price, `N exits ▸/▾` toggle, total duration (entry → last exit), summed P&L / Fees / Comm. / Net.
  - **Sub-rows** (when expanded): indented, dimmer text, showing each exit's time, qty, exit price, individual duration (entry → that exit), individual P&L / Fees / Comm. / Net. Side, Symbol, and Entry columns are left blank (inherited from parent).
  - Expand/collapse is local UI state (`useState<Set<number>>`), toggled by clicking the "N exits" cell.
- **Duration column**: Shows elapsed time from entry to exit, formatted as `Xs`, `Xm Ys`, or `Xh Ym Zs`.
- **Click-to-show-on-chart**: Clicking a single-exit row toggles `toggleTradeVisibility(tradeId)`. Clicking a multi-exit parent row toggles all exit IDs at once via `toggleTradeVisibilityBulk(tradeIds)`. Clicking an individual sub-row toggles just that exit. Selected rows get a warm amber highlight: `bg-(--color-warning)/10` background tint with a `border border-(--color-warning)/60` outline. Non-selected rows have `border border-transparent` to preserve layout. Visible trade IDs are consumed by `CandlestickChart.tsx` to render trade zone overlays on the chart via `TradeZonePrimitive`.
- **Hide drawings**: When any trades are visible on the chart (`visibleTradeIds.length > 0`), a "Hide drawings" button appears in the header bar to the left of the date preset selector. It is absolutely positioned (`position: absolute; right: 120`) so it doesn't shift the filter layout when it appears/disappears. Clicking it calls `clearVisibleTradeIds()` to dismiss all trade zone overlays at once. The button disappears when no trades are highlighted.
- Entry prices resolved via `buildEntryMap()` from `TradeZonePrimitive.ts` (FIFO matching with size-aware claiming — a single entry trade can match multiple partial exits).
- Opening half-turns (`profitAndLoss === null`) and voided trades are filtered out.
- Trades displayed in reverse chronological order (most recent first) by default.

## Chart Trade Markers

When a trade ID is in `visibleTradeIds`, `useChartWidgets` renders trade zone overlays via `TradeZonePrimitive`:

- `useChartWidgets` merges `sessionTrades` + `displayTrades` (deduplicated by ID) before calling `matchTrades()`. This ensures clicks from the Trades tab work regardless of which date preset is active — `displayTrades` may contain trades outside the current CME session.
- `matchTrades()` finds exit trades by ID, then resolves their entry counterpart via `buildEntryMap()` (FIFO). Each matched pair produces a `TradeZone` rendered as an entry/exit rectangle.
- Profitable zones are green, losing zones are red.
- When `chartSettings.extendTradeZoneRight` is enabled (via Settings → Trading tab), the trade zone rectangle extends to the right edge of the chart instead of stopping at the exit candle.
- The subscription reacts to changes in `visibleTradeIds`, `sessionTrades`, `displayTrades`, and `chartSettings.extendTradeZoneRight`.

## Shared Utility

`frontend/src/utils/cmeSession.ts` exports:
- `getCmeSessionStart()` — UTC ISO timestamp for the current CME session start (6 PM New York time). Used by `App.tsx` for session trade fetching (RPNL).
- `DatePreset` type — `'today' | 'week' | 'month'`.
- `DATE_PRESET_LABELS` — display labels for each preset.
- `getDateRange(preset)` — returns `{ startTimestamp, endTimestamp? }` for the given preset. Used by `TradesTab` and `DatePresetSelector`. The "week" preset uses the **futures trading week** boundary: Sunday 6 PM New York time (when CME futures reopen). If the current time is Sunday before 6 PM, it rolls back to the previous Sunday 6 PM.

## Conditions Tab

- Subscribes to `GET /conditions/events` (SSE) for real-time condition status updates.
- Displays conditions with columns: Status, Condition Type, Trigger Price, Timeframe, Order, Symbol, Bracket, Actions.
- Status badge shows Armed (green), Paused (yellow), Triggered (blue), Failed (red), Expired (gray).
- Actions: Pause/Resume toggle, Delete button.
- Preview checkbox: toggles condition preview lines on the chart.
- Count badge in tab bar shows number of `armed` conditions.
- ConditionsTab stays mounted (hidden) when other tabs are active to keep the SSE connection alive.

---

## Styling

Consistent with the app's dark theme:

- Panel/header background: `bg-black`
- Borders: `border-(--color-border)`
- Tab text: `text-(--color-text-muted)` (inactive), `text-(--color-text)` (active) with blue underline
- Buy: `text-(--color-buy)`, Sell: `text-(--color-sell)`
- Row hover: `TABLE_ROW_HOVER` from `constants/styles.ts` (`hover:bg-(--color-hover-row)/50 transition-colors`)
- Alternating stripes: `TABLE_ROW_STRIPE` from `constants/styles.ts` (`bg-(--color-table-stripe)/40`)
- Tabular numbers: `fontFeatureSettings: '"tnum"'`
