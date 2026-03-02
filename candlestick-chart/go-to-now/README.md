# Feature: Go-to-Now Button

Floating button in the bottom-right region of the chart that scrolls back to the latest candle when the user has panned left into history.

**Status**: Implemented

---

## Overview

When the user drags the chart left to inspect historical price action, a small arrow button fades in near the bottom-right corner of the chart area. Clicking it smoothly animates the view back so the latest candle sits at roughly 75% of the chart width, leaving 25% whitespace on the right for breathing room.

---

## UI

```
Chart area                              Price scale
┌──────────────────────────────────────┬────────────┐
│                                      │            │
│                                      │  25120.00  │
│                                      │            │
│                                      │  25100.00  │
│                                      │            │
│                                 [▶|] │  25080.00  │  ← 30px from both borders
│──────────────────────────────────────│            │
│  10:00    10:15    10:30    10:45    │            │  ← time scale
└──────────────────────────────────────┴────────────┘
                                  30px↔ ↕30px
```

- **Position**: Equidistant (30px gap) from the price scale's left border and the time scale's top border — dynamically computed via `chart.timeScale().width()` and a `ResizeObserver` so the button stays inside the candle area regardless of price scale width changes
- **Size**: 28 x 28 px
- **Background**: `#2a2e39` (matches chart border/scale styling)
- **Icon**: right-pointing chevron with vertical end-bar (`▶|`), stroke `#d1d4dc`
- **Border radius**: 4px
- **Idle opacity**: 0.85, hover opacity: 1.0
- **Show/hide**: fades in/out with `opacity 0.2s ease` transition

---

## Files

| File | Role |
|------|------|
| `frontend/src/components/chart/CandlestickChart.tsx` | Visibility detection, scroll handler, button JSX |

---

## Implementation

### Visibility Detection

Subscribes to `chart.timeScale().subscribeVisibleLogicalRangeChange()`. On each change, compares the visible time range's end (`getVisibleRange().to`) against the latest candle's timestamp (`lastBarRef.current.time`). If the latest candle is beyond the visible range (user has scrolled left), the button fades in. Uses a ref (`scrollBtnShownRef`) to avoid unnecessary re-renders — only calls `setState` when the visibility actually changes.

### Scroll Behaviour

On click:
1. Reads the current visible logical range to determine how many bars are on screen
2. Calculates `rightOffset = visibleBars * 0.25` (25% empty space on the right)
3. Calls `chart.timeScale().scrollToPosition(rightOffset, true)` — the `true` flag enables Lightweight Charts' built-in smooth scroll animation
4. Result: the latest candle lands at approximately 75% of the chart width

### Show/Hide Animation

The button is always rendered in the DOM but uses `opacity` and `pointer-events` toggling for smooth fade transitions (no mount/unmount flicker). When hidden: `opacity: 0, pointer-events: none`. When visible: `opacity: 0.85, pointer-events: auto`.
