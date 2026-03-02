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
| `frontend/src/components/chart/CountdownPrimitive.ts` | New — `ISeriesPrimitive` with custom price axis pane renderer |
| `frontend/src/components/chart/chartTheme.ts` | Added `lastValueVisible: false` to candlestick series options |
| `frontend/src/components/chart/CandlestickChart.tsx` | Attaches primitive, feeds price/config from bars + quotes |

---

## Implementation

### Architecture

The countdown replaces Lightweight Charts' built-in last-value label with a custom `ISeriesPrimitive` that implements `priceAxisPaneViews()` for full canvas rendering control on the price axis.

```
CountdownPrimitive (ISeriesPrimitive)
  ├── priceAxisPaneViews()  → CountdownPaneView → CountdownRenderer
  │     Draws white rect + price text + countdown text on price axis canvas
  ├── priceAxisViews()      → PriceLabelAxisView (invisible)
  │     Hints LWC about label position for overlap avoidance
  └── 1-second setInterval  → recalculates countdown, calls requestUpdate()
```

### CountdownPrimitive public API

```ts
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

### Renderer

Uses `useMediaCoordinateSpace` (CSS pixels) to match LWC's native price axis label rendering exactly. The Y coordinate comes from `series.priceToCoordinate(price)` which is valid in both the main pane and price axis pane coordinate systems.

### Wiring in CandlestickChart.tsx

1. **Chart init**: creates `CountdownPrimitive`, attaches to candlestick series via `series.attachPrimitive()`
2. **Bars loaded**: calls `setDecimals()`, `setPeriod()`, `updatePrice(lastBar.close, false)`
3. **Quote received**: calls `updatePrice(price, true)` — starts the countdown
4. **Quote cleanup**: calls `setLive(false)` — hides countdown on unmount/reconnect
5. **Timer**: 1-second `setInterval` started in `attached()`, cleared in `detached()`
