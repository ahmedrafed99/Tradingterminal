# Chart Settings Menu

## Overview

A gear-icon button in the **bottom-right corner** of the chart (where the price scale and time scale intersect) that opens a quick-action popover. The popover provides an **Invert Scale** toggle and a **More Settings...** entry point to a full settings modal with categorised chart options.

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
- **Size**: Fills the corner rectangle exactly — measured at runtime by querying the actual dead-zone `<td>` element that lightweight-charts renders (last cell in the last `<tr>` of its internal table layout), using `getBoundingClientRect()` relative to the parent wrapper

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

Opened via "More Settings..." from the quick popover. Category sidebar on the left, settings panel on the right.

```
┌──────────────────────────────────────────────────────────┐
│  Settings                                           ✕    │
├────────────────┬─────────────────────────────────────────┤
│                │                                         │
│  ● Symbol      │  CANDLES                                │
│    Scales      │                                         │
│    Canvas      │  ☑ Body     [■ up] [■ down]             │
│                │  ☑ Wick     [■ up] [■ down]             │
│                │                                         │
│                │                                         │
│                │                                         │
│                │                                         │
├────────────────┴─────────────────────────────────────────┤
│                                         Cancel    Ok     │
└──────────────────────────────────────────────────────────┘
```

### Categories

#### 1. Symbol

Per-instrument candle appearance.

| Setting | Control | Default | Store key |
|---------|---------|---------|-----------|
| Body — up colour | Colour swatch (reuse `ColorPopover`) | `#9598a1` | `chartSettings.upColor` |
| Body — down colour | Colour swatch | `#0097a6` | `chartSettings.downColor` |
| Body — enabled | Checkbox | `true` | `chartSettings.bodyVisible` |
| Wick — up colour | Colour swatch | `#9598a1` | `chartSettings.wickUpColor` |
| Wick — down colour | Colour swatch | `#0097a6` | `chartSettings.wickDownColor` |
| Wick — enabled | Checkbox | `true` | `chartSettings.wickVisible` |

#### 2. Scales and Lines

Price scale and grid configuration.

| Setting | Control | Default | Store key |
|---------|---------|---------|-----------|
| Grid — horizontal lines | Checkbox | `false` | `chartSettings.gridHorzLines` |
| Grid — vertical lines | Checkbox | `false` | `chartSettings.gridVertLines` |
| Right offset (empty bars) | Number input (1–50) | `15` | `chartSettings.rightOffset` |

#### 3. Canvas

Chart background and text.

| Setting | Control | Default | Store key |
|---------|---------|---------|-----------|
| Background colour | Colour swatch | `#000000` | `chartSettings.bgColor` |
| Background gradient | Checkbox | `false` | `chartSettings.bgGradient` |
| Gradient top colour | Colour swatch (disabled when gradient off) | `#1e222d` | `chartSettings.gradientTopColor` |
| Gradient bottom colour | Colour swatch (disabled when gradient off) | `#000000` | `chartSettings.gradientBottomColor` |
| Text colour | Colour swatch | `#d1d4dc` | `chartSettings.textColor` |
| Font size | Number input (10–16) | `12` | `chartSettings.fontSize` |

---

## Modal Styling

| Element | Value |
|---------|-------|
| Backdrop | `bg-black/60` |
| Panel background | `bg-[#1e222d]` |
| Panel border | `border border-[#2a2e39]` |
| Title | `text-sm font-semibold text-white` |
| Close button | `✕`, `text-[#787b86]` → `hover:text-white`, `transition-colors` |
| Sidebar background | Slightly darker — `bg-[#181c25]` or transparent with left border |
| Sidebar item (active) | `bg-[#2a2e39]` text `text-white` |
| Sidebar item (inactive) | `text-[#787b86]` → `hover:text-[#d1d4dc]`, `transition-colors` |
| Section label | `text-[10px] uppercase tracking-wider text-[#787b86]` |
| Input / number field bg | `bg-[#111]` |
| Checkbox accent | `accent-[#2962ff]` |
| Colour swatches | Reuse existing `ColorPopover` component |
| Cancel button | Ghost style — `text-[#787b86]` → `hover:text-white` |
| Ok button | `bg-[#2962ff]` → `hover:bg-[#1e53e5]`, `text-white` |
| Transitions | All hover/focus states animated (`transition-colors`) |

---

## Store Shape

Added to Zustand store as a single `chartSettings` object, persisted alongside existing settings:

```ts
chartSettings: {
  // Symbol
  upColor: string;          // '#9598a1'
  downColor: string;        // '#0097a6'
  bodyVisible: boolean;     // true
  wickUpColor: string;      // '#9598a1'
  wickDownColor: string;    // '#0097a6'
  wickVisible: boolean;     // true

  // Scales and Lines
  gridHorzLines: boolean;   // false
  gridVertLines: boolean;   // false
  rightOffset: number;      // 15

  // Canvas
  bgColor: string;          // '#000000'
  bgGradient: boolean;      // false
  gradientTopColor: string; // '#1e222d'
  gradientBottomColor: string; // '#000000'
  textColor: string;        // '#d1d4dc'
  fontSize: number;         // 12

  // Quick popover
  invertScale: boolean;     // false
}
```

Default values match the current hardcoded values in `chartTheme.ts` so nothing changes until the user explicitly modifies a setting.

---

## Key Files

| File | Role |
|------|------|
| `frontend/src/components/chart/ChartSettingsButton.tsx` | Gear button + quick popover (implemented) |
| `frontend/src/components/chart/CandlestickChart.tsx` | Mounts `ChartSettingsButton`, passes `chartRef` + `containerRef` |
| `frontend/src/components/chart/ChartSettingsModal.tsx` | Full settings modal with sidebar categories (planned) |
| `frontend/src/components/chart/chartTheme.ts` | Read from `chartSettings` store instead of hardcoded values (planned) |
| `frontend/src/store/useStore.ts` | `chartSettings` slice + persistence (planned) |

---

## Apply Logic

When `chartSettings` values change in the store:

1. **Candle options** — call `series.applyOptions()` with updated colours/visibility
2. **Background** — if `bgGradient` is true, use `{ type: ColorType.VerticalGradient, topColor: gradientTopColor, bottomColor: gradientBottomColor }`; otherwise use `{ type: ColorType.Solid, color: bgColor }` via `chart.applyOptions({ layout: { background } })`
3. **Grid / scales** — call `chart.applyOptions()` with updated layout, grid, timeScale, priceScale
4. **Invert scale** — call `chart.priceScale('right').applyOptions({ invertScale })` immediately on toggle

All Lightweight Charts options are hot-updatable — no chart recreation needed.

---

## Scope

### Phase 1 (implemented)
- Gear button in the scale corner (hexagon icon)
- Quick popover with Invert Scale toggle (checkmark indicator)
- Button dynamically sized to fill the dead-zone `<td>` via `getBoundingClientRect()`

### Phase 2 (planned)
- "More Settings..." entry point in popover
- Full modal with Symbol, Scales, Canvas categories
- Persist all settings to `user-settings.json` via Zustand store
- Apply settings to chart in real time

### Out of scope (future)
- Per-chart settings in dual-chart mode (currently shared)
- Template save/load (like TradingView's "Template" dropdown)
- Additional categories (Events, Alerts)
- Chart type selector (bar, line, area — currently candlestick only)
