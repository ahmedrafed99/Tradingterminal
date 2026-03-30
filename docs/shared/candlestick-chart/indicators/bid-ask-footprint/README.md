# Bid/Ask Footprint Indicator

Per-candle footprint visualization showing bid and ask activity at each price level. For every candle, horizontal bars extend left (bid) and right (ask) from the candle center, with bar length proportional to how many times that price appeared as the best bid or best ask during the candle's timeframe.

**Status:** Implemented and working (2026-03-26)

## Data Source

**SignalR Market Hub — GatewayQuote event**

Uses `bestBid` and `bestAsk` fields from the `GatewayQuote` event (same data already used for chart price updates). No additional subscriptions needed.

- Each quote tick increments a counter at the bid price level and the ask price level
- Counters are keyed per candle (using floored timestamp from `floorToCandlePeriod`)
- Current candle's counters update live; past candles freeze when a new candle starts
- Some quotes arrive with `undefined` lastPrice but valid bid/ask — these are still counted

## Visual Design

```
                     ┌─┐
    ◄── BID bars     │ │     ASK bars ──►
                     │ │
    ████████████████ │ │ ██████████████      24003
        ████████████ │ │ ██████████          24002
    ████████████████ │ │ ████████████████    24001
              ██████ │ │ ████                24000
                     │ │
                     └─┘
```

- **Bid bars** (green/`COLOR_BUY`): extend LEFT from candle center
- **Ask bars** (red/`COLOR_SELL`): extend RIGHT from candle center
- **Bar length**: proportional to count / max count across all visible candles
- **Max bar width**: 40px per side
- **Opacity**: 40%
- **z-order**: `bottom` (renders behind candles)
- Each bar is one tick tall (uses `tickSize` from contract)

## Toggle

Enabled via **Indicators** dropdown in the chart toolbar → "Bid/Ask Footprint" checkbox.

- Default: **off**
- Persisted across page reloads
- Dual-chart aware: left and right charts have independent toggles
- Store state: `bidAskEnabled` / `secondBidAskEnabled` in `layoutSlice`

## Key Files

| File | Role |
|------|------|
| `frontend/src/components/chart/BidAskPrimitive.ts` | ISeriesPrimitive — data model + renderer |
| `frontend/src/components/chart/hooks/useChartBars.ts` | Feeds bid/ask from GatewayQuote, syncs enabled state |
| `frontend/src/components/chart/CandlestickChart.tsx` | Creates and attaches primitive to series |
| `frontend/src/components/chart/ChartToolbar.tsx` | Toggle UI in Indicators dropdown |
| `frontend/src/store/slices/layoutSlice.ts` | `BidAskFootprintState` — enabled booleans + setters |

## Performance

Data collection runs continuously regardless of the toggle state — each quote tick does one `Map.get` + counter increment per side, which is negligible at 100+ quotes/sec. Memory cost over a full session (~1,380 one-minute candles × ~10-20 price levels) is under 1MB. Rendering is gated by `_enabled`: when toggled off, `paneViews()` returns an empty array and no canvas work is done.

This "always collect" approach means toggling the indicator on mid-session shows footprint data for all candles since page load, not just from the moment it was enabled.

## Limitations

- Only shows data from the current session (no historical bid/ask data from API)
- Candles formed before the page was loaded have no footprint data
- The global max count normalization means early candles with low counts may appear as very short bars once later candles accumulate more counts
