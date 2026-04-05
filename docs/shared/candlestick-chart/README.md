# Feature: Candlestick Chart

The main chart surface. Renders OHLCV candles from the ProjectX history API and streams real-time quote updates via SignalR.

> **See also**: [chart-trading/](../chart-trading/) (order lines, preview overlay, + button, drag-to-modify), [drawing-tools/](../drawing-tools/) (hline, oval, renderers, persistence), [chart-screenshot/](../chart-screenshot/) (capture + clipboard)

**Status**: Implemented

---

## Sub-Components

### `ChartContainer`
Wrapper that:
- Initialises Lightweight Charts `createChart()` with dark theme
- Passes `ref` to child components via context
- Handles resize observer to call `chart.resize()`

### `CandleSeries`
- Adds an `ISeriesApi<'Candlestick'>` to the chart
- Fetches historical bars via `/api/History/retrieveBars` on mount and
  whenever instrument or timeframe changes
- Subscribes to SignalR quotes to update the last (partial) bar in real time
- Unit mapping: `1m → unit=2, unitNumber=1`, `5m → unit=2, unitNumber=5`, etc.

### `ChartToolbar`
- Uses shared `ChevronDown` icon from `components/icons/ChevronDown.tsx` for dropdown indicators
- Uses `SECTION_LABEL` from `constants/styles.ts` for section headers
- **Background**: `bg-black`, border bottom `border-[#2a2e39]`, padded `px-4` with `7px` vertical padding
- **Left section**: Instrument selector | divider | pinned timeframe buttons | timeframe dropdown
  - Active timeframe: `text-[#f0a830]` (amber-gold), inactive: `text-[#787b86]`
  - Text-only style (no background boxes), `text-xs font-medium`
  - Dropdown lists all timeframes (`TIMEFRAMES` — 1m, 15m, 3m, 1h, 4h, D) with a star toggle to pin/unpin any of them
  - Pinned list is auto-sorted by duration (unit × 100 000 + unitNumber) on every pin action
- **Right section** (after flex spacer): layout toggle | divider | camera (screenshot) | divider | market status dot + NY clock
  - Dual chart toggle: stroke-only SVG icon in `#787b86` — single rectangle (single mode), rectangle with vertical divider line (dual mode)
  - Camera icon: opens dropdown with "Copy chart image" and "Custom snapshot" options
  - Market status dot: 6×6px circle rendered immediately left of the NY clock. Green `#26a69a` = open, red `#ef5350` = closed. Tooltip shows "Futures market open/closed". Re-evaluates every second via `useNYClock()`.
  - NY clock: right-aligned with `tabular-nums`

---

## Price Scale Labels

### Rendering Layers

The chart has two independent rendering layers for price scale labels:

1. **Canvas layer** (LWC primitives) — DrawingsPrimitive (drawing price labels). These render via `priceAxisPaneViews()` / `priceAxisViews()` on the LWC canvas.
2. **HTML layer** (overlay div) — `CountdownPrimitive` (current price + countdown), `PriceLevelLine` axis labels (order/position/preview prices), and `CrosshairLabelPrimitive` (crosshair price). These are `<div>` elements positioned absolutely in the chart overlay div that sits above the canvas.

HTML elements always render above canvas content. Within the HTML layer, z-index controls stacking:

| Element | z-index | Description |
|---------|---------|-------------|
| `PriceLevelLine._axisEl` | 20 | Order, position, preview price labels |
| `CountdownPrimitive._htmlEl` | 25 | Current price + countdown (overlays order labels when price moves) |
| `CrosshairLabelPrimitive._el` | 30 | Crosshair price label (always on top) |

### PriceLevelLine Axis Labels
- Each `PriceLevelLine` instance (order, position, preview line) creates an HTML `<div>` positioned at `right:0` over the price scale area.
- Styled to match LWC's native axis labels: bold 12px, same font family, colored background with auto-contrast text.
- Positioned via `series.priceToCoordinate(price)` in the `syncPosition()` hot path.
- `z-index:20` — visible above canvas primitives but below the price and crosshair labels.

### Drawing Price Scale Labels
- `DrawingsPrimitive` implements `priceAxisViews()` to show price labels on
  the right Y-axis for all horizontal lines (background = drawing color,
  text = auto-contrast black/white)
- `setDecimals()` is called when the contract changes to match tick precision
- **Selected drawing priority**: When a drawing is selected, its label switches
  to a custom-rendered `priceAxisPaneViews()` label that paints on top of other
  canvas content. Achieved by attaching DrawingsPrimitive after
  CountdownPrimitive (painter's algorithm).
- **Countdown avoidance**: `setCountdownPrice(price)` is fed from `useChartBars` on every quote tick. In `priceAxisViews()`, drawing labels within 25px of the countdown's Y coordinate are pushed away — above if the drawing was above, below if at or below. This creates a natural stacking effect: as the current price approaches an hline, its label rides above the countdown label, then flips below once the current price crosses above.
- **Note**: Drawing labels are canvas-rendered and will appear behind all HTML axis labels (PriceLevelLine, CountdownPrimitive, CrosshairLabelPrimitive) when they overlap. The countdown avoidance logic above prevents this for hline labels.

### Crosshair Price Label
- `CrosshairLabelPrimitive` is an HTML `<div>` in the chart overlay (not an LWC canvas primitive).
- Created in the chart init effect with `new CrosshairLabelPrimitive(overlay, series, chart)`. Destroyed in the cleanup.
- `z-index:30` ensures it always renders above all other axis labels.
- Subscribes to `chart.subscribeCrosshairMove()` — converts Y coordinate to
  price via `series.coordinateToPrice()` and calls `updateCrosshairPrice()`.
- Matches the native crosshair label style: `#2a2e39` background, `#d1d4dc` text, bold 12px.
- **Suppressed during hline drag**: `suppress(true)` hides the label and blocks `updateCrosshairPrice()` calls. The native LWC crosshair label (`horzLine.labelVisible`) is also disabled during drag. The HTML overlay updates instantly while the canvas drawing label lags one frame — suppressing both crosshair labels eliminates the flicker and prevents the native label from peeking through when de-overlap pushes the drawing label away from another drawing. Both restored on mouseup.
- **Dual-chart sync**: `subscribeCrosshairMove` does not reliably fire for programmatic `setCrosshairPosition()` calls. The `CandlestickChartHandle` exposes `setCrosshairPrice(price)` which directly calls `updateCrosshairPrice()`. `ChartArea` calls this alongside `setCrosshairPosition` during crosshair sync. The handle also exposes `setPeerSync(fn)` so `ChartArea` can inject a direct peer-sync callback; `useQuickOrder` calls `refs.peerSync.current?.()` during drag to bypass the async callback chain.
- **Overlay label transparency**: All overlay labels (order, position, preview)
  use `pointer-events: none` so mouse events pass through to the LWC canvas.
  The crosshair never disappears when hovering over any label element within
  the chart area. Interactions (click, drag) are detected via coordinate-based
  hit testing at the container level. See [chart-trading/](../chart-trading/)
  → Overlay Label System for details.
- **Quick-order hover persistence**: The quick-order (+) button is the one
  exception that keeps `pointer-events: auto` (z-30). When the mouse transitions
  from the canvas to the button, LWC fires a crosshair-leave event
  (`!param.point`). A 16ms delay + `qoHoveredRef` guard prevents the
  crosshair label from clearing.

### Canvas Primitive Attachment Order (z-order, bottom to top)
1. CountdownPrimitive (current price + bar countdown)
2. VolumeProfilePrimitive (volume profile bars)
3. NewsEventsPrimitive (economic calendar markers at bottom of chart)
4. TradeZonePrimitive (entry/exit trade rectangles)
5. DrawingsPrimitive (drawing price labels, selected overrides current)

### Cursor Management
- Custom white crosshair SVG cursor (stroke-width 2, `#ffffff`)
- `grab` cursor on drawing/handle hover, `grabbing` on drag/resize
- LWC `PrimitiveHoveredItem.cursorStyle` set to `undefined` to prevent internal cursor override
- Escape key cancels in-progress drag/resize, restoring original position

---

## State (Zustand)

```ts
interface ChartState {
  activeTF: '1m' | '5m' | '15m' | '1h' | '4h' | '1D'
  setActiveTF: (tf: Timeframe) => void
}
```

---

## API Calls

| Action | Proxy Route | ProjectX Endpoint |
|--------|------------|-------------------|
| Load bars | POST /market/bars | POST /api/History/retrieveBars |
| Real-time quote | SignalR market feed | /hubs/market → GotQuote |

### Contract Rollover Backfill

When loading historical bars, the backend fetches from the **current active
contract** first. If the returned bars don't reach back to the requested
`startTime` (common after a quarterly futures rollover), it automatically
fetches the gap from **previous contracts** by decrementing the quarterly
expiry code (e.g. `M26` → `H26` → `Z25`). Up to 2 previous contracts are
queried. The merged result is returned as a single `bars` array so the chart
always has a full lookback window regardless of when the last rollover occurred.

Quarterly month codes: **H** (Mar), **M** (Jun), **U** (Sep), **Z** (Dec).
Contract ID format: `CON.F.US.<PRODUCT>.<MONTH><YY>` (e.g. `CON.F.US.ENQ.M26`).

---

## Sub-Features

| Feature | Description |
|---------|-------------|
| [bar-countdown/](bar-countdown/) | Countdown timer in the current price label until candle close |
| [go-to-now/](go-to-now/) | Floating button to scroll back to the latest candle with smooth animation |
| [indicators/](indicators/) | Chart indicators |
| [ohlc-tooltip/](ohlc-tooltip/) | OHLC values tooltip on crosshair hover |
| [symbol-display/](symbol-display/) | Instrument name and timeframe label |

---

## Implementation Notes

- **Initial view**: On load, the chart shows the last ~100 bars (zoomed in
  near current price) with 10 bars of right padding, instead of fitting all
  historical data. After the visible range is set, `autoScale` is disabled on
  the right price scale so users can drag vertically immediately without first
  stretching the price axis.
- **Market-hours guard**: `handleQuote()` in `useChartBars` calls
  `getSchedule(contract?.marketType).isOpen()` (from `utils/marketHours.ts`)
  and silently drops incoming quotes when the market is closed. The schedule
  is determined by the contract's `marketType` — futures use CME hours
  (maintenance 17:00–18:00 ET Mon–Thu, weekend Fri 17:00 → Sun 18:00 ET),
  crypto markets are always open. **Holiday awareness**: holidays are fetched
  from FXStreet via a dedicated `GET /holidays` endpoint; early-close times
  (e.g. Good Friday 08:00 CT, most holidays 11:45 CT) are mapped from a
  hardcoded lookup by holiday name. `isFuturesMarketOpen()` returns false
  after the early-close cutoff or all day for full closures (New Year's,
  Christmas). The check converts the current time to `America/New_York` via
  `toLocaleString()` so it automatically handles EST ↔ EDT transitions —
  **do not use hardcoded UTC offsets** for this check. The same utility is
  used for client-side order validation across all placement paths
  (BuySellButtons, quick order, preview execute button). **Important**: the
  `/holidays` route must be present in `frontend/vite.config.ts`'s proxy
  table — if missing, the fetch silently fails and holiday info never
  populates, causing the badge to show normal hours even on early-close days.
- Maximum bars per request: 20,000 (API limit); paginate if needed for longer
  history
- **Whitespace padding + right offset**: After loading historical bars, 500
  future whitespace data points (`{ time }` only, no OHLC) are added to a
  separate invisible `LineSeries`. This extends the time scale so the
  crosshair time label remains visible when hovering past the latest candle.
  The whitespace lives on its own series (not the candlestick series) so that
  real-time `series.update()` calls are unaffected. Additionally,
  `timeScale.rightOffset: 15` reserves a small buffer of scrollable empty
  space beyond the last whitespace point, and `shiftVisibleRangeOnNewBar`
  keeps the view auto-scrolling as new candles arrive.
- **Dual-chart crosshair sync** uses a `master` variable (`'left' | 'right' | null`)
  in `ChartArea.tsx`. The chart the mouse is on becomes master; crosshair-move
  events from the other chart are ignored entirely, preventing async bounce-back
  loops. When the source time exceeds the target chart's visible range
  (`timeScale().getVisibleRange()`), the time is clamped to the nearest boundary
  so the horizontal price crosshair stays visible on both charts. Master resets
  to `null` when the mouse leaves a chart (16 ms clear timer). Does not gate on
  `dataMap` membership — syncs at any timestamp on the shared time scale,
  including whitespace regions beyond the last candle.
- **VP hover RAF-batched**: The volume profile crosshair-move handler in
  `useChartBars` RAF-batches `coordinateToPrice` calls so at most one runs per
  frame. The RAF ID is tracked and cancelled in the effect cleanup to prevent
  fire-after-dispose on unmount.
- **VP hover same-bar skip**: `VolumeProfilePrimitive.setHoverPrice()` skips
  `_requestUpdate()` when the new price maps to the same bar as the previous
  hover (within half a tick). This avoids rebuilding the entire bar array and
  repainting all VP rows on every crosshair move.
- **Overlay label selector consolidation**: `useOverlayLabels` uses a single
  `useShallow()` selector (from `zustand/react/shallow`) instead of 16
  individual `useStore()` calls. This reduces store subscriptions from 16 to 1
  and batches the shallow-equality check into a single comparison per update.
- **Drawing mousemove RAF-throttled**: The main `onMouseMove` handler in
  `useChartDrawings` is wrapped in `requestAnimationFrame` so it fires at most
  once per frame (~60 Hz), preventing 100+ Hz mousemove storms from triggering
  redundant store updates and canvas repaints during drawing previews.
- **News events mousemove RAF-throttled**: The `useNewsEvents` mousemove handler
  defers `getBoundingClientRect` + hit testing to a RAF callback.
- **OHLC tooltip pre-created DOM**: The crosshair OHLC widget in `useChartWidgets`
  pre-creates span elements once and updates `.textContent` per frame, instead of
  rebuilding the DOM via `innerHTML` on every crosshair move. Uses a cached
  `Intl.NumberFormat` instance instead of per-call `toLocaleString`. Skips
  `render()` entirely when O/H/L/C values are unchanged (same candle), and only
  writes `.style.color` when bullish/bearish direction changes.
- **Quick-order cached psWidth**: `useQuickOrder`'s crosshair move handler caches
  `priceScale('right').width()` via `ResizeObserver` instead of reading it on
  every move (eliminates a layout reflow per crosshair event).
- **Hover hit-testing optimized**: `onHandleHover` in `drawingInputHandlers`
  moves `getBoundingClientRect` inside the RAF callback (not before the guard),
  skips drawing hit-tests when not in select mode, and uses
  `document.elementFromPoint` instead of looping `getBoundingClientRect` on
  every overlay target.
- **Overlay sync coalescing**: `useOverlayLabels` and `useConditionLinesSync`
  funnel all sync triggers (scroll, drag mousemove, lastPrice tick, resize,
  wheel) through a single `scheduleSync()` per hook with one RAF flag. This
  prevents multiple `syncPosition()` passes per frame when chart drag and
  SignalR price ticks coincide.
- **Condition lines: no idle RAF loop**: `useConditionLinesSync` no longer runs
  a continuous `requestAnimationFrame` loop during pointer drag. Instead, it
  attaches a mousemove listener that routes through `scheduleSync()`.
- **ChartRefs bag memoized**: The `refs` object passed to all chart hooks is
  wrapped in `useMemo(() => ({...}), [])`. Every value in the bag is a
  `useRef` result (stable across renders). Without memoization, `refs` was a
  new object reference on every render, causing effects that list it as a
  dependency (e.g. `useConditionPreview`, `useConditionLinesSync`) to re-run
  and destroy/recreate state — most visibly, condition preview lines snapping
  back to their default positions during drag.
- **Session-only mode (gap collapse)**: Always-on behavior (no UI toggle) that hides market-closed periods (CME overnight 17:00–18:00 ET, weekends, holidays) so every candle renders directly adjacent to the previous one — no blank whitespace. Enabled by default via `sessionMode: true` / `secondSessionMode: true` in `layoutSlice`. Implementation:
  - `sessionBarMapper.ts` is the pure compression engine. `buildSessionBarMap(candles, periodSec)` assigns each bar a sequential fake `UTCTimestamp` starting at `BASE_EPOCH = 1_000_000`, spaced exactly `periodSec` apart. The real timestamp ↔ fake timestamp relationship is stored in two `Map<number,number>` objects (`compressedToReal`, `realToCompressed`). `getOrAssignCompressedTime(realSec, map)` looks up or assigns the next available fake timestamp for real-time new bars. `generateSessionWhitespace(map, count)` extends the sequence for future whitespace padding.
  - `CandlestickChart` creates the chart with per-chart formatter closures that decode fake→real via `sessionMapRef.current?.compressedToReal.get(t)`, so the time axis tick labels and crosshair label always display the real ET time. Each chart instance (dual-chart) has its own `sessionMapRef`, so left and right charts are fully independent.
  - `useChartBars` reads `sessionMode` / `secondSessionMode` from the store. When enabled: replaces the standard `candles` array with `map.compressedBars` for `series.setData()`; replaces the standard `generateWhitespace` call with `generateSessionWhitespace`; translates real candle times to compressed times in `handleQuote` before calling `series.update()`; and translates during the visibility-change backfill patch. `sessionMode` is in the historical load `useEffect` dep array, so toggling triggers a full reload.
  - Drawings are stamped with `sessionMode: boolean` at creation time and filtered in `useChartDrawings` — drawings made in one mode are hidden in the other to prevent broken time coordinates from rendering at wrong positions.
  - State: `sessionMode` / `secondSessionMode` in `layoutSlice`, persisted via `partialize`. Ref `sessionModeActive` mirrors the store value for use inside RAF/event handlers without needing a new subscription.
- **Background-tab candle backfill**: When the browser tab is backgrounded,
  `requestAnimationFrame` is throttled (≤1 fps) or paused entirely.
  `handleQuote()` now synchronously flushes the previous `pendingBar` to the
  series whenever a new candle period is detected, preventing the old candle's
  final state from being silently overwritten. Additionally, a
  `visibilitychange` listener fires when the tab regains focus: it flushes any
  pending bar, then fetches bars from `lastBar.time → now` via
  `retrieveBars()` and patches them in with `series.update()` — no full reload,
  no loading spinner, no chart reset.
- **CountdownPrimitive per-frame psWidth cache**: `_syncHtml()` caches
  `priceScale('right').width()` for ~1ms (same approach as `PriceLevelLine`).
  `updatePrice()` skips reformat + repaint when the price value hasn't changed.
  `_formatPrice()` uses a cached `Intl.NumberFormat` instance.
