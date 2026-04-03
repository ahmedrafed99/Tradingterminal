# Feature: OHLC Tooltip

Live OHLC + change tooltip displayed inline next to the symbol label, updated on crosshair hover.

**Status**: Implemented

---

## Overview

The tooltip shows Open, High, Low, Close values and the candle's change (`close − open`) at the top-left of the chart. By default it reflects the **last (most recent) candle**. When the crosshair hovers over a candle, the tooltip updates to show that candle's values. Values are color-coded to match the candle direction.

---

## UI

```
NQ · 1m   ●   O24,886.75 H24,886.75 L24,881.00 C24,883.25 -3.50
          ↑
   MarketStatusBadge (clickable dot with session tooltip)
```

- **Labels** (`O`, `H`, `L`, `C`): color `#787b86` (muted gray, same as symbol display)
- **Values**: match the candle color — bullish (close ≥ open) `#9598a1`, bearish (close < open) `#0097a6`
- **Change**: `close − open`, prefixed with `+`/`-`, same candle color
- **Background**: `#00000080` (semi-transparent black), `borderRadius: 2px`, `padding: 1px 3px`
- **Font**: `-apple-system, BlinkMacSystemFont, sans-serif`, `text-xs font-medium`
- **Number format**: `toLocaleString('en-US')` with decimal places derived from `contract.tickSize`
- **Overflow**: Parent container capped at `max-width: calc(100% - 90px)` to reserve space for the price scale. Instrument label is `shrink-0`; OHLC values div uses `overflow-hidden whitespace-nowrap min-w-0` so it clips cleanly when the chart is narrow (e.g. resized in dual-chart mode).

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/components/chart/CandlestickChart.tsx` | Added `ohlcRef`, crosshair move subscription effect, tooltip div in JSX |
| `frontend/src/components/chart/MarketStatusBadge.tsx` | Clickable market status dot between instrument label and OHLC values. Holiday-aware: shows holiday name + early-close time (e.g. "Good Friday — closes 08:00 CT") when market is open on a holiday, or "Closed early for {name}" after cutoff |

---

## Implementation

### DOM ref approach (no React re-renders)

The tooltip is a `div` with `ref={ohlcRef}`. A `useEffect` subscribes to `chart.subscribeCrosshairMove()` and updates `el.innerHTML` directly — this avoids React state updates on every mouse move.

### Decimal precision

Derived from the contract's tick size:

```ts
const decimals = Math.max(0, Math.round(-Math.log10(contract.tickSize)));
const fmt = (v: number) => v.toLocaleString('en-US', {
  minimumFractionDigits: decimals,
  maximumFractionDigits: decimals,
});
```

### Crosshair move handler

```ts
const onMove = (param) => {
  if (param.time && param.seriesData) {
    const d = param.seriesData.get(series); // OHLC of hovered candle
    if (d) { render(d.open, d.high, d.low, d.close); return; }
  }
  // Fallback: show last bar
  const lb = lastBarRef.current;
  if (lb) render(lb.open, lb.high, lb.low, lb.close);
};
```

- **Hovered candle**: `param.seriesData.get(series)` returns the OHLC data at the crosshair's time
- **Default**: falls back to `lastBarRef.current` (updated by both historical load and real-time quotes)
- **Effect dependencies**: `[contract, timeframe]` — re-subscribes when instrument or timeframe changes

### Render function

```ts
function render(o: number, h: number, l: number, c: number) {
  const bullish = c >= o;
  const valColor = bullish ? '#9598a1' : '#0097a6';
  const change = c - o;
  const sign = change >= 0 ? '+' : '';
  el.innerHTML =
    `<span style="color:#787b86">O</span><span style="color:${valColor}">${fmt(o)}</span> ` +
    `<span style="color:#787b86">H</span><span style="color:${valColor}">${fmt(h)}</span> ` +
    `<span style="color:#787b86">L</span><span style="color:${valColor}">${fmt(l)}</span> ` +
    `<span style="color:#787b86">C</span><span style="color:${valColor}">${fmt(c)}</span> ` +
    `<span style="color:${valColor}">${sign}${fmt(change)}</span>`;
}
```
