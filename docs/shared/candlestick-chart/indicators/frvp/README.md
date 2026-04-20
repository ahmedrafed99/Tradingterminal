# Fixed Range Volume Profile (FRVP)

A user-placed drawing that renders a horizontal volume histogram over a selected price/time range. Unlike the session Volume Profile (which uses GatewayDepth data), FRVP is built entirely from OHLCV bar data.

## Modes

| Mode | Trigger | Volume source |
|------|---------|---------------|
| **anchor** | Single click on chart | `_sharedVolumeMap` — session bars + live GatewayTrade ticks accumulated since page load |
| **range** | Click-drag on chart | `_buildRangeVolumeMap(t1, t2)` — filters `_barsRef` to bars within [t1, t2] |

## Data Flow

### Historical bars (`_barsRef`)
- `useChartBars` loads up to 20,000 bars (14 days at 1-min) on mount.
- After load, calls `DrawingsPrimitive.setBarsRef(sorted)`.
- On each live quote flush, the current (partial) bar's `v` field is updated in-place via `setBarsRef` again.

### Live bar volume (`pendingBarVolume`)
- Accumulated from **GatewayTrade ticks** (`handleMarketTick`), **not** from `data.volume` on quote events.
- Only ticks with `tick.timestampMs >= barStartMs` are counted — this filters out historical backfill batches that ProjectX sends on subscribe (which would otherwise inflate the live bar's volume massively).
- Resets to 0 on each new candle period.

### Anchor volume map (`_sharedVolumeMap`)
- Built at bar load time from session bars (filtered by `getCurrentSessionStartSec()`).
- Augmented live via `handleMarketTick` — each trade tick's `size` is added to the map keyed by price (snapped to tick size).

### Range volume map
- Built on-demand in `_buildRangeVolumeMap(t1, t2)`.
- Iterates all bars in `_barsRef`, keeps only those where `barTime ∈ [tMin, tMax]`.
- Each bar's `v` is distributed evenly across `bar.l → bar.h` (one tick per step).

## Known Pitfall — GatewayTrade Backfill

When the Market Hub connection is established, ProjectX sends a **historical backfill batch** of all session trades as a single GatewayTrade event. This batch can contain 10,000–20,000 items with `arr.length` summed into the synthetic quote's `volume` field. Using `data.volume` deltas to track bar volume (the previous approach) caused the live bar's `v` to spike by the full session trade count on the first quote, inflating FRVP hover labels from ~200 contracts/bar to 200k+.

**Fix (implemented):** Bar volume is now sourced exclusively from `handleMarketTick` with a `tick.timestampMs >= barStartMs` guard, so backfill ticks (old timestamps) are ignored.

## Files

```
frontend/src/
├── components/chart/
│   ├── drawings/
│   │   ├── DrawingsPrimitive.ts    ← _buildRangeVolumeMap, setBarsRef, setSharedVolumeMap
│   │   └── FRVPRenderer.ts         ← numBars/numTicks rendering, hover label formatting
│   └── hooks/
│       └── useChartBars.ts         ← pendingBarVolume accumulation, handleMarketTick
```

## Hover Label Formatting

```typescript
// FRVPRenderer.ts
const volText = volume >= 1000 ? `${(volume / 1000).toFixed(1)}k` : String(Math.round(volume));
```

"247.8k" means 247,800 contracts — always a real value, never a formatting artifact.

## Persistence

FRVP drawings are saved to `backend/data/user-settings.json` under `drawings[]`. Key fields:

```json
{
  "type": "frvp",
  "mode": "range",
  "anchorTime": 1776636000,
  "t2": 1776636240,
  "t2Auto": true,
  "pMin": 26535,
  "pMax": 26681,
  "numBars": 24,
  "rowSizeMode": "count",
  "contractId": "CON.F.US.ENQ.M26"
}
```

`t2Auto: true` means the right boundary follows `_lastBarTime` (the latest bar), so a live session FRVP auto-extends as new bars close.
