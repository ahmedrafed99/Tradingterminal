# Historical Data Database

Local SQLite database storing 1-minute candle data for offline analysis, backtesting, and AI-powered tools (chat bot, strategy evaluation).

**Status**: Steps 1–5 implemented and working. Chat bot integration (step 6) pending.

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

### Contract Rollover — Continuous Symbol Storage

Data is stored under **base symbols** (`NQ`, `ES`) rather than specific contract IDs (`CON.F.US.ENQ.H26`). This solves the quarterly rollover problem — all contract months merge into one continuous series.

**Mapping** (in `backfillService.ts`):

| Product Code | Base Symbol |
|-------------|-------------|
| `ENQ` | `NQ` |
| `EP` | `ES` |
| `MNQ` | `MNQ` |
| `MES` | `MES` |

When the backfill service fetches bars from `CON.F.US.ENQ.H26`, it stores them under `contract_id = 'NQ'`. When H26 expires and the user rolls to M26, new fetches continue appending to `NQ` seamlessly.

**Key finding**: The ProjectX API does **not** serve bars for expired contracts. Data must be captured while the contract is still active. Historical data was backfilled from a purchased CSV (FirstRate Data / BacktestMarket).

### Approximate Storage

| Duration | Bars (~1,380/day) | DB Size |
|----------|-------------------|---------|
| 1 month  | ~30K              | ~2 MB   |
| 6 months | ~180K             | ~12 MB  |
| 1 year   | ~360K             | ~24 MB  |
| 17 years | ~5.8M             | ~400 MB |

---

## Data Ingestion

### CSV Import (Historical Backfill)

For bulk historical data, use the import script:

```bash
cd backend
npx tsx scripts/import-csv.ts NQ ../nq-1m_bk.csv
```

CSV format (semicolon-delimited, no header):
```
DD/MM/YYYY;HH:MM;Open;High;Low;Close;Volume
```

The script streams the file, batch-inserts 50K rows at a time in transactions, and reports progress.

### Auto-Sync (Primary)

The backend automatically syncs every **30 minutes**:

1. Checks which symbols exist in the database (e.g. `NQ`)
2. Reverse-maps to product code (`NQ` → `ENQ`)
3. Searches the API for the active contract (`CON.F.US.ENQ.H26`)
4. Fetches bars from the newest stored timestamp to now
5. Stores under the base symbol (`NQ`)

Logs: `[auto-sync] Syncing NQ via CON.F.US.ENQ.H26` / `[auto-sync] NQ: +45 bars`

Auto-sync starts on backend boot (10s delay for auth) and runs every 30 minutes. It skips if:
- Not connected to the exchange
- A manual sync/fetch is already running

**Contract rollover resilience**: If no contract has the `activeContract` flag set (can happen briefly during quarterly rollovers), the resolver falls back to the latest contract alphabetically (e.g. `M26` > `H26`). All resolution failures are logged with `[auto-sync]` prefix.

### Manual Sync

A "Sync Now" button in the Database settings tab triggers an immediate sync. Uses the same logic as auto-sync.

### Pagination Strategy

The ProjectX API returns bars in **descending order** (newest first). Pagination works backward from the end date:

```
Backend paginates backward:
  Page 1: startTime=last_stored, endTime=now → up to 20K bars → insert
  Page 2: (if needed) → continue backward → insert
  ...

Each page: POST /api/History/retrieveBars with limit=20000
Insert: BEGIN TRANSACTION → INSERT OR IGNORE batch → COMMIT
Delay between pages: ~500ms (avoid API rate limiting)
```

---

## Backend API

All endpoints are under `/database`. Fetch operations require an active exchange connection.

### `GET /database/status`

Returns the current state of stored data.

```json
{
  "contracts": [
    {
      "contractId": "NQ",
      "oldestBar": 1228959480,
      "newestBar": 1773075420,
      "totalBars": 5778958
    }
  ],
  "dbSizeBytes": 418697216
}
```

Timestamps are Unix epoch seconds. Frontend formats them for display.

### `POST /database/fetch`

Start a fetch job. Runs in the background on the backend — returns immediately.

```json
// Sync (from latest stored bar to now)
{ "contractId": "CON.F.US.ENQ.H26", "mode": "sync" }
```

The backfill service maps `CON.F.US.ENQ.H26` → `NQ` for storage automatically.

Response:

```json
{ "jobId": "fetch_1773067836999_1", "estimatedPages": 1 }
```

### `GET /database/fetch/progress`

Poll for active fetch job status.

```json
{
  "jobId": "fetch_1773067836999_1",
  "status": "running",
  "pagesCompleted": 1,
  "pagesTotal": 1,
  "barsInserted": 45,
  "currentTimestamp": "2026-03-09T12:00:00+00:00",
  "errorMessage": null
}
```

Status values: `running` | `completed` | `failed` | `cancelled` | `idle`

### `POST /database/fetch/cancel`

Cancel a running fetch job. The job stops after the current page completes.

### `GET /database/candles`

Query stored candles. Used by chat bot, backtesting, and any future analysis feature.

```
GET /database/candles?contractId=NQ&from=2025-12-01T00:00:00Z&to=2025-12-31T00:00:00Z&timeframe=1m
```

| Param        | Required | Description |
|--------------|----------|-------------|
| `contractId` | Yes      | Symbol to query (e.g. `NQ`) |
| `from`       | Yes      | Start of range (ISO 8601) |
| `to`         | Yes      | End of range (ISO 8601) |
| `timeframe`  | No       | `1m` (default), `5m`, `15m`, `1h`, `4h`, `1d` |

For timeframes above 1m, the backend aggregates on-the-fly using subqueries for correct first-open/last-close.

### `DELETE /database/contracts/:id`

Delete all stored data for a symbol. Returns `{ "deleted": <row count> }`.

---

## Frontend — Database Settings Tab

A tab in the Settings modal alongside the API credentials tab.

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  Settings                                           [✕]  │
│  API   Database   Sound                                  │
│        ────────                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  STORED DATA                                  399.3 MB   │
│  ┌────────────────────────────────────────────────────┐  │
│  │ NQ                                            [✕]  │  │
│  │ Dec 11, 2008 — Mar 9, 2026 · 5,778,958 bars       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  SYNC                          Auto-sync every 30 min    │
│  [ Sync Now ]                                            │
│                                                          │
│  BACKUP                    Auto-backup daily · last 7    │
│  Save to directory: [____________________] [Save Backup] │
│  Or download to browser →                                │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Sections are separated by 28px vertical gap (no explicit dividers). Delete button appears on row hover only. Buttons use soft accent style (`bg-(--color-accent)/20`).

### Behavior

- **Sync Now**: triggers an immediate sync using the current active contract
- **Auto-sync**: runs every 30 minutes in the background, no user action needed
- **Cancel**: stops after current page (only visible during sync)
- **Status section**: refreshes on mount and after each completed job
- Delete button (✕) per symbol in the status section

---

## File Structure

```
backend/
  src/
    routes/
      databaseRoutes.ts       -- Express routes for /database/*
    services/
      databaseService.ts      -- SQLite init, insert, query, aggregation
      backfillService.ts      -- Pagination, job management, auto-sync, symbol mapping
  scripts/
    import-csv.ts             -- Bulk CSV import for historical data
    merge-contract.ts         -- Merge per-contract data into base symbol
  data/
    candles.db                -- SQLite file (gitignored)

frontend/
  src/
    components/
      SettingsModal.tsx        -- Refactored: API and Database tabs
      settings/
        DatabaseTab.tsx        -- Database tab UI (sync + backup)
    services/
      databaseService.ts      -- Frontend API client for /database/* endpoints
  vite.config.ts              -- Added /database proxy entry
```

---

## Implementation Order

1. ~~**SQLite setup** — `better-sqlite3`, schema creation, insert/query functions~~
2. ~~**Backfill service** — paginated fetch from ProjectX API, job tracking~~
3. ~~**Backend routes** — `/database/status`, `/database/fetch`, `/database/candles`~~
4. ~~**Frontend Database tab** — status display, fetch controls, progress bar~~
5. ~~**Contract rollover** — continuous symbol storage, auto-sync, CSV import~~
6. **Wire up chat bot** — update `get_bars` tool to read from database when available

---

## Open Questions

- **Rate limiting**: ProjectX API rate limits are undocumented. Start conservative (500ms between pages) and adjust based on observed behavior (429 responses).
- **Gap detection**: Trading hours have natural gaps (weekends, holidays, CME maintenance). These aren't data gaps — need to distinguish from actual missing data. Not critical for v1.
