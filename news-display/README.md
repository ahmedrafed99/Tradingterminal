# Feature: Economic Calendar on Chart

**Status**: Implemented and working

Display upcoming economic events (CPI, FOMC, jobless claims, etc.) as markers on the chart. This is a **forward-looking calendar**, not a historical news feed. The primary value is seeing what events are coming up so the trader can plan around them.

---

## Data Source: FXStreet Calendar API

### Endpoint

```
GET https://calendar-api.fxstreet.com/en/api/v1/eventDates/{from}/{to}
```

- **No API key required**
- Requires headers: `Origin: https://www.fxstreet.com` and `Referer: https://www.fxstreet.com/`
- Date range: current month through end of next month

### Filtering (server-side)

- `countryCode === 'US' || currencyCode === 'USD'`
- `volatility === 'HIGH' || volatility === 'MEDIUM'` (low-impact events excluded)

### Caching

Backend caches results for 4 hours. Frontend also caches in-memory with 4h TTL + in-flight dedup.

### Failed alternatives (for reference)

| Source | Problem |
|--------|---------|
| Government RSS (Fed, BLS) | Historical only — publishes after events, not a calendar |
| Forex Factory mirror (`nfs.faireconomy.media`) | Current week only, aggressive 429 rate limiting, unofficial |
| Finnhub `/calendar/economic` | Returns 403 on free plan (paid-only endpoint) |

---

## Architecture

```
FXStreet Calendar API
       |
       v  (HTTPS fetch, server-side)
+-----------------------------------------+
|  Backend: GET /news/economic            |
|  Cache 4h, filter US + HIGH/MEDIUM      |
+-----------------------------------------+
       |  JSON
       v
+-----------------------------------------+
|  Frontend: newsService.ts               |
|  In-memory cache (4h) + in-flight dedup |
+-----------------------------------------+
       |
       v
+-----------------------------------------+
|  Zustand: NewsState slice               |
|  newsEvents[], newsVisible (persisted)  |
+-----------------------------------------+
       |
       v
+-----------------------------------------+
|  Chart: NewsEventsPrimitive             |
|  Canvas markers + click-to-show tooltip |
+-----------------------------------------+
```

---

## Visual Design

- **Marker**: Purple (#9b59b6) circled lightning bolt icon, rendered via LWC `ISeriesPrimitive` canvas
- **Position**: Bottom of chart pane, just above time scale (BOTTOM_OFFSET = 14px)
- **Circle**: radius 10px, purple stroke + translucent purple fill
- **Lightning bolt**: always purple (#9b59b6), simple ⚡ polygon shape
- **Hover**: brighter circle (#b07cc6) + cursor override to pointer + glow on bolt
- **Click**: toggles tooltip (click marker to show, click again or click elsewhere to dismiss)
- **Nearby markers**: merged when within 2*MARKER_RADIUS px to avoid overlap
- **Future events**: uses linear interpolation from candle data to place markers beyond the last candle (timeToCoordinate returns null for future times, so we extrapolate from two known reference points)
- **Tooltip**: bg-black, border #2a2e39, border-radius 6px, positioned above marker
  - Title: 11px, #d1d4dc, font-weight 600
  - Impact: colored uppercase label (high=#ef5350, medium=#f0a830)
  - Time: `HH:MM am/pm ET` format (time only, no date)
  - Multiple events per marker separated by dividers (capped at 5, shows "+N more")
  - Dismissed on scroll via `subscribeVisibleLogicalRangeChange`
- **Toggle**: Calendar icon in chart toolbar (active: #f0a830, inactive: #787b86)

---

## NewsEvent Interface

```ts
interface NewsEvent {
  id: string;
  title: string;
  date: string;          // ISO 8601 UTC
  impact: 'high' | 'medium' | 'low';
  category: 'fed' | 'inflation' | 'employment' | 'other';
  actual: number | null;
  consensus: number | null;
  previous: number | null;
  isBetterThanExpected: boolean | null;
  country: string;
  currency: string;
}
```

---

## Files

| File | Purpose |
|------|---------|
| `backend/src/routes/newsRoutes.ts` | Express route — `GET /news/economic` |
| `backend/src/services/newsService.ts` | FXStreet fetch, 4h cache, filter US HIGH/MEDIUM, categorise |
| `frontend/src/types/news.ts` | `NewsEvent` interface |
| `frontend/src/services/newsService.ts` | HTTP client + 4h in-memory cache + in-flight dedup |
| `frontend/src/components/chart/primitives/NewsEventsPrimitive.ts` | ISeriesPrimitive — canvas markers + HTML tooltip |
| `frontend/src/components/chart/hooks/useNewsEvents.ts` | Fetch on mount, store sync, mouse/click event wiring |
| `frontend/src/store/useStore.ts` | `NewsState` slice (`newsEvents[]`, `newsVisible`) |
| `frontend/src/components/chart/CandlestickChart.tsx` | Attach primitive + call hook |
| `frontend/src/components/chart/ChartToolbar.tsx` | `NewsToggle` button |

### Primitive Attachment Order

```
1. CountdownPrimitive
2. VolumeProfilePrimitive
3. NewsEventsPrimitive       <-- this feature
4. TradeZonePrimitive
5. DrawingsPrimitive
```

---

## LWC v5 Primitive Notes

- Renderer uses `CanvasRenderingTarget2D` from `fancy-canvas` with `target.useMediaCoordinateSpace()`
- Pane height = `chartEl.clientHeight - timeScale().height()` (not just clientHeight)
- Cursor override injects `<style>` with `!important` to beat LWC inline styles
- Tooltip dismissed on scroll via `subscribeVisibleLogicalRangeChange`
- Event times mapped via linear interpolation (`_buildTimeToX`): picks first/last candle as reference points, computes px-per-second, then extrapolates any timestamp. This is needed because `timeToCoordinate()` returns null for future times beyond the candle data range

---

## No New Frontend Dependencies

All rendering is canvas-based (LWC primitive) + vanilla DOM (tooltip). No new packages needed.

---

## Phase 2: News Settings Panel

Filter by impact/category. Not yet built.
