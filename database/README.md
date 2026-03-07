# Historical Data Database

Local SQLite database storing 1-minute candle data for offline analysis, backtesting, and AI-powered tools (chat bot, strategy evaluation).

---

## Why

The ProjectX API serves bars on-demand with a 20K bar limit per request and no persistence. Every chart load re-fetches the same data, and there's no way to run analysis across weeks or months of history. This feature adds a local database so the app accumulates data over time and any future feature (chat bot, backtesting, pattern detection) has a rich historical dataset to work with.

---

## Storage

### Technology

**SQLite** via `better-sqlite3` (synchronous, fast, zero-config).

- Single file: `backend/data/candles.db`
- No separate server process
- Handles millions of rows comfortably
- `better-sqlite3` is synchronous but non-blocking for the event loop on reads; bulk inserts use transactions for speed

### Schema

```sql
CREATE TABLE candles (
  contract_id  TEXT    NOT NULL,
  timestamp    INTEGER NOT NULL,   -- Unix epoch seconds (UTC)
  open         REAL    NOT NULL,
  high         REAL    NOT NULL,
  low          REAL    NOT NULL,
  close        REAL    NOT NULL,
  volume       INTEGER NOT NULL,
  PRIMARY KEY (contract_id, timestamp)
) WITHOUT ROWID;

-- Fast range queries
CREATE INDEX idx_candles_time ON candles (contract_id, timestamp);
```

- **1-minute candles only** — the atomic unit. Higher timeframes (5m, 15m, 1h, 1D) are aggregated at query time.
- `WITHOUT ROWID` — clustered on the primary key for fast range scans.
- `INSERT OR IGNORE` for all writes — idempotent, safe to re-fetch overlapping ranges.

### Approximate Storage

| Duration | Bars (~1,380/day) | DB Size |
|----------|-------------------|---------|
| 1 month  | ~30K              | ~2 MB   |
| 6 months | ~180K             | ~12 MB  |
| 1 year   | ~360K             | ~24 MB  |

Per contract. Negligible disk usage.

---

## Data Ingestion

### Manual Fetch (Primary)

All fetches are triggered manually from the Database Settings tab. Two modes:

1. **Quick Sync** — Fetches from the latest stored timestamp to now. One click to stay current.
2. **Custom Range** — User picks a start and end date. Fetches all 1-min bars in that window.

Both modes paginate internally: the backend splits the range into chunks, fetches up to 20K bars per ProjectX API call, and inserts into SQLite. Progress is reported to the frontend via polling or SSE.

### Pagination Strategy

```
User requests: 2025-01-01 to 2025-03-01 (59 days, ~81K bars)

Backend splits into pages:
  Page 1: 2025-01-01 → fetch 20K bars → insert → last bar timestamp = 2025-01-15T03:22:00Z
  Page 2: 2025-01-15T03:23:00Z → fetch 20K bars → insert → ...
  Page 3: ...
  Page 4: ... → reaches 2025-03-01 → done

Each page: POST /api/History/retrieveBars with limit=20000
Insert: BEGIN TRANSACTION → INSERT OR IGNORE batch → COMMIT
Delay between pages: ~500ms (avoid API rate limiting)
```

### Real-Time Capture (Future)

Hook into the existing SignalR market hub to insert each completed 1-min bar as it closes. This keeps the database current without manual syncing. Not in scope for the initial build — Quick Sync covers this gap easily.

---

## Backend API

All endpoints are behind the existing auth check (must be connected).

### `GET /database/status`

Returns the current state of stored data.

```json
{
  "contracts": [
    {
      "contractId": "CON.F.US.ENQ.H26",
      "label": "MNQ Mar 2026",
      "oldestBar": "2025-09-15T08:30:00Z",
      "newestBar": "2026-03-06T20:59:00Z",
      "totalBars": 182400,
      "gaps": 2
    }
  ],
  "dbSizeBytes": 12582912,
  "fetching": false
}
```

### `POST /database/fetch`

Start a fetch job. Runs in the background on the backend — returns immediately.

```json
// Quick Sync (from latest stored bar to now)
{ "contractId": "CON.F.US.ENQ.H26", "mode": "sync" }

// Custom Range
{ "contractId": "CON.F.US.ENQ.H26", "mode": "range", "startTime": "2025-01-01T00:00:00Z", "endTime": "2025-03-01T00:00:00Z" }
```

Response:

```json
{ "jobId": "abc123", "estimatedPages": 5 }
```

### `GET /database/fetch/progress`

Poll for active fetch job status.

```json
{
  "jobId": "abc123",
  "status": "running",
  "pagesCompleted": 3,
  "pagesTotal": 5,
  "barsInserted": 58200,
  "currentTimestamp": "2025-02-12T14:30:00Z"
}
```

Status values: `running` | `completed` | `failed` | `idle`

### `POST /database/fetch/cancel`

Cancel a running fetch job. The job stops after the current page completes.

### `GET /database/candles`

Query stored candles. Used by chat bot, backtesting, and any future analysis feature.

```
GET /database/candles?contractId=CON.F.US.ENQ.H26&from=2025-02-01T00:00:00Z&to=2025-02-07T00:00:00Z&timeframe=1m
```

| Param        | Required | Description |
|--------------|----------|-------------|
| `contractId` | Yes      | Contract to query |
| `from`       | Yes      | Start of range (ISO 8601) |
| `to`         | Yes      | End of range (ISO 8601) |
| `timeframe`  | No       | `1m` (default), `5m`, `15m`, `1h`, `4h`, `1d` |

For timeframes above 1m, the backend aggregates on-the-fly:

```sql
-- Example: 5m aggregation
SELECT
  (timestamp / 300) * 300 AS t,
  MIN(open) AS open,   -- first open in group (use subquery for actual first)
  MAX(high) AS high,
  MIN(low)  AS low,
  MAX(close) AS close,  -- last close in group (use subquery for actual last)
  SUM(volume) AS volume
FROM candles
WHERE contract_id = ? AND timestamp BETWEEN ? AND ?
GROUP BY t
ORDER BY t;
```

(Actual implementation uses window functions or subqueries for correct first-open/last-close.)

---

## Frontend — Database Settings Tab

A new tab in the Settings modal (alongside the existing API credentials tab).

### Layout

```
+---------------------------------------------------------------+
|  Settings                                              [X]     |
|  [ API ]  [ Database ]                                         |
+---------------------------------------------------------------+
|                                                                 |
|  DATABASE STATUS                                                |
|  Size: 12.4 MB                                                  |
|                                                                 |
|  +---------------------------------------------------------+   |
|  | Contract       | From         | To           | Bars     |   |
|  |----------------|--------------|--------------|----------|   |
|  | MNQ Mar 2026   | Sep 15, 2025 | Mar 06, 2026 | 182,400  |   |
|  +---------------------------------------------------------+   |
|                                                                 |
|  QUICK SYNC                                                     |
|  Contract: [ MNQ Mar 2026  v ]                                  |
|  [ Sync to Latest ]                                             |
|                                                                 |
|  CUSTOM FETCH                                                   |
|  Contract: [ MNQ Mar 2026  v ]                                  |
|  From: [ 2025-01-01 ]   To: [ 2025-03-01 ]                     |
|  [ Fetch ]                                                      |
|                                                                 |
|  PROGRESS                              (visible when fetching)  |
|  [=========>              ] 3 / 5 pages  (58,200 bars)          |
|  [ Cancel ]                                                     |
|                                                                 |
+---------------------------------------------------------------+
```

### Contract Selector

Populated from the contracts the user has already loaded in the app (available contracts list). Default: the currently active chart contract.

### Behavior

- **Sync to Latest**: disabled if no data exists yet for that contract (use Custom Fetch first)
- **Fetch button**: starts the job, shows progress bar
- **Cancel**: stops after current page
- **Status table**: auto-refreshes when the tab is open
- All buttons disabled while a fetch is in progress

---

## File Structure

```
backend/
  src/
    routes/
      databaseRoutes.ts       -- Express routes for /database/*
    services/
      databaseService.ts      -- SQLite init, insert, query, aggregation
      backfillService.ts      -- Pagination logic, job management, progress tracking
  data/
    candles.db                -- SQLite file (gitignored)

frontend/
  src/
    components/
      settings/
        DatabaseTab.tsx       -- Settings tab UI
    services/
      databaseService.ts      -- Frontend API client for /database/* endpoints
```

---

## Implementation Order

1. **SQLite setup** — `better-sqlite3`, schema creation, insert/query functions
2. **Backfill service** — paginated fetch from ProjectX API, job tracking
3. **Backend routes** — `/database/status`, `/database/fetch`, `/database/candles`
4. **Frontend Database tab** — status display, contract selector, fetch controls, progress bar
5. **Wire up chat bot** — update `get_bars` tool to read from database when available

---

## Open Questions

- **Rate limiting**: ProjectX API rate limits are undocumented. Start conservative (500ms between pages) and adjust based on observed behavior (429 responses).
- **Contract rollovers**: Futures contracts expire. Data for `ENQ.H26` becomes useless after March 2026. May need a strategy for continuous contracts later (map old front-month to new).
- **Gap detection**: Trading hours have natural gaps (weekends, holidays, CME maintenance). These aren't data gaps — need to distinguish from actual missing data. Not critical for v1.
