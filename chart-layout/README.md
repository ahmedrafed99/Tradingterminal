# Feature: Dual Chart Layout

Side-by-side chart layout with independent instruments, timeframes, draggable separator, crosshair sync, and selection-aware toolbar routing. Default second chart is MNQ.

**Status**: Implemented

---

## Overview

Toggling "dual chart" mode splits the chart area into two independent candlestick charts separated by a draggable divider. Each chart has its own instrument and timeframe. The toolbar (instrument selector + timeframe picker) routes to whichever chart is selected (blue border).

**Order panel** stays tied to its own instrument (`orderContract` in store) — independent of chart selection. The order panel's instrument only changes via its own `InstrumentSelector` (`fixed` prop).

---

## UI Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  [NQ ▼]  1m  5m  15m  1h  ▼        [□□] | [📷] | 12:34:56 New York │
├───────────────────────────────┬──┬───────────────────────────────────┤
│                               │  │                                   │
│    Left Chart (NQ)            │▐ │    Right Chart (MNQ)              │
│    ring-1 ring-[#2962ff]      │▐ │                                   │
│    (selected)                 │▐ │                                   │
│                               │  │                                   │
├───────────────────────────────┴──┴───────────────────────────────────┤
```

- **Selection border**: `ring-1 ring-[#2962ff] ring-inset` on the selected chart panel (only in dual mode)
- **Separator**: 4px vertical bar, draggable to resize (clamped 0.2–0.8)
- **Layout toggle**: stroke-only SVG icon (`#787b86`) in right section of toolbar — single rectangle (□) vs dual rectangles (□|□), separated from camera and clock by vertical dividers

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/store/useStore.ts` | Added `DualChartState` slice |
| `frontend/src/components/chart/CandlestickChart.tsx` | Refactored to accept `contract`/`timeframe`/`chartId` as props via `forwardRef`, exposed imperative handle |
| `frontend/src/components/chart/ChartArea.tsx` | **New** — layout container, separator, crosshair sync, MNQ auto-load, single `DrawingToolbar` |
| `frontend/src/components/chart/ChartToolbar.tsx` | Added layout toggle button, selection-aware timeframe routing |
| `frontend/src/components/InstrumentSelector.tsx` | Selection-aware contract routing (left/right chart) |
| `frontend/src/App.tsx` | Replaced inline chart with `<ChartArea />` |
| `frontend/src/components/chart/index.ts` | Added `ChartArea` export |

---

## Store — DualChartState slice

```ts
interface DualChartState {
  dualChart: boolean;            // default false, persisted
  secondContract: Contract | null; // default null, NOT persisted (IDs expire)
  secondTimeframe: Timeframe;    // default 1m, persisted
  selectedChart: 'left' | 'right'; // default 'left', not persisted
  splitRatio: number;            // default 0.5, persisted, clamped 0.2–0.8
  setDualChart: (enabled: boolean) => void;
  setSecondContract: (contract: Contract) => void;
  setSecondTimeframe: (timeframe: Timeframe) => void;
  setSelectedChart: (chart: 'left' | 'right') => void;
  setSplitRatio: (ratio: number) => void;
}
```

Persisted fields: `dualChart`, `secondTimeframe`, `splitRatio`.

---

## CandlestickChart — Props & Imperative Handle

```ts
interface CandlestickChartProps {
  chartId: 'left' | 'right';
  contract: Contract | null;
  timeframe: Timeframe;
}

interface CandlestickChartHandle {
  getChartApi: () => IChartApi | null;
  getSeriesApi: () => ISeriesApi<'Candlestick'> | null;
  getDataMap: () => Map<number, number>;  // UTCTimestamp → close price
  isQoHovered: () => boolean;             // true while quick-order (+) button is hovered
}
```

Key changes from prior single-chart design:
- Wrapped with `forwardRef<CandlestickChartHandle, CandlestickChartProps>` + `memo`
- Contract and timeframe come from props (not store)
- `dataMapRef` populated on `setData()` and each `series.update()` — used for crosshair sync
- `mousedown` listener on container calls `setSelectedChart(chartId)`
- Drawings filter uses `contract?.id` from props
- **`isOrderChart` guard**: order/position overlays and preview lines only render when `chartId === 'left'` (tied to order panel). Drawing tools render on both charts.
- **Drawing toolbar**: `DrawingToolbar` is rendered once in `ChartArea` (not per chart). `DrawingEditToolbar` is rendered per chart but scoped via `contractId` prop — only the chart owning the selected drawing shows the edit popover.

---

## ChartArea Component

Layout container (`ChartArea.tsx`) managing single/dual chart view:

- Uses `flex` layout with `style={{ flex: splitRatio }}` / `style={{ flex: 1 - splitRatio }}`
- **Right chart deferred mount**: delays right chart mount by one `requestAnimationFrame` so flex layout settles before `createChart()` fires (prevents overflow glitch on toggle)
- **MNQ auto-load**: when `dualChart` becomes true and `secondContract` is null, searches for active MNQ contract
- **Placeholder**: shows "Select an instrument" / "Loading MNQ..." text when contract is null

### Crosshair Sync

Both charts expose `getDataMap()` returning `Map<UTCTimestamp, closePrice>`.

Sync logic in a `useEffect`:
1. Subscribe to `subscribeCrosshairMove()` on both charts
2. When chart A fires at time T with pixel position `point.y`, verify chart B has data at T
3. Convert `point.y` to chart B's price via `seriesB.coordinateToPrice(point.y)`
4. Call `chartB.setCrosshairPosition(targetPrice, T, seriesB)` — horizontal line matches the mouse's vertical screen position
5. If no data at T → `chartB.clearCrosshairPosition()`
6. `!param.sourceEvent` guard prevents A→B→A feedback loop (programmatic `setCrosshairPosition` events are ignored)
7. Cleanup: `unsubscribeCrosshairMove` on both

**Quick-order hover persistence**: When the mouse transitions to the quick-order (+) button overlay, LWC fires a crosshair-leave event on the source chart. Instead of immediately calling `clearCrosshairPosition()` on the synced chart, the handler delays by 16ms (~1 frame) and checks `isQoHovered()` on the source chart's imperative handle. If the quick-order button is hovered by then, the clear is skipped so the synced chart's crosshair persists alongside the source chart's.

**Note**: The vertical crosshair line (time axis) snaps to candle positions on the synced chart — this is inherent to the `setCrosshairPosition` API and standard for synced charts. The horizontal line (price axis) matches the mouse's vertical position via `coordinateToPrice`.

### Draggable Separator

Internal `DraggableSeparator` component:
- `w-1` (4px) vertical bar between charts
- Colors: `bg-black` default, `hover:bg-[#434651]`, `bg-[#2962ff]` while dragging
- `cursor: col-resize`
- Tracks `dragging` state via `mousedown` → `window.mousemove` → `window.mouseup`
- Computes ratio = `(clientX - container.left) / container.width`, calls `setSplitRatio()` (clamped in store)
- Lightweight Charts `autoSize: true` handles chart resize automatically

---

## ChartToolbar — Selection-Aware Routing

**Timeframe routing**:
```ts
const timeframe = useStore((s) =>
  s.selectedChart === 'left' ? s.timeframe : s.secondTimeframe,
);
const setTimeframe = useStore((s) =>
  s.selectedChart === 'left' ? s.setTimeframe : s.setSecondTimeframe,
);
```

**Volume Profile routing** (same pattern):
```ts
const vpEnabled = useStore((s) =>
  s.selectedChart === 'left' ? s.vpEnabled : s.secondVpEnabled);
const setVpEnabled = useStore((s) =>
  s.selectedChart === 'left' ? s.setVpEnabled : s.setSecondVpEnabled);
```
Each chart also reads its own VP state via `chartId` in `CandlestickChart`, so depth subscriptions and color are independent per chart.

**Layout toggle button**: positioned in the right section of the toolbar (after flex spacer), between dividers alongside the camera icon and NY clock. Toggles `dualChart`, resets `selectedChart` to `'left'` when enabling dual mode.

---

## InstrumentSelector — Selection-Aware Routing

```ts
const contract = useStore((s) =>
  fixed ? s.orderContract
    : s.selectedChart === 'left' ? s.contract : s.secondContract,
);
const setContract = useStore((s) =>
  fixed ? s.setOrderContract
    : s.selectedChart === 'left' ? s.setContract : s.setSecondContract,
);
```

- `fixed` prop: order panel's own contract (independent of chart selection)
- Without `fixed`: routes to the selected chart's contract

---

## App.tsx

Replaced inline chart rendering with `<ChartArea />`. The null-contract placeholder moved into ChartArea.
