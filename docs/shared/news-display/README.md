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
- `volatility === 'HIGH' || volatility === 'MEDIUM' || volatility === 'LOW'` (only `NONE` excluded)
- Frontend filters by user-selected impact levels via `newsImpactFilter` (default: high only)

### Caching

- **Disk cache**: Backend persists results to `backend/data/news-calendar.json` so data survives server restarts without re-fetching
- **Memory cache**: Backend + frontend both hold in-memory cache with 4h TTL
- **Month rollover**: Cache auto-invalidates when the calendar month changes (new date range)
- **Frontend dedup**: In-flight request deduplication prevents duplicate API calls

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
|  Disk cache (news-calendar.json, 4h)    |
|  + memory cache, filter US + H/M/L      |
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
|  newsEvents[], newsImpactFilter (persisted) |
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
- **Future events**: uses `timeToCoordinate` for events within data range (accurate, respects gap compression); falls back to linear extrapolation from last two candles only for future events beyond the last candle
- **Tooltip**: `var(--color-surface)` bg, border `--color-border`, `RADIUS.MD` (3px), positioned above marker, 260px fixed width
  - **Header row**: 7px colored impact dot + uppercase "HIGH IMPACT" label + right-aligned time (`HH:MM am/pm ET`)
  - **Title**: 11px, `--color-text`, font-weight 600
  - **Data grid**: Actual / Cons. / Prev. columns (only shown when data exists). Actual value colored green (`COLOR_BUY`) if better than expected, red (`COLOR_SELL`) if worse
  - **Beat/miss indicator**: small colored dot + "Better/Worse than expected" (only when actual AND consensus both exist)
  - **Grouped events**: separated by `--color-border` dividers, footer shows "N events at this time"
  - Max-height 320px, scrollable. Dismissed on scroll via `subscribeVisibleLogicalRangeChange`
  - Top-edge clamped so tooltip doesn't overflow above chart
- **Toolbar dropdown**: Newspaper icon + "News" + chevron in chart toolbar. Click opens a dropdown with three rows (High / Medium / Low impact). Each row shows an accent-colored checkmark that fades+scales in when active (same pattern as "Invert scale" in chart settings). Button text is orange (#f0a830) when any filter is active, muted (#787b86) when all off.

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
| `backend/src/services/newsService.ts` | FXStreet fetch, disk + memory cache (4h), filter US HIGH/MEDIUM/LOW, categorise |
| `backend/data/news-calendar.json` | Disk cache for economic events (auto-generated, survives restarts) |
| `frontend/src/types/news.ts` | `NewsEvent` interface |
| `frontend/src/services/newsService.ts` | HTTP client + 4h in-memory cache + in-flight dedup |
| `frontend/src/components/chart/primitives/NewsEventsPrimitive.ts` | ISeriesPrimitive — canvas markers + HTML tooltip |
| `frontend/src/components/chart/hooks/useNewsEvents.ts` | Fetch on mount, store sync, mouse/click event wiring |
| `frontend/src/store/useStore.ts` | `NewsState` slice (`newsEvents[]`, `newsImpactFilter`) |
| `frontend/src/components/chart/CandlestickChart.tsx` | Attach primitive + call hook |
| `frontend/src/components/chart/ChartToolbar.tsx` | `NewsDropdown` — impact filter dropdown |

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
- Event positioning uses `timeToCoordinate()` directly for events within the data range (accurate with gap compression). For future events beyond the last candle (where `timeToCoordinate` returns null), falls back to linear extrapolation from the last two candles

---

## No New Frontend Dependencies

All rendering is canvas-based (LWC primitive) + vanilla DOM (tooltip). No new packages needed.

---

## Impact Filter

The toolbar dropdown exposes three checkboxes persisted to localStorage as `newsImpactFilter: { high, medium, low }`. Default: `{ high: true, medium: false, low: false }`. A Zustand persist migration (v0→v1) converts the old `newsVisible` boolean to the new shape. Filtering is frontend-only — all events are fetched once and filtered in-memory when the user toggles checkboxes (no additional API calls).
