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

## Price Scale Primitives

### Drawing Price Scale Labels
- `DrawingsPrimitive` implements `priceAxisViews()` to show price labels on
  the right Y-axis for all horizontal lines (background = drawing color,
  text = auto-contrast black/white)
- `setDecimals()` is called when the contract changes to match tick precision
- **Selected drawing priority**: When a drawing is selected, its label switches
  to a custom-rendered `priceAxisPaneViews()` label that paints on top of the
  current-price label (CountdownPrimitive). Achieved by attaching
  DrawingsPrimitive after CountdownPrimitive (painter's algorithm).

### Crosshair Price Label
- `CrosshairLabelPrimitive` renders a custom price label on the price scale
  that always stays on top of all other labels (current price, drawing labels).
- Attached LAST to the series (after CountdownPrimitive and DrawingsPrimitive)
  so its `priceAxisPaneViews()` canvas rendering paints over everything.
- Subscribes to `chart.subscribeCrosshairMove()` — converts Y coordinate to
  price via `series.coordinateToPrice()` and feeds to the primitive.
- Matches the native crosshair label style: `#2a2e39` background, `#d1d4dc` text.
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

### Primitive Attachment Order (z-order, bottom to top)
1. CountdownPrimitive (current price + bar countdown)
2. DrawingsPrimitive (drawing price labels, selected overrides current)
3. CrosshairLabelPrimitive (crosshair always on top of everything)

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

- Maximum bars per request: 20,000 (API limit); paginate if needed for longer
  history
- **Whitespace padding**: After loading historical bars, 100 future
  whitespace data points (`{ time }` only, no OHLC) are added to a separate
  invisible `LineSeries`. This extends the time scale so the crosshair time
  label remains visible when hovering past the latest candle. The whitespace
  lives on its own series (not the candlestick series) so that real-time
  `series.update()` calls are unaffected.
- **Dual-chart crosshair sync** does not gate on `dataMap` membership — it
  syncs at any timestamp present on the shared time scale, including
  whitespace regions beyond the last candle.
