# Stats Dashboard

A near-full-screen popover triggered by a **Stats** tab in the bottom panel. Displays trading performance metrics, P&L visualizations, and calendar breakdowns. All data is computed client-side from trades already fetched by the Trades tab — no additional API calls.

---

## UX Behavior

- **Stats** appears as a fourth tab in the bottom panel tab bar (after Orders, Trades, Conditions).
- Clicking the Stats tab opens a **popover overlay** that rises from the bottom panel, covering ~96% of the viewport height.
- The main chart and UI remain mounted behind a semi-transparent backdrop (`bg-black/60`).
- The popover is **scrollable** vertically — all stats content lives inside a single scroll container with `maxWidth: 1200` centered.
- Dismiss by: clicking the Stats tab again (toggles back to Trades), pressing Escape, or clicking the backdrop.
- Opening/closing animates with a slide-up transition (`cubic-bezier(0.16, 1, 0.3, 1)`, 300ms).
- Background: `var(--color-popover)`. Cards: `var(--color-table-stripe)` with `border-(--color-border)` and `border-radius: 10px`.

### Date Range

- The popover header includes the **DatePresetSelector** (Today / This Week / This Month), synced with the Trades tab's `tradesDatePreset` in the store.
- Changing the preset in either location updates both — they share the same store field and the same `displayTrades` array.
- No duplicate API calls: if TradesTab already fetched trades for the selected preset, Stats reads from the cached `displayTrades`.

---

## Sections

### 1. KPI Cards

3-column grid of dark cards (`var(--color-table-stripe)`), each with `20px 24px` padding and `10px` border-radius.

**Row 1:**

| Card | Content |
|------|---------|
| **Total P&L** | Large 28px colored dollar value, vertically centered |
| **Trade Win %** | 28px percentage + SVG gauge donut (270° arc, green win / red loss). Winners count (green) at top-left of arc, losers count (red) at bottom-right |
| **Avg Win / Avg Loss** | Side-by-side: `+$65.92 / -$24.72` in green/red at 28px |

**Row 2:**

| Card | Content |
|------|---------|
| **Profit Factor** | 28px value, green if ≥ 1, red if < 1. Shows "∞" if no losses |
| **Best / Worst Trade** | Two 20px values side-by-side with vertical divider. Timestamps below each |
| **Streaks & Drawdown** | Row layout: Win Streak, Loss Streak (with separator), Max Drawdown |

Card titles: 14px, `font-weight: 600`, `color: var(--color-text)`.

### 2. Equity Curve / Daily P&L Chart

Canvas-rendered chart (240px tall) inside a card with a segmented toggle (Equity / Daily).

**Equity Curve mode:**
- X-axis: trade number (nice round steps via `niceStep()`).
- Y-axis: cumulative net P&L ($).
- Line color changes per-segment: **green above zero, red below zero**. Segments crossing zero are split at the intersection.
- Area fill: green gradient above zero line, red gradient below — rendered via canvas clipping.
- Data point dots when ≤ 30 trades.
- Interactive **crosshair** on hover: drawn on a transparent overlay canvas (avoids redrawing the base chart). Dashed vertical + horizontal lines, highlighted dot, floating tooltip showing trade #, cumulative P&L, and individual trade P&L.

**Daily Bar Chart mode:**
- X-axis: calendar date (MM-DD).
- Y-axis: daily net P&L ($).
- Green bars for positive days, red for negative, with rounded corners.
- **Hover**: hovered bar stays full opacity, all others dim to 35%. Full-height column highlight behind the hovered bar. Tooltip shows inline in the header row (centered, fixed-width segments so text doesn't shift between bars).

### 3. PnL Calendar Grid

Table-based calendar heatmap showing daily performance.

- Columns: Sun–Fri + Weekly Total (CME futures open Sunday 6pm ET).
- Rows: one per week within the selected date range.
- Each cell shows: **net P&L** (20px, green/red) + **trade count** (12px, muted).
- Cell background uses desaturated heatmap tones (`#1a6b5a` / `#6b2a2a`) with sqrt intensity scaling so small values are still visible.
- Weekly total column on the right.
- Native `title` tooltip on each cell with date, trade count, and exact P&L.

**Day drill-down:** Clicking a calendar cell opens a **day detail view** that replaces the dashboard content:
- **Header**: "← Back" button, full date (e.g. "Monday, March 18, 2026"), net P&L, trade count + W/L.
- **Day equity curve**: same green/red split rendering with crosshair + tooltip interaction.
- **Trade list table**: Time, Side, Qty, Entry, Exit, Duration, Net P&L — matching TradesTab column layout with striped rows.
- Click "← Back" to return to the main dashboard.

### 4. Breakdown Analysis

Four cards in a 2×2 grid:

**P&L by Hour** — Horizontal bars per trading hour (ET). Each row: `hour:00` label → proportional green/red bar → dollar value. Tooltip on hover with trade count, net P&L, avg P&L. Row and bar highlight on hover (bar brightens from 50% to 80% opacity).

**Long vs Short** — Two-column layout with vertical separator:
- Full-width proportional trade count bar at the top (`X Long` / `X Short`).
- Each column: Win Rate mini donut (SVG) with percentage, Avg Win/Loss inline (`+$X / -$Y`), Total Net.

**Performance by Day** — Horizontal bars for Sun–Fri (includes Sunday for CME session open). Each row: day label → proportional bar → avg P&L value. Tooltip with day count, total P&L, avg P&L. Row and bar highlight on hover.

**Avg Trade Duration** — Winners vs Losers with proportional progress bars showing relative duration.

---

## Trade Grouping Logic

Multiple exits from a single entry are counted as **one trade**. Reuses `buildEntryMap()` from `TradeZonePrimitive.ts` (FIFO matching).

1. **Entry** = the fill that opens or adds to a position.
2. **Exit** = all fills that reduce that position back to flat.
3. Scaling out counts as one trade with blended exit price (size-weighted), summed P&L/fees, duration from first entry to last exit.
4. Opening half-turns (`profitAndLoss === null`) and voided trades are excluded.
5. FIFO matching requires `remaining >= exit.size` to prevent over-consumption of entry sizes across sessions.

### Duration Calculation

Trade duration uses `tradingDurationMs()` from `marketHours.ts`, which excludes CME closed periods:
- **Weekend**: Friday 17:00 ET → Sunday 18:00 ET (49h)
- **Daily maintenance**: Mon–Thu 17:00–18:00 ET (1h each)

This applies to the Trades tab, Stats duration breakdown, and day detail trade tables.

---

## Data Flow

```
User clicks Stats tab
        │
        ▼
Popover opens (slide-up animation)
        │
        ▼
Read displayTrades from layoutSlice (already fetched by TradesTab)
   ├── If empty: tradeService.searchTrades() → store
   └── Otherwise: use cached data, zero API calls
        │
        ▼
groupTrades(displayTrades)               ← utils/tradeStats.ts
        │
        ▼
computeStats(grouped)                    ← pure function → TradeStats
        │
        ├──► StatsKpiCards (stats)
        ├──► StatsPnlChart (stats.equityCurve, calendarData)
        ├──► StatsCalendarGrid (calendarData) → click → StatsDayDetail
        └──► StatsBreakdowns (hourlyData, directionStats, dayOfWeekData, durationData)
```

All stats recompute via `useMemo` when `displayTrades` changes. SignalR trade events trigger re-fetch (debounced 500ms) in TradesTab, which updates `displayTrades`, which reactively updates Stats.

---

## Store Changes

Added `'stats'` to the `bottomPanelTab` union type in `layoutSlice`:

```
bottomPanelTab: 'orders' | 'trades' | 'conditions' | 'stats'
```

No new store fields. Popover open state is derived from `bottomPanelTab === 'stats'`. Day drill-down state is local to `StatsPopover` (`useState`).

---

## Animations

Entrance animations trigger on mount or when sections scroll into view:

- **Section reveal**: Each section (KPI cards, chart, calendar, breakdowns) is wrapped in `AnimateIn` — fades in + slides up (600ms ease) when it enters the viewport via `IntersectionObserver` (threshold 0.1, triggers once).
- **Number counters**: All dollar values, percentages, and integers animate from 0 to their target over 1200ms with ease-out cubic (`useAnimatedValue` hook using `requestAnimationFrame`).
- **SVG donuts**: Win rate gauge arc and Long/Short mini donuts animate from `strokeDasharray: 0` to their target arc length over 800ms via CSS transition (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Chart transitions**: Switching between Equity and Daily mode animates over 700ms (ease-out cubic). Equity curve values scale from 0 (flat at zero line) to full. Daily bars rise from the zero line to their full height. Uses `requestAnimationFrame` loop with a `progress` parameter passed to the draw functions.

---

## Files

| File | Purpose |
|------|---------|
| `components/stats/StatsPopover.tsx` | Popover container — backdrop, scroll, animation, dismiss, day drill-down state |
| `components/stats/StatsKpiCards.tsx` | 3×2 grid of KPI cards with SVG donut, animated counters |
| `components/stats/StatsPnlChart.tsx` | Canvas equity curve + daily bar chart with crosshair, tooltip, entrance animation |
| `components/stats/StatsCalendarGrid.tsx` | Weekly calendar heatmap with clickable day cells |
| `components/stats/StatsDayDetail.tsx` | Day drill-down: equity curve with crosshair + trade list table |
| `components/stats/StatsBreakdowns.tsx` | 2×2 grid: P&L by Hour, Long vs Short (with mini donuts), Day of Week, Duration |
| `components/stats/AnimateIn.tsx` | Scroll-triggered fade-in + slide-up wrapper using IntersectionObserver |
| `components/stats/statsHelpers.ts` | Shared utilities: `pnlColor()`, `fmtDollar()`, `niceStep()`, `hexToRgba()` |
| `utils/tradeStats.ts` | Pure functions: `groupTrades()`, `computeStats()`, `buildCalendarData()`, `buildHourlyData()`, `buildDirectionStats()`, `buildDayOfWeekData()`, `buildDurationComparison()` |

All components live under `frontend/src/components/stats/`.

---

## Font Size Hierarchy

Consistent across the entire dashboard — minimum 12px, no squinting:

| Size | Role |
|------|------|
| **28px** | Hero KPI numbers (Total P&L, Win %, Avg Win/Loss, Profit Factor) |
| **20px** | Calendar P&L values, Best/Worst trade values |
| **16px** | Streaks, Total Net in breakdowns |
| **14px** | Card/section titles, win rate percentages, avg win/loss values |
| **13px** | Calendar headers, trade list cells, duration values |
| **12px** | Minimum — all labels, row text, toggle buttons, timestamps, tooltips |
