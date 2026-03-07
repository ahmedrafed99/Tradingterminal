# Feature: Economic News Events on Chart

**Status**: Planned

Visualize economic news events (CPI, Fed speeches, FOMC, jobless claims, etc.) as markers on the chart just above the time scale. Clicking a marker opens a tooltip with event details.

---

## UI Layout

```
┌──────────────────────────────────────────────────────────────┐
│                     Candlestick Chart                        │
│                                                              │
│   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
│   ░░░░░░░░░░░░  candles / drawings  ░░░░░░░░░░░░░░░░░░░░   │
│   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
│                                                              │
│  ── news markers row ─── ● ──────── ● ─── ● ────── ● ────  │  ← just above time scale
│  ─── time scale ─── 09:00 ── 10:00 ── 11:00 ── 12:00 ────  │
└──────────────────────────────────────────────────────────────┘

Marker legend:
  ●  Red (#ef5350)    — Fed / FOMC / Interest Rate
  ●  Orange (#f0a830) — CPI / Inflation
  ●  Blue (#2962ff)   — Employment / Jobless Claims
  ●  Gray (#787b86)   — Other economic indicators
```

### Tooltip (on marker click)

```
┌──────────────────────────────────┐
│  CPI: Consumer Price Index       │  ← title (text-xs, #d1d4dc)
│  Mar 12, 2026 08:30 ET          │  ← date  (text-[10px], #787b86)
│  Source: Bureau of Labor Stats   │  ← source (text-[10px], #787b86)
│  ───────────────────────────     │
│  Open ↗                         │  ← link to original (text-[10px], #2962ff)
└──────────────────────────────────┘
  bg-[#1e222d]  border border-[#2a2e39]
  shadow-[0_4px_24px_rgba(0,0,0,0.5)]
  fade-in transition
```

---

## Data Sources (RSS Feeds)

All feeds are official US government sources — free, no API key, no rate limits.

| Feed URL | Category | Color | Covers |
|----------|----------|-------|--------|
| `federalreserve.gov/feeds/press_monetary.xml` | `fed` | Red | FOMC meetings, interest rate decisions |
| `federalreserve.gov/feeds/s_t_powell.xml` | `fed` | Red | Powell speeches & statements |
| `federalreserve.gov/feeds/speeches.xml` | `fed` | Red | All Fed governor speeches |
| `bls.gov/feed/cpi.rss` | `inflation` | Orange | CPI, Core CPI releases |
| `bls.gov/feed/bls_latest.rss` | `employment` | Blue | Jobless claims, employment situation, durable goods, industrial production |

### Category → Color Mapping

```ts
const CATEGORY_COLORS: Record<string, string> = {
  fed:        '#ef5350',   // Loss/short semantic color
  inflation:  '#f0a830',   // Active accent
  employment: '#2962ff',   // Primary action
  other:      '#787b86',   // Muted text
};
```

All colors are existing design tokens — no new values introduced.

---

## Architecture

```
RSS Feeds (.gov)
       │
       ▼  (HTTPS fetch, server-side — avoids CORS)
┌──────────────────────────────────────┐
│  Backend: GET /news/economic         │
│                                      │
│  1. Check in-memory cache (30 min)   │
│  2. If stale → fetch all RSS feeds   │
│  3. Parse XML → normalize to JSON    │
│  4. Categorize by source URL         │
│  5. Cache result, return JSON        │
└──────────────┬───────────────────────┘
               │  JSON
               ▼
┌──────────────────────────────────────┐
│  Frontend: newsService.ts            │
│                                      │
│  • In-memory cache (30 min TTL)      │
│  • In-flight dedup (same as other    │
│    services)                         │
│  • Returns NewsEvent[]               │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Zustand slice: newsEvents           │
│                                      │
│  • newsEvents: NewsEvent[]           │
│  • newsVisible: boolean (toggle)     │
│  • setNewsEvents(events)             │
│  • toggleNewsVisible()               │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Chart: NewsEventsPrimitive          │
│  (ISeriesPrimitive on time scale)    │
│                                      │
│  • Renders colored dots above the    │
│    time scale for each event         │
│  • Hit-tests clicks on dots          │
│  • Shows/hides tooltip HTML overlay  │
└──────────────────────────────────────┘
```

---

## Backend

### Route: `GET /news/economic`

**File**: `backend/src/routes/newsRoutes.ts`

No authentication required — this endpoint fetches public RSS data, not exchange data.

```ts
// Route: GET /news/economic
// Response: { events: NewsEvent[] }

interface NewsEvent {
  id: string;           // hash of title + pubDate for dedup
  title: string;
  description: string;  // RSS <description>, truncated to 200 chars
  date: string;         // ISO 8601 UTC
  category: 'fed' | 'inflation' | 'employment' | 'other';
  source: string;       // human-readable: "Federal Reserve", "Bureau of Labor Statistics"
  link: string;         // original article URL
}
```

### RSS Fetch + Parse Logic

**File**: `backend/src/services/newsService.ts`

```
Feed URLs (hardcoded array)
  → Promise.allSettled (fetch all in parallel, don't fail on one)
  → Parse XML (use fast-xml-parser — zero-dependency XML parser)
  → Normalize each <item> to NewsEvent
  → Categorize by feed URL
  → Deduplicate by id
  → Sort by date descending
  → Cache in module-level Map with timestamp
```

**Caching**:
- Module-level `let cache: { events: NewsEvent[]; fetchedAt: number } | null`
- TTL: 30 minutes (RSS feeds update infrequently)
- Cache key: none needed — single endpoint, same data for all clients
- On cache miss: fetch all feeds with `Promise.allSettled`, parse, store

**Category assignment** — determined by which feed URL the item came from:

| Feed URL contains | Category |
|-------------------|----------|
| `federalreserve.gov` | `fed` |
| `bls.gov/feed/cpi` | `inflation` |
| `bls.gov` | `employment` |
| *(fallback)* | `other` |

### XML Parsing

Use `fast-xml-parser` (lightweight, no native deps). RSS 2.0 structure:

```xml
<rss>
  <channel>
    <item>
      <title>...</title>
      <link>...</link>
      <description>...</description>
      <pubDate>Wed, 12 Mar 2026 13:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>
```

Map each `<item>` to a `NewsEvent`. Generate `id` as a simple hash of `title + pubDate`.

### Mount

```ts
// backend/src/index.ts
import newsRoutes from './routes/newsRoutes';
app.use('/news', newsRoutes);
```

---

## Frontend

### Service: `newsService.ts`

**File**: `frontend/src/services/newsService.ts`

Follows the existing service pattern (axios via `api.ts`, in-flight dedup):

```ts
export const newsService = {
  async getEconomicNews(): Promise<NewsEvent[]> {
    // in-flight dedup + 30-min in-memory cache
    // GET /news/economic → res.data.events
  },
};
```

### Zustand Slice

Added to the combined store in `useStore.ts`:

```ts
// --- News slice ---
interface NewsState {
  newsEvents: NewsEvent[];
  newsVisible: boolean;
  disabledFeeds: string[];       // feed keys to hide (Phase 2 UI, but stored from day 1)
  hiddenKeywords: string[];      // title substrings to hide (Phase 2 UI, but stored from day 1)
  setNewsEvents: (events: NewsEvent[]) => void;
  toggleNewsVisible: () => void;
  toggleFeed: (feedKey: string) => void;
  addHiddenKeyword: (kw: string) => void;
  removeHiddenKeyword: (kw: string) => void;
}
```

- `newsVisible`, `disabledFeeds`, `hiddenKeywords` added to `partialize` → persisted to both `localStorage` and `backend/data/user-settings.json` via the existing dual-layer persistence (see `settings-persistence/`)
- `newsEvents` not persisted (fetched on load)

### Data Loading

News events are fetched once when the chart mounts (inside `useChartBars` or a dedicated `useNewsEvents` hook). No real-time subscription needed — RSS data is static/slow-changing.

```ts
// On chart mount:
newsService.getEconomicNews().then((events) => {
  useStore.getState().setNewsEvents(events);
});
```

Re-fetch on timeframe change is unnecessary — events are date-based, not bar-based.

### Chart Primitive: `NewsEventsPrimitive`

**File**: `frontend/src/components/chart/primitives/NewsEventsPrimitive.ts`

Implements `ISeriesPrimitive` from lightweight-charts. Attached to the candlestick series (same pattern as other primitives).

**Rendering approach**:

The primitive uses the `paneViews` or a dedicated time-axis view to draw small filled circles just above the time scale. Each circle is positioned using `timeScale.timeToCoordinate(event.date)`.

```
Primitive lifecycle:
  1. Receives NewsEvent[] from store
  2. updateAllViews() called by LWC on scroll/zoom
  3. renderer() maps visible events to pixel coordinates
  4. Draws filled circles (radius 4px) at (x, bottomOfPane - 8px)
  5. Color determined by event.category
```

**Hit testing**:

- On chart `click` event, check if click coordinates are within any marker's bounding box (circle center ± 6px)
- If hit → show tooltip HTML overlay at that position
- If miss → hide tooltip

**Tooltip overlay**:

- An absolutely-positioned HTML `<div>` appended to the chart's overlay container
- Same pattern as other HTML overlays (crosshair label, countdown)
- z-index: 25 (same level as countdown, below crosshair label)
- Positioned above the clicked marker
- Hidden on scroll, zoom, or clicking away

### Attachment Order

Insert after TradeZonePrimitive, before CountdownPrimitive:

```
1. VolumeProfilePrimitive
2. TradeZonePrimitive
3. NewsEventsPrimitive       ← new
4. CountdownPrimitive
5. DrawingsPrimitive
```

---

## Toggle Control

A small newspaper/calendar icon button in the chart toolbar to toggle `newsVisible` on/off. Uses the existing toolbar button pattern.

- Icon: newspaper or calendar icon (from existing icon set or inline SVG)
- Active state: `#f0a830` (active accent)
- Inactive state: `#787b86` (muted)
- Tooltip: "Economic News"

---

## Files

| File | Purpose |
|------|---------|
| `backend/src/routes/newsRoutes.ts` | Express route — `GET /news/economic` |
| `backend/src/services/newsService.ts` | RSS fetch, parse, cache, categorize |
| `frontend/src/services/newsService.ts` | HTTP client + in-memory cache |
| `frontend/src/types/news.ts` | `NewsEvent` interface |
| `frontend/src/components/chart/primitives/NewsEventsPrimitive.ts` | Chart primitive — markers + tooltip |
| `frontend/src/components/chart/hooks/useNewsEvents.ts` | Fetch on mount, push to store + primitive |
| `frontend/src/store/useStore.ts` | `NewsState` slice (newsEvents, newsVisible) |
| `frontend/src/components/chart/CandlestickChart.tsx` | Attach primitive, add ref |
| `frontend/src/components/chart/ChartToolbar.tsx` | Toggle button |

---

## Dependencies

| Package | Where | Why |
|---------|-------|-----|
| `fast-xml-parser` | backend | Parse RSS XML to JS objects (lightweight, no native deps) |

No new frontend dependencies needed.

---

## Edge Cases

| Case | Handling |
|------|----------|
| RSS feed temporarily down | `Promise.allSettled` — other feeds still load; failed feeds silently skipped |
| No events in visible range | No markers rendered, no errors |
| Events overlap at same time | Stack dots vertically (offset by 10px) or show count badge |
| Very old events (months ago) | Only show events from last 90 days (filter server-side) |
| Timezone | RSS dates parsed to UTC; chart maps to exchange session time |
| Dual-chart mode | Each chart instance gets its own primitive; both share the same store data |
| `newsVisible: false` | Primitive skips rendering entirely (early return in `updateAllViews`) |

---

## News Settings Panel (Phase 2)

A dedicated settings section accessible from the toolbar toggle button (long-press or right-click) or from the main Settings modal. Allows granular control over which news appears on the chart.

### UI Layout

```
┌─── Economic News Settings ──────────────────────────┐
│                                                      │
│  Show news on chart              [  toggle  ]        │
│                                                      │
│  ── Sources ──────────────────────────────────────   │
│  Federal Reserve (FOMC, rates)   [  toggle  ]  ●    │
│  Fed Speeches (Powell, govs)     [  toggle  ]  ●    │
│  CPI / Inflation (BLS)           [  toggle  ]  ●    │
│  Employment / Claims (BLS)       [  toggle  ]  ●    │
│                                                      │
│  ── Keyword Filters ─────────────────────────────   │
│  Hide events matching:                               │
│  ┌──────────────────────────────────────────┐       │
│  │  US Initial Jobless Claims          ✕    │       │
│  │  US Durable Goods                   ✕    │       │
│  └──────────────────────────────────────────┘       │
│  + Add keyword filter                                │
│                                                      │
└──────────────────────────────────────────────────────┘
  bg-[#1e222d]  border border-[#2a2e39]
```

### Zustand State

```ts
interface NewsSettingsState {
  newsVisible: boolean;                    // master toggle
  disabledFeeds: string[];                 // feed keys: 'fed_monetary', 'fed_speeches', 'cpi', 'employment'
  hiddenKeywords: string[];                // title substring matches: ["Jobless Claims", "Durable Goods"]
  toggleNewsVisible: () => void;
  toggleFeed: (feedKey: string) => void;
  addHiddenKeyword: (kw: string) => void;
  removeHiddenKeyword: (kw: string) => void;
}
```

All settings persisted via the existing Zustand `persist` middleware (`partialize`).

### Filtering Logic

Applied client-side in the `useNewsEvents` hook before passing events to the primitive:

```ts
const filtered = newsEvents.filter((e) => {
  if (disabledFeeds.includes(e.feedKey)) return false;
  if (hiddenKeywords.some((kw) => e.title.toLowerCase().includes(kw.toLowerCase()))) return false;
  return true;
});
```

This means the backend always returns all events — filtering is purely a frontend concern, keeping the API simple and cacheable.

### Design Decisions

- **Per-feed toggles** use the category color dot next to the toggle for visual clarity
- **Keyword filters** are case-insensitive substring matches — simple but effective
- **No regex** — keep it user-friendly; plain text keywords cover 99% of use cases
- The settings panel reuses the same modal/panel patterns as `BracketSettingsModal` and `SettingsModal`

### Additional Files (Phase 2)

| File | Purpose |
|------|---------|
| `frontend/src/components/chart/NewsSettingsPanel.tsx` | Settings UI component |

---

## Future Extensions

- **Additional feeds** — Trading Economics, WSJ Real Time Economics
- **Impact rating** — High/medium/low markers based on keyword matching (FOMC = high, speech = medium)
- **Countdown to next event** — "CPI in 2d 4h" tooltip on upcoming events
