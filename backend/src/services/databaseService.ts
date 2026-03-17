import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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

export function getDbPath(): string {
  return DB_PATH;
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
    console.log('[database] SQLite closed');
  }
}
