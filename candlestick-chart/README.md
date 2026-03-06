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
- **Background**: `bg-black`, border bottom `border-[#2a2e39]`, padded `px-4` with `7px` vertical padding
- **Left section**: Instrument selector | divider | pinned timeframe buttons | timeframe dropdown
  - Active timeframe: `text-[#f0a830]` (amber-gold), inactive: `text-[#787b86]`
  - Text-only style (no background boxes), `text-xs font-medium`
- **Right section** (after flex spacer): layout toggle | divider | camera (screenshot) | divider | NY clock
  - Dual chart toggle: stroke-only SVG icon in `#787b86` — single rectangle (single mode), rectangle with vertical divider line (dual mode)
  - Camera icon: opens dropdown with "Copy chart image" and "Custom snapshot" options
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
1. VolumeProfilePrimitive (volume profile bars)
2. TradeZonePrimitive (entry/exit trade rectangles)
3. CountdownPrimitive (current price + bar countdown)
4. DrawingsPrimitive (drawing price labels, selected overrides current)

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
| Load bars | GET /market/bars | POST /api/History/retrieveBars |
| Real-time quote | SignalR market feed | /hubs/market → GotQuote |

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
- Maximum bars per request: 20,000 (API limit); paginate if needed for longer
  history
- **Whitespace padding**: After loading historical bars, 100 future
  whitespace data points (`{ time }` only, no OHLC) are added to a separate
  invisible `LineSeries`. This extends the time scale so the crosshair time
  label remains visible when hovering past the latest candle. The whitespace
  lives on its own series (not the candlestick series) so that real-time
  `series.update()` calls are unaffected.
- **Dual-chart crosshair sync** uses a `master` variable (`'left' | 'right' | null`)
  in `ChartArea.tsx`. The chart the mouse is on becomes master; crosshair-move
  events from the other chart are ignored entirely, preventing async bounce-back
  loops. When the source time exceeds the target chart's visible range
  (`timeScale().getVisibleRange()`), the time is clamped to the nearest boundary
  so the horizontal price crosshair stays visible on both charts. Master resets
  to `null` when the mouse leaves a chart (16 ms clear timer). Does not gate on
  `dataMap` membership — syncs at any timestamp on the shared time scale,
  including whitespace regions beyond the last candle.
