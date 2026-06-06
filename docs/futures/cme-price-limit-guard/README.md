# CME Price Limit Guard

Draws visual warning lines on the chart for CME equity index futures daily price limits, and automatically disables trading when price enters the 2% buffer zone required by Topstep.

---

## Background

CME equity index futures (ES, NQ, MES, MNQ, RTY, M2K, YM, MYM) have a **±7% daily price limit** measured from the prior session's settlement price. Topstep prohibits placing orders within **2% of that limit** — meaning the effective no-trade zone begins at ±5% from settlement.

Energy and metals contracts use rolling dynamic circuit breakers and are excluded from this feature.

---

## UI

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ES  5m  ▾   [chart toolbar]                                    ⚙   📷  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  5,980 ──╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  +7% limit  5,980.00  │
│                                                                          │
│  5,941 ──────────────────────────────────────────  +5% limit –2%        │  ← inner solid (amber)
│                                                                          │
│  5,850 ── █  █  █                                                        │
│           █  █  █  █                                                     │
│  5,820 ──    █  █  █                                                     │
│                                                                          │
│  5,762 ──────────────────────────────────────────  –5% limit –2%        │  ← inner solid (amber)
│                                                                          │
│  5,722 ──╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  –7% limit  5,722.50  │  ← outer dashed (faint)
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

  when price breaches inner line →

┌───────────────────────────────────────────────────────────────────────┐
│  ⚠  Price near CME limit — trading disabled                           │  ← red banner top-center
└───────────────────────────────────────────────────────────────────────┘

  all 4 lines turn red, Buy/Sell buttons grey out
```

### Chart lines

| Line | Style | Price | Color |
|---|---|---|---|
| Upper CME limit | Dashed | Settlement × 1.07 | Faint amber → faint red on breach |
| Upper trade threshold | Solid | Settlement × 1.05 | Amber → red on breach |
| Lower trade threshold | Solid | Settlement × 0.95 | Amber → red on breach |
| Lower CME limit | Dashed | Settlement × 0.93 | Faint amber → faint red on breach |

### Warning banner

Appears at the top of the chart (centered, translucent red) when price is at or beyond the ±5% threshold. Disappears automatically when price retreats inside the zone.

### Settings

Toggle lives in **Chart Settings → Market tab → "Show CME price limit lines"**.

---

## How It Works

### Settlement price

The settlement price is derived from bar history — it is the **close of the last bar before the current session start** (18:00 ET boundary, resolved via `getCurrentSessionStartSec()`). No external API call is made.

**Fail-open**: if no prior-session bar exists (e.g. a brand-new symbol or chart with no history), no lines are drawn and trading is never blocked.

### Block logic

A `realtimeService.onQuote` subscription monitors the live price. When price crosses into the ±5% zone:

1. Lines turn red
2. `priceLimitBlocked = true` is set in the Zustand store (runtime state, not persisted)
3. A red warning banner appears on the chart
4. Buy/Sell buttons are disabled (`baseCanPlace` becomes false)
5. Quick-order chart clicks are rejected with a warning toast

When price retreats below the threshold, all of the above reverts automatically.

### Symbol whitelist

Only these ProjectX product codes trigger the feature:

| Product code | Contract |
|---|---|
| `EP` | /ES (E-mini S&P 500) |
| `ENQ` | /NQ (E-mini Nasdaq-100) |
| `MES` | Micro E-mini S&P 500 |
| `MNQ` | Micro E-mini Nasdaq-100 |
| `ERY` | /RTY (E-mini Russell 2000) |
| `M2K` | Micro E-mini Russell 2000 |
| `YM` | E-mini Dow |
| `MYM` | Micro E-mini Dow |

Contract IDs are in the format `CON.F.US.<PRODUCT>.<EXPIRY>` — the product code at index `[3]` (split by `.`) is matched against the whitelist.

---

## Integration Points

| System | Role |
|---|---|
| `utils/priceLimits.ts` | Symbol whitelist, settlement derivation, limit math, breach check |
| `hooks/usePriceLimitLines.ts` | Creates/manages the 4 `PriceLevelPrimitive` lines; subscribes to live quotes |
| `CandlestickChart.tsx` | Mounts the hook; renders the warning banner |
| `chartSettingsSlice.ts` | `showPriceLimits: boolean` (persisted) + `priceLimitBlocked: boolean` (runtime) |
| `ChartSettingsPopover.tsx` | Market tab → toggle |
| `BuySellButtons.tsx` | Reads `priceLimitBlocked`; disables buttons |
| `useQuickOrder.ts` | Reads `priceLimitBlocked`; rejects chart-click orders with toast |

---

## Files

| File | Change |
|---|---|
| `frontend/src/utils/priceLimits.ts` | New — core math and symbol matching |
| `frontend/src/components/chart/hooks/usePriceLimitLines.ts` | New — hook managing the 4 primitives |
| `frontend/src/store/slices/chartSettingsSlice.ts` | Added `showPriceLimits` + `priceLimitBlocked` + setter |
| `frontend/src/components/chart/ChartSettingsPopover.tsx` | New Market tab + MarketPanel with toggle |
| `frontend/src/components/chart/CandlestickChart.tsx` | Mounts hook; renders warning banner |
| `frontend/src/components/order-panel/BuySellButtons.tsx` | `priceLimitBlocked` gates `baseCanPlace` |
| `frontend/src/components/chart/hooks/useQuickOrder.ts` | Guard in `placeQuickOrder()` rejects when blocked |
