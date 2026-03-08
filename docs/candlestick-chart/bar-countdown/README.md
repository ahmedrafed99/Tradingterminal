# Feature: Bar Close Countdown

Countdown timer displayed inside the current price label on the price scale, showing time remaining until the active candle closes.

**Status**: Implemented

---

## Overview

When the market is live (quotes flowing via SignalR), a countdown timer appears directly below the price text inside the white current-price label on the right price axis. The countdown ticks down every second until the current candle period ends, then resets for the next candle. When no live data is present (market closed, disconnected), only the price is shown — no countdown.

---

## UI

```
Price scale (right axis)
─────────────
  65,200.00     ← regular price tick

┌─────────────┐
│  65,497.10  │ ← current price (bold, white bg)
│    00:27    │ ← countdown to bar close
└─────────────┘

  65,000.00     ← regular price tick
─────────────
```

- **Label background**: `#ffffff` (white), full width of price axis
- **Price text**: bold, `12px`, color `#131722`, centred horizontally
- **Countdown text**: normal weight, `12px`, color `#131722`, centred below price
- **Font**: same as chart layout — `-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif`
- **Format**: `MM:SS` for periods < 1 hour, `H:MM:SS` for 1h+ periods
- **Visibility**: only shown for intraday timeframes (< 1D) and only when live quotes are active

---

## Files

| File | Role |
|------|------|
| `frontend/src/components/chart/CountdownPrimitive.ts` | `ISeriesPrimitive` with HTML overlay label (z-index:25) |
| `frontend/src/components/chart/chartTheme.ts` | Added `lastValueVisible: false` to candlestick series options |
| `frontend/src/components/chart/CandlestickChart.tsx` | Attaches primitive, feeds price/config from bars + quotes |

---

## Implementation

### Architecture

The countdown replaces Lightweight Charts' built-in last-value label with a custom `ISeriesPrimitive` that renders as an HTML overlay element (z-index:25). This ensures the moving price label stacks above static order/position axis labels (z-index:20) when they overlap, while still appearing below the crosshair label (z-index:30).

```
CountdownPrimitive (ISeriesPrimitive)
  ├── setOverlay(overlay, chart) → creates HTML <div> in overlay (z-index:25)
  │     Contains price text <div> (bold) + countdown text <div>
  ├── priceAxisPaneViews()  → returns empty, but triggers _syncHtml() on each LWC render
  │     Positions the HTML element via series.priceToCoordinate(price)
  ├── priceAxisViews()      → PriceLabelAxisView (invisible)
  │     Hints LWC about label position for overlap avoidance
  └── 1-second setInterval  → recalculates countdown, calls _syncHtml() + requestUpdate()
```

### CountdownPrimitive public API

```ts
// Provide overlay div + chart API for HTML rendering (called once at chart init)
setOverlay(overlay: HTMLDivElement, chart: IChartApi): void

// Called after loading historical bars (no countdown yet)
updatePrice(price: number, live: false): void

// Called on each SignalR quote (activates countdown)
updatePrice(price: number, live: true): void

// Set candle period in seconds (on timeframe change)
setPeriod(periodSec: number): void

// Set decimal places for price formatting (on contract change)
setDecimals(decimals: number): void

// Mark feed as disconnected (hides countdown, keeps price)
setLive(false): void
```

### Countdown calculation

```ts
const nowSec = Date.now() / 1000;
const nextCandle = Math.ceil(nowSec / periodSec) * periodSec;
const remaining = Math.max(0, Math.ceil(nextCandle - nowSec));
```

Uses the same epoch-based candle flooring as `floorToCandlePeriod()` in `barUtils.ts`. Hidden for daily and higher timeframes where candle boundaries are session-based rather than epoch-based.

### Rendering

The label is an HTML `<div>` positioned absolutely at `right:0` in the chart overlay, matching the price scale width. Position is synced via `_syncHtml()` which is called:
- On every LWC render cycle (scroll/zoom/resize) via `priceAxisPaneViews()`
- On every price update via `updatePrice()`
- On every timer tick (1-second interval)

The Y coordinate comes from `series.priceToCoordinate(price)`. The element uses `transform: translateY(-50%)` for vertical centering.

### Wiring in CandlestickChart.tsx

1. **Chart init**: creates `CountdownPrimitive`, attaches to candlestick series via `series.attachPrimitive()`, then calls `countdown.setOverlay(overlay, chart)` to enable HTML rendering
2. **Bars loaded**: calls `setDecimals()`, `setPeriod()`, `updatePrice(lastBar.close, false)`
3. **Quote received**: calls `updatePrice(price, true)` — starts the countdown
4. **Quote cleanup**: calls `setLive(false)` — hides countdown on unmount/reconnect
5. **Timer**: 1-second `setInterval` started in `attached()`, cleared in `detached()`
