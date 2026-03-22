# Stats Dashboard

A near-full-screen popover triggered by a **Stats** tab in the bottom panel. Displays trading performance metrics, P&L visualizations, and calendar breakdowns. All data is computed client-side from trades already fetched by the Trades tab — no additional API calls.

---

## UX Behavior

- **Stats** appears as a fourth tab in the bottom panel tab bar (after Orders, Trades, Conditions).
- Clicking the Stats tab opens a **popover overlay** that rises from the bottom panel, covering ~85–90% of the viewport height.
- The main chart and UI remain mounted behind a semi-transparent backdrop (`bg-black/60`).
- The popover is **scrollable** vertically — all stats content lives inside a single scroll container.
- Dismiss by: clicking the Stats tab again, pressing Escape, or clicking the backdrop.
- Opening/closing animates with a slide-up/fade-in transition (~200ms ease).

### Date Range

- The popover includes its own **date preset picker** (Today / This Week / This Month) at the top, synced with the Trades tab's `tradesDatePreset` in the store.
- Changing the preset in either location updates both — they share the same store field and the same `displayTrades` array.
- No duplicate API calls: if TradesTab already fetched trades for the selected preset, Stats reads from the cached `displayTrades`.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Stats Dashboard                          [Today ▾]  [This Week] [Month]│
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SECTION 1 — KPI Cards (horizontal row, wraps on narrow screens)         │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
│  │ Net PnL│ │Win Rate│ │ Profit │ │ Avg RR │ │  Best  │ │ Worst  │     │
│  │ +$1,240│ │  62%   │ │ Factor │ │  2.1   │ │ Trade  │ │ Trade  │     │
│  │        │ │ 31/50  │ │  1.8   │ │        │ │ +$580  │ │ -$320  │     │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘     │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                            │
│  │  Avg   │ │  Avg   │ │  Max   │ │  Max   │                            │
│  │ Winner │ │ Loser  │ │Win Strk│ │Los Strk│                            │
│  │ +$124  │ │ -$68   │ │   7    │ │   3    │                            │
│  └────────┘ └────────┘ └────────┘ └────────┘                            │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SECTION 2 — PnL Chart (toggle: Equity Curve / Daily Bars)               │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │       ╱\         ╱──                                             │    │
│  │      ╱  \       ╱                                                │    │
│  │     ╱    \     ╱                                                 │    │
│  │    ╱      \   ╱                                                  │    │
│  │   ╱        \/                                                    │    │
│  │  ╱                                                               │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│  x-axis: trade # (equity) or date (daily bars)                           │
│  y-axis: cumulative $ (equity) or daily net $ (bars)                     │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SECTION 3 — PnL Calendar Grid                                           │
│  ┌──────┬──────┬──────┬──────┬──────┐                                    │
│  │ Mon  │ Tue  │ Wed  │ Thu  │ Fri  │                                    │
│  ├──────┼──────┼──────┼──────┼──────┤                                    │
│  │ +$320│ +$580│ -$120│ +$460│      │  ← current week                    │
│  │  4t  │  6t  │  2t  │  5t  │      │                                    │
│  ├──────┼──────┼──────┼──────┼──────┤                                    │
│  │ -$200│ +$410│ +$130│ +$670│ +$220│  ← previous week                   │
│  │  3t  │  5t  │  3t  │  7t  │  4t  │                                    │
│  └──────┴──────┴──────┴──────┴──────┘                                    │
│  Cell color intensity scales with P&L magnitude (green/red)              │
│  Each cell shows: net P&L + trade count                                  │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SECTION 4 — Breakdown Analysis                                          │
│                                                                          │
│  ┌─ Time of Day ──────────────┐  ┌─ Long vs Short ────────────────┐     │
│  │ Heatmap grid: hour blocks  │  │ Side-by-side comparison:       │     │
│  │ colored by avg P&L         │  │ win rate, avg P&L, count       │     │
│  │ (6AM–6PM ET, 1hr buckets) │  │ for long trades vs short       │     │
│  └────────────────────────────┘  └────────────────────────────────┘     │
│                                                                          │
│  ┌─ Day of Week ──────────────┐  ┌─ Trade Duration ───────────────┐     │
│  │ Bar chart: Mon–Fri avg PnL │  │ Avg duration of winners vs     │     │
│  │                             │  │ losers — reveals cut-short     │     │
│  └────────────────────────────┘  └────────────────────────────────┘     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Trade Grouping Logic

Multiple exits from a single entry must be counted as **one trade**. This reuses the FIFO matching already implemented in `TradeZonePrimitive.ts` (`buildEntryMap()`).

### Rules

1. **Entry** = the fill that opens or adds to a position.
2. **Exit** = all fills that reduce that position back to flat (or to the next entry).
3. Scaling out (multiple partial exits) counts as **one trade** with:
   - **Blended exit price**: size-weighted average of all exit fills.
   - **Total P&L**: sum of all exit legs' `profitAndLoss - fees`.
   - **Duration**: first entry timestamp → last exit timestamp.
4. Opening half-turns (`profitAndLoss === null`) and voided trades are excluded.
5. The grouping utility should be shared with TradesTab (it already groups multi-exit trades for display).

### R:R Calculation

- **Risk** = distance from entry to SL (if a bracket SL was placed). If no SL data is available, R:R is omitted for that trade.
- **Reward** = net P&L in ticks.
- **Avg R:R** = mean of `reward / risk` across all trades where risk is known.

> If SL data is not reliably available from trade history, fall back to: **Avg R:R = avg winner / avg loser** (absolute values). This is a simplified but useful proxy.

---

## KPI Cards

| Card | Formula | Notes |
|------|---------|-------|
| **Net P&L** | `Σ(profitAndLoss - fees)` | Green if positive, red if negative |
| **Win Rate** | `wins / total` | Display as percentage + fraction (e.g. "62% (31/50)") |
| **Profit Factor** | `gross_wins / gross_losses` | > 1.0 = profitable. Show "∞" if no losses |
| **Avg R:R** | `avg_winner / avg_loser` | Absolute values. Omit if < 2 trades |
| **Best Trade** | `max(net P&L)` | Show timestamp on hover |
| **Worst Trade** | `min(net P&L)` | Show timestamp on hover |
| **Avg Winner** | `mean(net P&L) where net > 0` | — |
| **Avg Loser** | `mean(net P&L) where net < 0` | — |
| **Max Win Streak** | Longest consecutive winning trades | — |
| **Max Loss Streak** | Longest consecutive losing trades | — |

### Card Styling

- Background: `bg-(--color-surface)` with `border-(--color-border)`.
- Value text: large, white, monospace for dollar amounts.
- Label text: `SECTION_LABEL` style (`text-[10px] uppercase tracking-wider text-(--color-text-muted)`).
- Positive values: `text-(--color-profit)`. Negative: `text-(--color-loss)`.

---

## PnL Chart

Two visualization modes, toggled by a small button group at the top-right of the section:

### Equity Curve (default)

- X-axis: trade number (1, 2, 3...).
- Y-axis: cumulative net P&L ($).
- Line chart with area fill — green shading when above $0, red when below.
- Tooltip on hover: trade #, P&L for that trade, running total.

### Daily Bar Chart

- X-axis: calendar date.
- Y-axis: daily net P&L ($).
- Green bars for positive days, red bars for negative.
- Best suited for "This Week" and "This Month" presets.

### Max Drawdown Annotation

- On the equity curve, annotate the max drawdown region (peak to trough) with a shaded band and a label showing the drawdown amount.
- Useful for challenge account awareness (50KTC drawdown limits).

### Implementation

Use a lightweight charting approach — either:
- Canvas rendering (the codebase already has canvas drawing logic in the chart components).
- A small lib like `recharts` or inline SVG — this is not performance-critical (tens to hundreds of data points at most).

---

## PnL Calendar Grid

A table-based calendar heatmap showing daily performance.

### Behavior

- Columns: Mon, Tue, Wed, Thu, Fri (weekdays only — futures trade Sun evening but that rolls into Monday's session).
- Rows: one row per week within the selected date range.
- Each cell shows:
  - **Net P&L** (dollar amount, colored green/red).
  - **Trade count** (dimmed, smaller text).
- Cell background color intensity scales with P&L magnitude:
  - Deep green → large win day.
  - Deep red → large loss day.
  - Neutral/dim → no trades or breakeven.
- Non-trading days (weekends, no trades) show as empty/dark cells.

### Date Range Mapping

| Preset | Grid shows |
|--------|------------|
| Today | Single cell (current day) — or hide grid entirely, KPIs are enough |
| This Week | One row (Mon–Fri of current futures week) |
| This Month | 4–5 rows (full month calendar) |

### Footer Row

- Weekly totals at the end of each row.
- Grand total at the bottom-right.

---

## Breakdown Analysis (Section 4)

Four compact analysis widgets in a 2×2 grid:

### Time of Day Heatmap

- Horizontal bar or grid of hour-blocks (6 AM – 6 PM ET, 1-hour buckets).
- Each block colored by average P&L for trades entered in that hour.
- Validates or challenges the trader's assumptions about best trading windows.

### Long vs Short

- Side-by-side stat comparison:
  - Win rate (long vs short).
  - Average P&L (long vs short).
  - Trade count (long vs short).
- Simple bar or table layout. Reveals directional bias.

### Day of Week

- Small bar chart: Monday through Friday.
- Each bar = average net P&L for that weekday.
- Highlights consistently weak or strong days.

### Trade Duration (Winners vs Losers)

- Average duration of winning trades vs losing trades.
- Displayed as two values or a simple comparison bar.
- Reveals if winners are being cut short or losers held too long.

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
   ├── If displayTrades is empty and preset hasn't been fetched yet:
   │     tradeService.searchTrades(accountId, start, end) → store
   └── Otherwise: use cached data, zero API calls
        │
        ▼
groupMultiExitTrades(displayTrades)          ← shared utility
        │
        ▼
computeStats(groupedTrades)                  ← new stats utility
        │
        ├──► KPI card values
        ├──► Equity curve data (cumulative P&L array)
        ├──► Daily P&L map (date → net P&L + count)
        ├──► Calendar grid cells
        └──► Breakdown analysis (time-of-day, long/short, day-of-week, duration)
```

### Reactivity

- Stats recompute via `useMemo` when `displayTrades` changes.
- If a new trade comes in via SignalR (debounced 500ms refresh), both TradesTab and Stats update automatically.
- No separate store slice needed — stats are derived values, not persisted state.

---

## Store Changes

Add `'stats'` to the `bottomPanelTab` union type in `layoutSlice`:

```
bottomPanelTab: 'orders' | 'trades' | 'conditions' | 'stats'
```

No new store fields needed. The popover's open/closed state is derived from `bottomPanelTab === 'stats'`.

---

## Files (planned)

| File | Purpose |
|------|---------|
| `StatsPopover.tsx` | Popover container — backdrop, scroll area, slide-up animation, dismiss handling |
| `StatsKpiCards.tsx` | Horizontal row of KPI metric cards |
| `StatsPnlChart.tsx` | Equity curve + daily bar chart with toggle |
| `StatsCalendarGrid.tsx` | Weekly calendar heatmap grid |
| `StatsBreakdowns.tsx` | 2×2 grid: time-of-day, long/short, day-of-week, duration |
| `utils/tradeStats.ts` | Pure functions: `groupMultiExitTrades()`, `computeStats()`, `buildCalendarData()`, `buildEquityCurve()` |

All components live under `frontend/src/components/stats/`.

---

## Phased Implementation

| Phase | Scope | Value |
|-------|-------|-------|
| **1** | Popover shell + KPI cards + daily bar chart | Core metrics, highest value, least effort |
| **2** | Calendar heatmap grid + multi-exit grouping utility | Visual daily breakdown |
| **3** | Equity curve + max drawdown annotation | Trajectory visualization |
| **4** | Breakdown analysis (time-of-day, long/short, day-of-week, duration) | Deep performance insights |
