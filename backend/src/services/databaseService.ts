import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

// ---------------------------------------------------------------------------
// SQLite database for 1-minute candle storage
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'candles.db');

let db: Database.Database;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function init(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      contract_id  TEXT    NOT NULL,
      timestamp    INTEGER NOT NULL,
      open         REAL    NOT NULL,
      high         REAL    NOT NULL,
      low          REAL    NOT NULL,
      close        REAL    NOT NULL,
      volume       INTEGER NOT NULL,
      PRIMARY KEY (contract_id, timestamp)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_candles_time
      ON candles (contract_id, timestamp);
  `);

  console.log('[database] SQLite initialised →', DB_PATH);
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

export interface CandleRow {
  contract_id: string;
  timestamp: number; // Unix epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const insertStmt = () =>
  db.prepare(`
    INSERT OR IGNORE INTO candles (contract_id, timestamp, open, high, low, close, volume)
    VALUES (@contract_id, @timestamp, @open, @high, @low, @close, @volume)
  `);

export function insertCandles(candles: CandleRow[]): number {
  if (candles.length === 0) return 0;

  const stmt = insertStmt();
  const tx = db.transaction((rows: CandleRow[]) => {
    let inserted = 0;
    for (const row of rows) {
      const result = stmt.run(row);
      inserted += result.changes;
    }
    return inserted;
  });

  return tx(candles);
}

// ---------------------------------------------------------------------------
// Query — raw 1m candles
// ---------------------------------------------------------------------------

const MAX_CANDLE_ROWS = 50_000;

export function getCandles(
  contractId: string,
  fromEpoch: number,
  toEpoch: number,
): CandleRow[] {
  return db
    .prepare(
      `SELECT contract_id, timestamp, open, high, low, close, volume
       FROM candles
       WHERE contract_id = ? AND timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp
       LIMIT ?`,
    )
    .all(contractId, fromEpoch, toEpoch, MAX_CANDLE_ROWS) as CandleRow[];
}

// ---------------------------------------------------------------------------
// Query — aggregated candles (5m, 15m, 1h, 4h, 1d)
// ---------------------------------------------------------------------------

const TF_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

export interface AggregatedCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function getAggregatedCandles(
  contractId: string,
  fromEpoch: number,
  toEpoch: number,
  timeframe: string,
): AggregatedCandle[] {
  const seconds = TF_SECONDS[timeframe];
  if (!seconds) throw new Error(`Unsupported timeframe: ${timeframe}`);

  if (timeframe === '1m') {
    return getCandles(contractId, fromEpoch, toEpoch).map((c) => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
  }

  // Aggregate using first-open / last-close via subqueries
  const rows = db
    .prepare(
      `
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
      WHERE contract_id = @cid AND timestamp >= @from AND timestamp <= @to
      GROUP BY t
      ORDER BY t
      `,
    )
    .all({ cid: contractId, secs: seconds, from: fromEpoch, to: toEpoch }) as Array<{
    t: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;

  return rows.map((r) => ({
    timestamp: r.t,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

// ---------------------------------------------------------------------------
// Status / metadata
// ---------------------------------------------------------------------------

export interface ContractStatus {
  contractId: string;
  oldestBar: number;
  newestBar: number;
  totalBars: number;
}

export function getStatus(): {
  contracts: ContractStatus[];
  dbSizeBytes: number;
} {
  const contracts = db
    .prepare(
      `SELECT
        contract_id AS contractId,
        MIN(timestamp) AS oldestBar,
        MAX(timestamp) AS newestBar,
        COUNT(*) AS totalBars
       FROM candles
       GROUP BY contract_id
       ORDER BY contract_id`,
    )
    .all() as ContractStatus[];

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = fs.statSync(DB_PATH).size;
  } catch {
    // file may not exist yet
  }

  return { contracts, dbSizeBytes };
}

// ---------------------------------------------------------------------------
// Delete contract data
// ---------------------------------------------------------------------------

export function deleteContract(contractId: string): number {
  const result = db
    .prepare('DELETE FROM candles WHERE contract_id = ?')
    .run(contractId);
  return result.changes;
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 7; // keep last 7 auto-backups

/** Create a backup at the given destination path using SQLite online backup API. */
export async function backup(destPath: string): Promise<void> {
  await db.backup(destPath);
}

/** Auto-backup: saves a dated snapshot to data/backups/, rotates old ones. */
export async function autoBackup(): Promise<string | null> {
  // Skip if no data exists
  const { contracts } = getStatus();
  if (contracts.length === 0) return null;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `candles-${date}.db`;
  const destPath = path.join(BACKUP_DIR, filename);

  // Skip if today's backup already exists
  if (fs.existsSync(destPath)) return destPath;

  await db.backup(destPath);
  console.log(`[database] Auto-backup → ${destPath}`);
  pushToKaggle();

  // Rotate: delete oldest backups beyond MAX_BACKUPS
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('candles-') && f.endsWith('.db'))
    .sort()
    .reverse();

  for (const file of files.slice(MAX_BACKUPS)) {
    fs.unlinkSync(path.join(BACKUP_DIR, file));
    console.log(`[database] Rotated old backup: ${file}`);
  }

  return destPath;
}

/** Get the backup dir path (for manual backup destination). */
export function getBackupDir(): string {
  return BACKUP_DIR;
}

// project root is three levels up from backend/src/services/
const PYTHON_EXE = path.join(__dirname, '..', '..', '..', 'scripts', 'venv', 'Scripts', 'python.exe');
const KAGGLE_SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'backup_to_kaggle.py');

function pushToKaggle(): void {
  if (!fs.existsSync(PYTHON_EXE)) return;
  const proc = spawn(PYTHON_EXE, [KAGGLE_SCRIPT], { stdio: 'pipe' });
  proc.stdout.on('data', (d) => console.log('[kaggle]', d.toString().trim()));
  proc.stderr.on('data', (d) => console.error('[kaggle]', d.toString().trim()));
}

export function getDbPath(): string {
  return DB_PATH;
}

// ---------------------------------------------------------------------------
// Staging — for safer Kaggle imports
// ---------------------------------------------------------------------------

const STAGING_DIR = path.join(DATA_DIR, 'staging');
const STAGING_DB_PATH = path.join(STAGING_DIR, 'candles-from-kaggle.db');
const EXPECTED_COLUMNS = ['contract_id', 'timestamp', 'open', 'high', 'low', 'close', 'volume'];
const LIVE_TIMEFRAME_SECONDS = 60; // app schema is 1-minute candles only

export function getStagingDir(): string {
  return STAGING_DIR;
}

export function getStagingDbPath(): string {
  return STAGING_DB_PATH;
}

export interface StagedSummary {
  path: string;
  sizeBytes: number;
  timeframeSeconds: number | null;
  contracts: ContractStatus[];
}

export interface StagedValidation {
  valid: boolean;
  error?: string;
  summary?: StagedSummary;
}

export function inspectStaged(): StagedValidation {
  if (!fs.existsSync(STAGING_DB_PATH)) {
    return { valid: false, error: 'No staged file' };
  }

  let stagedDb: Database.Database;
  try {
    stagedDb = new Database(STAGING_DB_PATH, { readonly: true });
  } catch (err) {
    return {
      valid: false,
      error: `Cannot open staged file as SQLite: ${err instanceof Error ? err.message : err}`,
    };
  }

  try {
    const tableInfo = stagedDb.prepare("PRAGMA table_info('candles')").all() as Array<{
      name: string;
      type: string;
    }>;
    if (tableInfo.length === 0) {
      return { valid: false, error: 'Staged file has no `candles` table — not a candles database' };
    }
    const actualCols = new Set(tableInfo.map((c) => c.name));
    for (const col of EXPECTED_COLUMNS) {
      if (!actualCols.has(col)) {
        return { valid: false, error: `Staged DB schema missing column: ${col}` };
      }
    }

    const contracts = stagedDb
      .prepare(
        `SELECT contract_id AS contractId,
                MIN(timestamp) AS oldestBar,
                MAX(timestamp) AS newestBar,
                COUNT(*) AS totalBars
         FROM candles
         GROUP BY contract_id
         ORDER BY contract_id`,
      )
      .all() as ContractStatus[];

    const timeframeSeconds = detectStagedTimeframe(stagedDb);
    const sizeBytes = fs.statSync(STAGING_DB_PATH).size;

    return {
      valid: true,
      summary: { path: STAGING_DB_PATH, sizeBytes, timeframeSeconds, contracts },
    };
  } finally {
    stagedDb.close();
  }
}

function detectStagedTimeframe(stagedDb: Database.Database): number | null {
  // Sample the contract with the most rows; compute modal consecutive delta.
  const top = stagedDb
    .prepare(
      `SELECT contract_id FROM candles GROUP BY contract_id ORDER BY COUNT(*) DESC LIMIT 1`,
    )
    .get() as { contract_id: string } | undefined;
  if (!top) return null;

  const rows = stagedDb
    .prepare(
      `SELECT timestamp FROM candles WHERE contract_id = ? ORDER BY timestamp LIMIT 500`,
    )
    .all(top.contract_id) as Array<{ timestamp: number }>;
  if (rows.length < 2) return null;

  const deltaCount = new Map<number, number>();
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i].timestamp - rows[i - 1].timestamp;
    if (delta > 0) deltaCount.set(delta, (deltaCount.get(delta) || 0) + 1);
  }

  let modal = 0;
  let bestCount = 0;
  for (const [delta, count] of deltaCount) {
    if (count > bestCount) {
      bestCount = count;
      modal = delta;
    }
  }
  return modal || null;
}

export function describeTimeframe(seconds: number | null | undefined): string {
  if (!seconds) return 'unknown';
  if (seconds < 60) return `${seconds}-second`;
  if (seconds < 3600) return `${seconds / 60}-minute`;
  if (seconds < 86400) return `${seconds / 3600}-hour`;
  return `${seconds / 86400}-day`;
}

export interface OverlapEntry {
  contractId: string;
  count: number;
  firstTimestamp: number;
}

function withAttachedStaged<T>(stagedPath: string, fn: () => T): T {
  db.prepare(`ATTACH DATABASE ? AS staged`).run(stagedPath);
  try {
    return fn();
  } finally {
    db.prepare(`DETACH DATABASE staged`).run();
  }
}

export function detectStagedOverlap(stagedPath: string): OverlapEntry[] {
  return withAttachedStaged(stagedPath, () =>
    db
      .prepare(
        `SELECT s.contract_id AS contractId,
                COUNT(*) AS count,
                MIN(s.timestamp) AS firstTimestamp
         FROM staged.candles s
         INNER JOIN candles l
           ON l.contract_id = s.contract_id AND l.timestamp = s.timestamp
         GROUP BY s.contract_id
         ORDER BY s.contract_id`,
      )
      .all() as OverlapEntry[],
  );
}

export function mergeStaged(stagedPath: string): { merged: number } {
  return withAttachedStaged(stagedPath, () => {
    // Plain INSERT (no IGNORE) — caller has already verified there are no
    // overlaps; if one slipped in (race), failure is correct.
    const result = db
      .transaction(() =>
        db.prepare(
          `INSERT INTO candles (contract_id, timestamp, open, high, low, close, volume)
           SELECT contract_id, timestamp, open, high, low, close, volume FROM staged.candles`,
        ).run(),
      )();
    return { merged: Number(result.changes) };
  });
}

export function discardStaged(): boolean {
  if (fs.existsSync(STAGING_DB_PATH)) {
    fs.unlinkSync(STAGING_DB_PATH);
    return true;
  }
  return false;
}

export function liveTimeframeSeconds(): number {
  return LIVE_TIMEFRAME_SECONDS;
}

// ---------------------------------------------------------------------------
// Auto-backup scheduler
// ---------------------------------------------------------------------------

const AUTO_BACKUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
let autoBackupTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoBackup(): void {
  // Run once on startup (after a short delay)
  setTimeout(() => { autoBackup().catch((err) => {
    console.error('[database] Initial auto-backup failed:', err instanceof Error ? err.message : err);
  }); }, 5000);

  autoBackupTimer = setInterval(() => {
    autoBackup().catch((err) => {
      console.error('[database] Periodic auto-backup failed:', err instanceof Error ? err.message : err);
    });
  }, AUTO_BACKUP_INTERVAL);

  console.log('[database] Auto-backup enabled (daily, keep last 7)');
}

export function stopAutoBackup(): void {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Close
// ---------------------------------------------------------------------------

export function close(): void {
  stopAutoBackup();
  if (db) {
    db.close();
    db = undefined as unknown as Database.Database;
    console.log('[database] SQLite closed');
  }
}

