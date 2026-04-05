# Issue: Crosshair Drifts During Chart Pan

**Status:** Investigated — fix plan ready, not yet implemented  
**Reported:** 2026-04-05  
**Affects:** Single-chart and dual-chart mode

---

## Symptom

When the user clicks on the chart (crosshair appears) and then drags to pan the viewport, the crosshair visibly drifts from the original position. Confirmed example: mouse was at price **21,141.00** → after pan, crosshair showed **21,139.50** (−1.5 pts / 6 ticks).

The same artifact exists in the TradingView desktop app, which initially suggested a fundamental library limitation. However, investigation revealed it is a fixable bug in how lightweight-charts recalculates crosshair position after a pan.

---

## Root Cause

### Primary: Price scale auto-adjustment invalidates the saved screen coordinate

**Library location:** `lightweight-charts.development.mjs`, function `_internal_updateCrosshair` (~line 6954)

```javascript
_internal_updateCrosshair() {
    const x = this._private__crosshair._internal_originCoordX();  // saved screen pixel X
    const y = this._private__crosshair._internal_originCoordY();  // saved screen pixel Y
    this._internal_setAndSaveCurrentPosition(x, y, null, pane);   // re-derives price from Y
}
```

The crosshair internally stores the mouse position as **raw screen pixel coordinates** (`originCoordX`, `originCoordY`). Every time the chart recalculates — which happens on every pan step — `_internal_updateCrosshair` is called. It converts the saved screen Y back to a price using the **current price scale**.

The issue: the chart's price scale uses `autoScale: true` by default. When a horizontal pan brings new candles into view, the price scale adjusts its range to fit the newly visible bars. This changes the price-per-pixel mapping. The same Y=300 pixel that was worth 21,141.00 before the pan is now worth 21,139.50 — the crosshair drifts, even though the mouse never moved vertically.

### Secondary: Asymmetric bar snapping on the time axis

**Library location:** `lightweight-charts.development.mjs`, function `_internal_coordinateToIndex` (~line 6040)

```javascript
_internal_coordinateToIndex(x) {
    const index = Math.ceil(this._private__coordinateToFloatIndex(x));  // asymmetric rounding
    ...
}
```

`Math.ceil` maps any float in the range `(N-1, N]` to bar N. This means the crosshair snaps to bar N as soon as you move past bar N−1's center — the snap boundary is the bar's left edge, not its midpoint. With `Math.round`, the boundary would be at the midpoint between two bars, which is semantically correct. `Math.ceil` can cause a 1-bar jump on the time axis label during a small pan.

---

## Fix Plan

### Part 1 — Re-pin crosshair during drag (user-code, no library changes required)

The public API `chart.setCrosshairPosition(price, time, series)` internally calls `setAndSaveSyntheticPosition`, which:
1. Converts the price and time back into screen coordinates using the **current** scale.
2. Saves those as the new origin coordinates.
3. Calls `setAndSaveCurrentPosition(..., skipEvent=true)` — **does not fire `subscribeCrosshairMove`**, so no infinite loop.

By calling `chart.setCrosshairPosition(pinnedPrice, pinnedTime, series)` inside the `subscribeCrosshairMove` handler during a drag, we override the library's drifted position with the original data coordinate on every recalculation cycle. The origin coordinates are also updated to the correct screen position for the pinned price, so subsequent `_internal_updateCrosshair` calls remain stable.

#### New refs (add to `ChartRefs` in `hooks/types.ts`)

```typescript
isDragging:   React.RefObject<boolean>;
pinnedPrice:  React.RefObject<number | null>;
pinnedTime:   React.RefObject<unknown>;
```

#### In `CandlestickChart.tsx` — chart init `useEffect`

Declare the three refs and attach event listeners to track drag state:

```typescript
const onMouseDown = () => { isDraggingRef.current = false; pinnedPriceRef.current = null; };
const onMouseMove = (e: MouseEvent) => { if (e.buttons === 1) isDraggingRef.current = true; };
const onMouseUp   = () => { isDraggingRef.current = false; pinnedPriceRef.current = null; pinnedTimeRef.current = null; };

el.addEventListener('mousedown', onMouseDown);
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup',   onMouseUp);
// Remove all three in effect cleanup
```

`isDragging` starts `false` on mousedown and becomes `true` only after the first mousemove with the button held — this avoids treating a plain click as a drag.

#### In `useChartWidgets.ts` — `subscribeCrosshairMove` handler

At the top of the existing `onMove` callback:

```typescript
if (refs.isDragging.current && refs.pinnedPrice.current !== null && refs.pinnedTime.current !== null) {
    // Re-pin: prevents price-scale drift from shifting the displayed price
    chart.setCrosshairPosition(refs.pinnedPrice.current, refs.pinnedTime.current as UTCTimestamp, series);
    refs.crosshairLabel.current?.updateCrosshairPrice(refs.pinnedPrice.current);
    // Also sync peer chart in dual-chart mode (skipEvent=true means peerSync won't fire automatically)
    refs.peerSync.current?.(refs.pinnedPrice.current, refs.pinnedTime.current);
    return;
}

// Normal hover: save current position so it's ready to pin when drag starts
if (param.time && param.point) {
    const price = series.coordinateToPrice(param.point.y);
    if (price !== null) { refs.pinnedPrice.current = price; refs.pinnedTime.current = param.time; }
}
// ... existing OHLC tooltip logic continues unchanged
```

### Part 2 — `Math.ceil` → `Math.round` (optional library patch)

For the secondary time-axis bar snapping issue, patch line ~6040 in both dist files and persist via `patch-package`:

```
cd frontend
npm install --save-dev patch-package
# edit node_modules/lightweight-charts/dist/lightweight-charts.development.mjs ~line 6040
# edit node_modules/lightweight-charts/dist/lightweight-charts.production.mjs (same function)
npx patch-package lightweight-charts
# add "postinstall": "patch-package" to frontend/package.json scripts
```

Change: `Math.ceil(this._private__coordinateToFloatIndex(x))` → `Math.round(...)`

This is lower priority. The Part 1 re-pin fix already prevents the bar from changing during a drag (since we restore the pinned time on every frame). The `Math.round` change only matters for hover behavior between bars, not for drag.

---

## Files to Change (Part 1)

| File | Change |
|------|--------|
| `frontend/src/components/chart/hooks/types.ts` | Add `isDragging`, `pinnedPrice`, `pinnedTime` to `ChartRefs` interface |
| `frontend/src/components/chart/CandlestickChart.tsx` | Declare 3 refs; add to `refs` bag; attach/remove 3 event listeners in chart init effect |
| `frontend/src/components/chart/hooks/useChartWidgets.ts` | Re-pin logic at top of `subscribeCrosshairMove` handler; save price/time on normal hover |

---

## Expected Outcome

- Crosshair price label stays pinned at the clicked price (e.g., 21,141.00) for the entire duration of the drag.
- Crosshair time label stays on the clicked bar — no bar jumping.
- Dual-chart peer crosshair remains stable during pan (via existing `peerSync` ref).
- On mouse release, crosshair resumes normal hover tracking immediately.
- No impact on QO drag, drawing drag, order line drag — those override the crosshair independently and are unaffected by this change.
