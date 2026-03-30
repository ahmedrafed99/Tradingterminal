# Chart Settings Menu

## Overview

A gear-icon button in the **bottom-right corner** of the chart (where the price scale and time scale intersect) that opens a quick-action popover. The popover provides an **Invert Scale** toggle and a **Settings...** entry point to a full settings modal with categorised chart options.

All settings persist via the existing Zustand + `user-settings.json` dual-layer system.

---

## Entry Point — Gear Button

The dead rectangle where the right price scale border meets the time scale border is currently empty. A small gear icon (`⚙`) is rendered there as a clickable button.

```
                                    Price Scale
                                   │  142350.00
                                   │  142300.00
                                   │  142250.00
───────────────────────────────────┤
  14:00   14:15   14:30   14:45   │ [⚙]  ← gear button
```

### Behaviour

- **Hover**: `bg-[#1e222d]` with `transition: background 0.15s`
- **Click**: Opens the quick popover directly above the button
- **Icon**: Hexagon with inner circle SVG, stroke `#787b86`
- **Size**: Fills the corner rectangle exactly — measured at runtime by querying the actual dead-zone `<td>` element that lightweight-charts renders (last cell in the last `<tr>` of its internal table layout), using `getBoundingClientRect()` relative to the parent wrapper. A `ResizeObserver` watches both the chart container and the dead-zone `<td>` itself — the latter is needed because the price scale can change width after bar data loads (wider price labels) without the outer container resizing.

---

## Quick Popover

A small popover that appears on gear click, opening upward from the bottom-right corner. Currently one item.

```
┌─────────────────────────┐
│  ✓  Invert scale        │
└─────────────────────────┘
```

### Items

| Item | Indicator | Action |
|------|-----------|--------|
| Invert scale | Blue checkmark (`#2962ff`) when active, hidden when inactive | Toggles `rightPriceScale.invertScale` on the chart via `chart.applyOptions()` |

### Styling

| Element | Value |
|---------|-------|
| Background | `#1e222d` |
| Border | `1px solid #2a2e39` |
| Shadow | `0 4px 12px rgba(0,0,0,0.5)` |
| Row hover | `bg-[#2a2e39]` with `transition: background 0.15s` |
| Text | `12px #d1d4dc` |
| Checkmark | `#2962ff` stroke, fades + scales in/out with `transition: opacity 0.15s, transform 0.15s` |
| Entrance | `@keyframes chartSettingsFadeIn` — fade + translateY(6px) + scale(0.97), 180ms ease-out, origin bottom-right |
| Dismiss | Click outside (mousedown listener) |

---

## Full Settings Modal

Opened via "Settings..." from the quick popover. Category sidebar on the left, settings panel on the right.

```
┌──────────────────────────────────────────────────────────┐
│  Settings                                           ✕    │
├────────────────┬─────────────────────────────────────────┤
│                │                                         │
│  ● Bars        │  CANDLES                                │
│    Canvas      │                                         │
│    Trading     │                                         │
│                │  ☑ Body     [■ up] [■ down]             │
│                │  ☑ Borders  [■ up] [■ down]             │
│                │  ☑ Wick     [■ up] [■ down]             │
│                │                       up   down         │
│                │                                         │
├────────────────┴─────────────────────────────────────────┤
│  Reset defaults                        Cancel    Ok      │
└──────────────────────────────────────────────────────────┘
```

### Categories

#### 1. Bars

Candle appearance — body, borders, and wicks.

| Setting | Control | Default | Store key |
|---------|---------|---------|-----------|
| Body — enabled | Checkbox | `true` | `chartSettings.bodyVisible` |
| Body — up colour | Colour swatch (`ColorPopover`) | `#9598a1` | `chartSettings.upColor` |
| Body — down colour | Colour swatch | `#0097a6` | `chartSettings.downColor` |
| Borders — enabled | Checkbox | `false` | `chartSettings.borderVisible` |
| Borders — up colour | Colour swatch | `#9598a1` | `chartSettings.borderUpColor` |
| Borders — down colour | Colour swatch | `#0097a6` | `chartSettings.borderDownColor` |
| Wick — enabled | Checkbox | `true` | `chartSettings.wickVisible` |
| Wick — up colour | Colour swatch | `#9598a1` | `chartSettings.wickUpColor` |
| Wick — down colour | Colour swatch | `#0097a6` | `chartSettings.wickDownColor` |

Each row has a checkbox + label on the left and two colour swatches (up / down) on the right, with column labels at the bottom.

#### 2. Canvas

Chart background.

| Setting | Control | Default | Store key |
|---------|---------|---------|-----------|
| Background type | Dropdown (`solid` / `gradient`) | `solid` | `chartSettings.bgType` |
| Solid colour | Colour swatch (shown when type = solid) | `#000000` | `chartSettings.bgColor` |
| Gradient top | Colour swatch (shown when type = gradient) | `#1e222d` | `chartSettings.gradientTopColor` |
| Gradient bottom | Colour swatch (shown when type = gradient) | `#000000` | `chartSettings.gradientBottomColor` |

Layout: inline row — dropdown + colour swatch(es) side by side, no separate labels.

**Performance**

| Setting | Control | Default | Store key |
|---------|---------|---------|-----------|
| Show FPS counter | Checkbox | `false` | `chartSettings.showFpsCounter` |
| FPS counter colour | Colour swatch (disabled when counter is off) | `#808080` | `chartSettings.fpsCounterColor` |

When enabled, a small monospace FPS readout appears in the top-right corner of the chart, positioned just left of the price scale. The counter measures `requestAnimationFrame` throughput, updating once per second. The colour is user-configurable via a colour swatch.

#### 3. Trading

Trade marker appearance — controls how entry/exit trade zones render on the chart.

| Setting | Control | Default | Store key |
|---------|---------|---------|-----------|
| Extend zone right | Checkbox | `false` | `chartSettings.extendTradeZoneRight` |

When enabled, the trade zone rectangle (drawn between entry and exit prices) extends horizontally to the right edge of the chart instead of stopping at the exit candle. The dashed horizontal lines at entry/exit price levels also extend accordingly. Inspired by the HLine drawing's `extendLeft` toggle.

---

## Modal Styling

| Element | Value |
|---------|-------|
| Backdrop | `bg-black/60` (shared `Modal` component) |
| Panel background | `bg-(--color-surface)` |
| Panel outer border | `border border-(--color-border)`, `rounded-lg` |
| Internal separators | `1px solid var(--color-border)` (title bar bottom, sidebar right, footer top) |
| Title | `14px font-weight 600 color var(--color-text-bright)` |
| Close button | `✕`, `var(--color-text-muted)` → `hover:var(--color-text-bright)`, `transition: color 0.15s` |
| Sidebar item (active) | `background: var(--color-hover-row)`, `color: var(--color-text-bright)` |
| Sidebar item (inactive) | `color: var(--color-text-muted)` → `hover: var(--color-text)`, `transition: background 0.15s, color 0.15s` |
| Section label | `10px uppercase tracking 0.08em color var(--color-text-muted)` |
| Checkbox (checked) | `bg var(--color-accent)`, `border var(--color-accent)`, checkmark `#fff` |
| Checkbox (unchecked) | `bg transparent`, `border var(--color-text-dim)` |
| Colour swatches | `28×28px`, `border-radius: 4px`, `border: 1px solid var(--color-border)`, disabled `opacity: 0.4` |
| Dropdown | `height: 28px`, `bg: var(--color-surface)`, `border: 1px solid var(--color-border)`, `border-radius: 4px` |
| Cancel button | Ghost — `color: var(--color-text-muted)` → `hover: var(--color-text-bright)` |
| Ok button | `bg: var(--color-accent-hover)` → `hover: var(--color-accent)`, `color: var(--color-text-bright)`, `font-weight: 500` |
| Reset defaults | `12px`, `color: var(--color-text-muted)` → `hover: var(--color-text)` (footer left) |
| Transitions | All hover/focus states animated at `0.15s` |
| Width | `520px`, `max-height: 80vh` |
| Overflow | `visible` (colour popovers escape panel bounds via `position: fixed`) |

See `docs/shared/design-tokens/` for the full visual design token reference.

---

## Store Shape

Added to Zustand store as a `chartSettings` object in `chartSettingsSlice.ts`, persisted via Zustand `persist` middleware:

```ts
chartSettings: {
  // Bars
  upColor: string;            // '#9598a1'
  downColor: string;          // '#0097a6'
  bodyVisible: boolean;       // true
  borderVisible: boolean;     // false
  borderUpColor: string;      // '#9598a1'
  borderDownColor: string;    // '#0097a6'
  wickUpColor: string;        // '#9598a1'
  wickDownColor: string;      // '#0097a6'
  wickVisible: boolean;       // true

  // Canvas
  bgType: 'solid' | 'gradient'; // 'solid'
  bgColor: string;            // '#000000'
  gradientTopColor: string;   // '#1e222d'
  gradientBottomColor: string; // '#000000'

  // Trading
  extendTradeZoneRight: boolean; // false

  // Performance
  showFpsCounter: boolean;  // false
  fpsCounterColor: string;  // '#808080'
}
```

Default values match the hardcoded values in `chartTheme.ts` so nothing changes until the user explicitly modifies a setting.

---

## Key Files

| File | Role |
|------|------|
| `frontend/src/components/chart/ChartSettingsButton.tsx` | Gear button + quick popover |
| `frontend/src/components/chart/ChartSettingsModal.tsx` | Full settings modal with sidebar categories |
| `frontend/src/components/chart/CandlestickChart.tsx` | Mounts `ChartSettingsButton`, applies `chartSettings` via `useEffect` |
| `frontend/src/components/chart/ColorPopover.tsx` | Colour picker popover with opacity slider (reused by modal swatches, drawing toolbar, VP settings) |
| `frontend/src/components/chart/hooks/useFpsCounter.ts` | RAF-based FPS measurement hook |
| `frontend/src/store/slices/chartSettingsSlice.ts` | Store slice with defaults |
| `frontend/src/store/useStore.ts` | Combined store — `chartSettings` persisted to `localStorage` |

---

## Apply Logic

When `chartSettings` values change in the store (via `useEffect` in `CandlestickChart.tsx`):

1. **Candle options** — `series.applyOptions()` with updated colours; when body/wick is disabled, colour is set to `'transparent'`
2. **Background** — if `bgType === 'gradient'`, use `{ type: 'gradient', topColor, bottomColor }` via `chart.applyOptions({ layout: { background } })`; otherwise `{ type: 'solid', color: bgColor }`
3. **Invert scale** — `chart.applyOptions({ rightPriceScale: { invertScale } })` immediately on toggle (via quick popover, not modal)

All Lightweight Charts options are hot-updatable — no chart recreation needed.

---

## Scope

### Phase 1 (implemented)
- Gear button in the scale corner (hexagon icon)
- Quick popover with Invert Scale toggle (checkmark indicator)
- Button dynamically sized to fill the dead-zone `<td>` via `getBoundingClientRect()`

### Phase 2 (implemented)
- "Settings..." entry point in popover
- Full modal with Bars and Canvas categories
- Colour swatches open `ColorPopover` via `position: fixed` to escape overflow clipping
- Snapshot on open / Cancel reverts to snapshot / Ok keeps changes
- Reset defaults button restores `CHART_SETTINGS_DEFAULTS`
- Persist all settings via Zustand `persist` middleware
- Apply settings to chart in real time via `useEffect`

### Phase 3 (implemented)
- Trading category with trade marker settings
- "Extend zone right" toggle — extends trade zone rectangles to the right edge of the chart
- Setting reactively applied via `useChartWidgets` store subscription → `TradeZonePrimitive.setExtendRight()`

### Phase 4 (implemented)
- FPS counter toggle in Canvas category under "Performance" section
- Configurable FPS counter colour via colour swatch
- FPS overlay positioned just left of the price scale using `getPriceScaleWidth()`
- RAF-based measurement in `useFpsCounter` hook — zero overhead when disabled

### Out of scope (future)
- Per-chart settings in dual-chart mode (currently shared)
- Template save/load (like TradingView's "Template" dropdown)
- Additional categories (Scales/Grid, Events, Alerts)
- Chart type selector (bar, line, area — currently candlestick only)
