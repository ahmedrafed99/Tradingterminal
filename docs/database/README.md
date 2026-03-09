# Historical Data Database

Local SQLite database storing 1-minute candle data for offline analysis, backtesting, and AI-powered tools (chat bot, strategy evaluation).

**Status**: Steps 1–4 implemented and working. Chat bot integration (step 5) pending.

---

## Why

The ProjectX API serves bars on-demand with a 20K bar limit per request and no persistence. Every chart load re-fetches the same data, and there's no way to run analysis across weeks or months of history. This feature adds a local database so the app accumulates data over time and any future feature (chat bot, backtesting, pattern detection) has a rich historical dataset to work with.

---

## Storage

### Technology

**SQLite** via `better-sqlite3` (synchronous, fast, zero-config). Runs embedded inside the Express backend — no separate server or process.

- Single file: `backend/data/candles.db`
- No separate server process
- Handles millions of rows comfortably
- `better-sqlite3` is synchronous but non-blocking for the event loop on reads; bulk inserts use transactions for speed
- WAL mode + NORMAL synchronous for performance

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

All fetches are triggered manually from the Database tab in Settings. Two modes:

1. **Quick Sync** — Fetches from the latest stored timestamp to now. One click to stay current.
2. **Custom Range** — User picks a start and end date. Fetches all 1-min bars in that window.

Both modes paginate internally: the backend splits the range into chunks, fetches up to 20K bars per ProjectX API call, and inserts into SQLite. Progress is reported to the frontend via polling (1.5s interval).

### Pagination Strategy

The ProjectX API returns bars in **descending order** (newest first). Pagination works backward from the end date:

```
User requests: 2026-01-01 to 2026-03-09 (~56K bars)

Backend paginates backward:
  Page 1: startTime=Jan 1, endTime=Mar 9 → 20K newest bars → insert → oldest = Feb 16
  Page 2: startTime=Jan 1, endTime=Feb 15 → 20K bars → insert → oldest = Jan 25
  Page 3: startTime=Jan 1, endTime=Jan 24 → 16K bars (< 20K limit) → insert → done

Each page: POST /api/History/retrieveBars with limit=20000
Insert: BEGIN TRANSACTION → INSERT OR IGNORE batch → COMMIT
Delay between pages: ~500ms (avoid API rate limiting)
End cursor moves backward by 1 minute after each page.
```

### Real-Time Capture (Future)

Hook into the existing SignalR market hub to insert each completed 1-min bar as it closes. This keeps the database current without manual syncing. Not in scope for the initial build — Quick Sync covers this gap easily.

---

## Backend API

All endpoints are under `/database`. Fetch operations require an active exchange connection.

### `GET /database/status`

Returns the current state of stored data.

```json
{
  "contracts": [
    {
      "contractId": "CON.F.US.ENQ.H26",
      "oldestBar": 1767884100,
      "newestBar": 1773014340,
      "totalBars": 56638
    }
  ],
  "dbSizeBytes": 6828032
}
```

Timestamps are Unix epoch seconds. Frontend formats them for display.

### `POST /database/fetch`

Start a fetch job. Runs in the background on the backend — returns immediately.

```json
// Quick Sync (from latest stored bar to now)
{ "contractId": "CON.F.US.ENQ.H26", "mode": "sync" }

// Custom Range
{ "contractId": "CON.F.US.ENQ.H26", "mode": "range", "startTime": "2026-01-01T00:00:00Z", "endTime": "2026-03-09T00:00:00Z" }
```

Response:

```json
{ "jobId": "fetch_1773067836999_1", "estimatedPages": 3 }
```

### `GET /database/fetch/progress`

Poll for active fetch job status.

```json
{
  "jobId": "fetch_1773067836999_1",
  "status": "running",
  "pagesCompleted": 2,
  "pagesTotal": 3,
  "barsInserted": 40000,
  "currentTimestamp": "2026-01-25T12:00:00+00:00",
  "errorMessage": null
}
```

Status values: `running` | `completed` | `failed` | `cancelled` | `idle`

### `POST /database/fetch/cancel`

Cancel a running fetch job. The job stops after the current page completes.

### `GET /database/candles`

Query stored candles. Used by chat bot, backtesting, and any future analysis feature.

```
GET /database/candles?contractId=CON.F.US.ENQ.H26&from=2026-02-01T00:00:00Z&to=2026-02-07T00:00:00Z&timeframe=1m
```

| Param        | Required | Description |
|--------------|----------|-------------|
| `contractId` | Yes      | Contract to query |
| `from`       | Yes      | Start of range (ISO 8601) |
| `to`         | Yes      | End of range (ISO 8601) |
| `timeframe`  | No       | `1m` (default), `5m`, `15m`, `1h`, `4h`, `1d` |

For timeframes above 1m, the backend aggregates on-the-fly using subqueries for correct first-open/last-close:

```sql
SELECT
  (timestamp / @secs) * @secs AS t,
  (SELECT c2.open FROM candles c2
   WHERE c2.contract_id = @cid
     AND (c2.timestamp / @secs) * @secs = (c.timestamp / @secs) * @secs
   ORDER BY c2.timestamp ASC LIMIT 1) AS open,
  MAX(high) AS high,
  MIN(low) AS low,
  (SELECT c3.close FROM candles c3
   WHERE c3.contract_id = @cid
     AND (c3.timestamp / @secs) * @secs = (c.timestamp / @secs) * @secs
   ORDER BY c3.timestamp DESC LIMIT 1) AS close,
  SUM(volume) AS volume
FROM candles c
WHERE contract_id = @cid AND timestamp BETWEEN @from AND @to
GROUP BY t ORDER BY t;
```

### `DELETE /database/contracts/:id`

Delete all stored data for a contract. Returns `{ "deleted": <row count> }`.

---

## Frontend — Database Settings Tab

A tab in the Settings modal alongside the API credentials tab.

### Layout

```
+---------------------------------------------------------------+
|  [ API ]  [ Database ]                                  [X]    |
+---------------------------------------------------------------+
|                                                                 |
|  STORED DATA                                        6.5 MB     |
|  ┌─────────────────────────────────────────────────────────┐   |
|  │ CON.F.US.ENQ.H26                                    ✕   │   |
|  │ Jan 8, 2026 — Mar 9, 2026 · 56,638 bars                │   |
|  └─────────────────────────────────────────────────────────┘   |
|                                                                 |
|  ─────────────────────────────────────────────────────────     |
|                                                                 |
|  FETCH DATA                                                     |
|  Contract: [ NQH6                                    v ]        |
|  From: [ 01/01/2026 ]     To: [ 03/09/2026 ]                   |
|  [ Fetch Range ]  Sync to Latest                                |
|                                                                 |
|  PROGRESS                                        Completed     |
|  [████████████████████████████████████████████████████████]     |
|  3 / 3 pages                            56,638 bars inserted   |
|                                                                 |
+---------------------------------------------------------------+
```

### Contract Selector

Populated from contracts the user has loaded in the app (active chart contract, second chart, order panel). Default: the currently active chart contract.

### Behavior

- **Sync to Latest**: disabled if no data exists yet for that contract (use Fetch Range first)
- **Fetch Range**: starts the job, shows progress bar. Frontend polls every 1.5s.
- **Cancel**: stops after current page
- **Status section**: refreshes on mount and after each completed job
- All buttons disabled while a fetch is in progress
- Delete button (✕) per contract in the status section

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
      SettingsModal.tsx        -- Refactored: API and Database tabs
      settings/
        DatabaseTab.tsx        -- Database tab UI
    services/
      databaseService.ts      -- Frontend API client for /database/* endpoints
  vite.config.ts              -- Added /database proxy entry
```

---

## Implementation Order

1. ~~**SQLite setup** — `better-sqlite3`, schema creation, insert/query functions~~
2. ~~**Backfill service** — paginated fetch from ProjectX API, job tracking~~
3. ~~**Backend routes** — `/database/status`, `/database/fetch`, `/database/candles`~~
4. ~~**Frontend Database tab** — status display, contract selector, fetch controls, progress bar~~
5. **Wire up chat bot** — update `get_bars` tool to read from database when available

---

## Contract Rollover Strategy (Future)

Not in v1 scope, but the schema should not paint us into a corner.

### Problem

Futures contracts expire quarterly. Data stored under `CON.F.US.ENQ.H26` becomes historical after March 2026. When the user rolls to `ENQ.M26` (June), they start with zero history for the new contract and can't view a continuous price series across rollovers.

### Planned Approach

Introduce a **symbol layer** that maps a continuous symbol (e.g. `MNQ`) to whichever contract was the front-month at any point in time:

```
symbols table (future)
  symbol        TEXT  -- "MNQ", "ES", "NQ"
  contract_id   TEXT  -- "CON.F.US.ENQ.H26"
  active_from   TEXT  -- "2025-12-19" (rollover date)
  active_to     TEXT  -- "2026-03-20"
```

Query flow: `SELECT contract_id FROM symbols WHERE symbol = ? AND date BETWEEN active_from AND active_to`, then join against `candles`. This lets analysis tools query "6 months of MNQ" spanning multiple contracts seamlessly.

The current `candles` table schema (keyed on `contract_id + timestamp`) already supports this — no migration needed. The symbol mapping is purely additive.

### When to Build

When the first contract the user has data for expires and they roll to the next front-month. Until then, single-contract storage works fine.

---

## Open Questions

- **Rate limiting**: ProjectX API rate limits are undocumented. Start conservative (500ms between pages) and adjust based on observed behavior (429 responses).
- **Gap detection**: Trading hours have natural gaps (weekends, holidays, CME maintenance). These aren't data gaps — need to distinguish from actual missing data. Not critical for v1.
