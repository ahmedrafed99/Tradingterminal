# Feature: Symbol Display

Inline instrument ticker and timeframe label shown at the top-left corner inside the chart.

**Status**: Implemented

---

## Overview

Each chart displays its ticker symbol (e.g. `NQ`, `MNQ`, `ES`) and the active timeframe (e.g. `1m`, `5m`, `1h`, `D`) in the top-left corner. The label is unobtrusive, uses a muted gray color, and does not interfere with chart interaction.

---

## UI

```
┌──────────────────────────────────┐
│ NQ · 1m   O... H... L... C...   │
│                                  │
│         (chart candles)          │
│                                  │
└──────────────────────────────────┘
```

- **Position**: `absolute top-2 left-2`, inside the chart container
- **Font**: `-apple-system, BlinkMacSystemFont, sans-serif`
- **Style**: `text-xs font-medium`, color `#787b86`, semi-transparent background `#00000080` with `borderRadius: 2px`, `padding: 1px 3px` (matches OHLC tooltip)
- **Format**: `{ticker} · {timeframe.label}` — e.g. `NQ · 1m`
- **Ticker extraction**: `contract.name.replace(/[FGHJKMNQUVXZ]\d{2}$/, '')` strips the futures expiry suffix (month code + 2-digit year) from the full symbol (e.g. `NQM26` → `NQ`)
- `pointer-events-none` + `select-none` — no interaction, purely visual

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/components/chart/CandlestickChart.tsx` | Added ticker+timeframe div inside the chart return JSX |

---

## Implementation

The label is a static HTML overlay rendered conditionally when `contract` is non-null. It sits in the same absolute-positioned wrapper as the OHLC tooltip (flex row with `gap-2`).

```tsx
{contract && (
  <div className="absolute top-2 left-2 z-10 pointer-events-none select-none flex items-center gap-2"
       style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
    <div className="text-[#787b86] text-xs font-medium leading-tight"
         style={{ background: '#00000080', borderRadius: 2, padding: '1px 3px' }}>
      {contract.name.replace(/[FGHJKMNQUVXZ]\d{2}$/, '')} · {timeframe.label}
    </div>
    {/* OHLC tooltip sits here */}
  </div>
)}
```

No state, no effects — pure render from props (`contract`, `timeframe`).
