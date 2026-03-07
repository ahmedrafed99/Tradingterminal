# Feature: Economic Calendar on Chart

**Status**: Ready to build — data source confirmed (FXStreet Calendar API)

Display upcoming economic events (CPI, FOMC, jobless claims, etc.) as markers on the chart. This is a **forward-looking calendar**, not a historical news feed. The primary value is seeing what events are coming up so the trader can plan around them.

---

## Key Requirement

**We need upcoming/future events, not just past articles.** The FXStreet Calendar API provides exactly this — scheduled event dates with impact levels, consensus, and previous values, weeks in advance.

---

## Data Source: FXStreet Calendar API (Confirmed Working)

### Endpoint

```
GET https://calendar-api.fxstreet.com/en/api/v1/eventDates/{from}/{to}
```

- **No API key required**
- Requires headers: `Origin: https://www.fxstreet.com` and `Referer: https://www.fxstreet.com/`
- Returns full JSON array of events for the date range
- Supports arbitrary date ranges (full month, multi-month, etc.)

### Date range strategy

Fetch current month + next month to always have ~2-4 weeks ahead:
```
from = first day of current month (UTC)
to   = last day of next month (UTC)
```

### Response shape (per event)

```json
{
  "id": "c719ab7f-...",
  "eventId": "40055871-...",
  "dateUtc": "2026-03-11T13:30:00Z",
  "name": "Consumer Price Index (MoM)",
  "countryCode": "US",
  "currencyCode": "USD",
  "volatility": "HIGH",
  "actual": null,
  "consensus": 0.2,
  "previous": 0.2,
  "isBetterThanExpected": null,
  "isSpeech": false,
  "isPreliminary": false
}
```

### Filtering

Filter server-side: `countryCode === 'US' || currencyCode === 'USD'`

### Confirmed stats (March 2026 test)

- 1187 total events → 242 US events (177 upcoming, 65 past)
- Impact breakdown: HIGH=31, MEDIUM=94, LOW=116
- Includes FOMC, CPI, NFP, GDP, PCE, jobless claims, Fed speeches, auctions, etc.
- Has actuals + beat/miss indicators for past events

### Caching

Backend should cache 4 hours (events don't change often, and we don't want to hammer the endpoint).

### Failed alternatives (for reference)

| Source | Problem |
|--------|---------|
| Government RSS (Fed, BLS) | Historical only — publishes after events, not a calendar |
| Forex Factory mirror (`nfs.faireconomy.media`) | Current week only, aggressive 429 rate limiting, unofficial |
| Finnhub `/calendar/economic` | Returns 403 on free plan (paid-only endpoint) |

---

## Frontend (Ready to Build)

The frontend implementation was prototyped and works. Key decisions from the prototype:

### Visual Design
- **Marker**: Purple (#9b59b6) circled lightning bolt icon, rendered via LWC `ISeriesPrimitive` canvas
- **Position**: Bottom of chart pane, just above time scale (BOTTOM_OFFSET = 14px)
- **Circle**: radius 10px, purple stroke + translucent purple fill, lightning bolt with glow
- **Tooltip**: bg-black, border #2a2e39, border-radius 6px
  - Title: 11px, #d1d4dc, font-weight 600
  - Impact: colored label (high=#ef5350, medium=#f0a830, low=#787b86)
  - Date: `M/D/YYYY @ HH:MM am/pm ET` format
- **Toggle**: Newspaper icon in chart toolbar (active: #f0a830, inactive: #787b86)

### LWC v5 Primitive Notes (from prototype)
- Renderer must use `CanvasRenderingTarget2D` from `fancy-canvas` with `target.useMediaCoordinateSpace()`
- Pane height = `chartEl.clientHeight - timeScale().height()` (not just clientHeight)
- Cursor override needs injected `<style>` with `!important` to beat LWC inline styles
- Hide tooltip on scroll via `subscribeVisibleLogicalRangeChange` (not in `updateAllViews`)

### NewsEvent Interface

```ts
interface NewsEvent {
  id: string;
  title: string;
  description: string;
  date: string;          // ISO 8601 UTC
  category: 'fed' | 'inflation' | 'employment' | 'other';
  impact: 'high' | 'medium' | 'low';
  feedKey: string;
  source: string;
  link: string;
}
```

### Architecture (once data source is resolved)

```
Calendar API / Data Source
       |
       v  (HTTPS fetch, server-side)
+-----------------------------------------+
|  Backend: GET /news/economic            |
|  Cache 4 hours, filter USD, normalize   |
+-----------------------------------------+
       |  JSON
       v
+-----------------------------------------+
|  Frontend: newsService.ts               |
|  In-memory cache + in-flight dedup      |
+-----------------------------------------+
       |
       v
+-----------------------------------------+
|  Zustand: NewsState slice               |
|  newsEvents, newsVisible, filters       |
|  Persisted: newsVisible, disabledFeeds, |
|             hiddenKeywords              |
+-----------------------------------------+
       |
       v
+-----------------------------------------+
|  Chart: NewsEventsPrimitive             |
|  Canvas markers + HTML tooltip overlay  |
+-----------------------------------------+
```

### Files (when implemented)

| File | Purpose |
|------|---------|
| `backend/src/routes/newsRoutes.ts` | Express route — `GET /news/economic` |
| `backend/src/services/newsService.ts` | Calendar fetch, cache, normalize |
| `frontend/src/types/news.ts` | `NewsEvent` interface |
| `frontend/src/services/newsService.ts` | HTTP client + in-memory cache |
| `frontend/src/components/chart/primitives/NewsEventsPrimitive.ts` | Chart primitive — markers + tooltip |
| `frontend/src/components/chart/hooks/useNewsEvents.ts` | Fetch on mount, push to store + primitive |
| `frontend/src/store/useStore.ts` | `NewsState` slice additions |
| `frontend/src/components/chart/CandlestickChart.tsx` | Attach primitive |
| `frontend/src/components/chart/ChartToolbar.tsx` | Toggle button |

### Primitive Attachment Order

```
1. VolumeProfilePrimitive
2. TradeZonePrimitive
3. NewsEventsPrimitive       <-- this feature
4. CountdownPrimitive
5. DrawingsPrimitive
```

---

## Phase 2: News Settings Panel

Filter by source/keyword. UI mockup and Zustand state designed but not yet built. Will implement after the core calendar works.

---

## No New Frontend Dependencies

All rendering is canvas-based (LWC primitive) + vanilla DOM (tooltip). No new packages needed on frontend. Backend may need a dependency depending on the chosen data source.
