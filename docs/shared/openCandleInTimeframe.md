# Feature: Open Candle in Timeframe

Right-click any candle to instantly navigate to that candle's open time on a lower timeframe.

**Status**: Implemented

---

## Overview

When inspecting a candle on a higher timeframe (e.g. 4H), right-clicking it opens a context menu. Hovering "Open candle in timeframe..." expands a timeframe picker. Selecting a lower timeframe switches the chart to that timeframe and scrolls so the clicked candle's open time is at the left edge of the viewport, showing ~100 bars forward.

---

## UI

```
Right-click on candle
        │
        ▼
┌──────────────────────────────┐
│  Open candle in timeframe... ›──┐
└──────────────────────────────┘  │
                                  ▼
                         ┌──────────────────┐
                         │    SECONDS       │
                         │  5s   15s        │
                         │    MINUTES       │
                         │  1m   3m   15m   │
                         │    HOURS         │
                         │  1h   4h         │
                         └──────────────────┘
```

- Only timeframes **smaller** than the current candle are shown (e.g. on a 4H chart, 4H and above are hidden)
- Custom timeframes appear in the picker alongside presets
- Works on both left and right charts in dual-chart mode

---

## Files

| File | Role |
|------|------|
| `frontend/src/components/chart/ChartContextMenu.tsx` | Context menu component with submenu trigger |
| `frontend/src/components/chart/TimeframePicker.tsx` | Reusable TF grid (no pin/custom input) used as submenu |
| `frontend/src/components/chart/hooks/useChartContextMenu.ts` | Attaches `contextmenu` listener, captures candle time at click |
| `frontend/src/components/chart/CandlestickChart.tsx` | Mounts hook, renders menu, calls drill handler |
| `frontend/src/components/chart/hooks/useChartBars.ts` | Consumes `pendingDrillTarget` after bars load to set scroll position |
| `frontend/src/store/slices/layoutSlice.ts` | `pendingDrillTarget` state + `setPendingDrillTarget` / `clearPendingDrillTarget` |

---

## Implementation

### Right-click Detection

`useChartContextMenu` attaches a native `contextmenu` listener to the chart container. On fire:
1. Calls `chart.timeScale().coordinateToTime(x)` to get the candle's open time at the click position
2. Reads `getCandlePeriodSeconds(timeframe)` for the current candle's duration
3. Sets local state `{ x, y, candleTime, candleSeconds }` which mounts `ChartContextMenu`

### Timeframe Filtering

`TimeframePicker` receives `maxSeconds` = the current candle's duration in seconds. Any timeframe whose `getCandlePeriodSeconds(tf) >= maxSeconds` is filtered out, preventing nonsensical upward drilling.

### Drill Navigation

On timeframe selection:
1. `setPendingDrillTarget({ chartId, time: candleTime })` is written to the store
2. `setTimeframe(tf)` (or `setSecondTimeframe` for the right chart) triggers `useChartBars` to reload

### Scroll-to-Target

After bars load in `useChartBars`, before the default "show last 100 bars" scroll:
1. Reads `pendingDrillTarget` imperatively via `useStore.getState()`
2. If set and matching this chart, clears the target and calls `setVisibleLogicalRange` using the bar index of the first candle at or after `candleTime`
3. Shows 100 bars from that index — the drilled candle lands at the left edge of the viewport
