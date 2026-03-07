# Feature: Economic Calendar on Chart

**Status**: Blocked — need a reliable calendar data source (see Data Source below)

Display upcoming economic events (CPI, FOMC, jobless claims, etc.) as markers on the chart. This is a **forward-looking calendar**, not a historical news feed. The primary value is seeing what events are coming up so the trader can plan around them.

---

## Key Requirement

**We need upcoming/future events, not just past articles.** RSS feeds from government sites (Fed, BLS) only publish after the fact — they are news, not a calendar. We need a source that provides scheduled event dates before they happen.

---

## Data Source (Unresolved)

We tried two approaches that didn't work well:

### Attempt 1: Government RSS Feeds
- Fed (`federalreserve.gov/feeds/press_monetary.xml`), BLS (`bls.gov/feed/cpi.rss`, `bls.gov/feed/bls_latest.rss`)
- **Problem**: These are historical — they publish articles *after* events happen. No future event dates.

### Attempt 2: Forex Factory Calendar Mirror
- `https://nfs.faireconomy.media/ff_calendar_thisweek.json`
- **Problem**: Only has current week data (no `nextweek` endpoint). Aggressive rate limiting (429s). Unofficial mirror that could disappear.

### What We Need
A data source that provides:
- **Scheduled future economic events** (at least 1-2 weeks ahead)
- **Event title** (e.g. "US Initial Jobless Claims")
- **Date + time** (UTC or with timezone)
- **Impact level** (high / medium / low)
- **Country filter** (USD only for now)
- Free or low-cost, reliable, JSON-friendly

### Attempt 3: Finnhub Free Tier
- `GET /api/v1/calendar/economic?from=...&to=...`
- **Problem**: Returns 403 on the free plan. Economic calendar is a paid-only endpoint. API key works fine for other endpoints (e.g. `/quote`), so this is a tier restriction, not a key issue.

### Candidates to Investigate
- ~~**Finnhub API**~~ — economic calendar is paid-only (confirmed)
- **Trading Economics API** — has a calendar, but paid
- **Investing.com calendar** — no official API, scraping is fragile
- **FXStreet calendar** — no official API
- **Myfxbook calendar** — has an unofficial JSON endpoint, reliability unknown
- **Self-hosted scraper** — scrape a calendar page on a schedule, store in our own DB
- **Manual JSON file** — maintain a static `calendar.json` updated weekly (low-tech but reliable)

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
