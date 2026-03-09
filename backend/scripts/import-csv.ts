/**
 * Import continuous futures CSV data into the candles SQLite database.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/import-csv.ts <symbol> <csv-path>
 *
 * Example:
 *   npx tsx scripts/import-csv.ts NQ ../nq-1m_bk.csv
 *
 * CSV format (semicolon-delimited, no header):
 *   DD/MM/YYYY;HH:MM;Open;High;Low;Close;Volume
 */

import fs from 'fs';
import readline from 'readline';
import path from 'path';
import Database from 'better-sqlite3';

const BATCH_SIZE = 50_000;

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseRow(line: string, contractId: string) {
  const parts = line.split(';');
  if (parts.length < 7) return null;

  const [dateStr, timeStr, o, h, l, c, v] = parts;

  // DD/MM/YYYY → parts
  const [day, month, year] = dateStr.split('/');
  // HH:MM
  const [hour, min] = timeStr.split(':');

  const dt = new Date(
    Date.UTC(+year, +month - 1, +day, +hour, +min, 0),
  );
  const timestamp = Math.floor(dt.getTime() / 1000);

  if (isNaN(timestamp)) return null;

  return {
    contract_id: contractId,
    timestamp,
    open: +o,
    high: +h,
    low: +l,
    close: +c,
    volume: +v,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [, , symbol, csvPath] = process.argv;

  if (!symbol || !csvPath) {
    console.error('Usage: npx tsx scripts/import-csv.ts <symbol> <csv-path>');
    console.error('Example: npx tsx scripts/import-csv.ts NQ ../nq-1m_bk.csv');
    process.exit(1);
  }

  const resolvedCsv = path.resolve(csvPath);
  if (!fs.existsSync(resolvedCsv)) {
    console.error(`File not found: ${resolvedCsv}`);
    process.exit(1);
  }

  const contractId = symbol.toUpperCase();

  // Open database
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'candles.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Ensure table exists
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

  const insert = db.prepare(`
    INSERT OR IGNORE INTO candles (contract_id, timestamp, open, high, low, close, volume)
    VALUES (@contract_id, @timestamp, @open, @high, @low, @close, @volume)
  `);

  const insertBatch = db.transaction(
    (rows: ReturnType<typeof parseRow>[]) => {
      let count = 0;
      for (const row of rows) {
        if (!row) continue;
        const r = insert.run(row);
        count += r.changes;
      }
      return count;
    },
  );

  // Stream the CSV
  const fileStream = fs.createReadStream(resolvedCsv, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch: ReturnType<typeof parseRow>[] = [];
  let totalLines = 0;
  let totalInserted = 0;
  const startTime = Date.now();

  console.log(`\n  Importing ${resolvedCsv}`);
  console.log(`  Symbol:  ${contractId}`);
  console.log(`  DB:      ${dbPath}\n`);

  for await (const line of rl) {
    if (!line.trim()) continue;

    batch.push(parseRow(line, contractId));
    totalLines++;

    if (batch.length >= BATCH_SIZE) {
      const inserted = insertBatch(batch);
      totalInserted += inserted;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = Math.round(totalLines / +elapsed);
      process.stdout.write(
        `\r  ${totalLines.toLocaleString()} rows read | ${totalInserted.toLocaleString()} inserted | ${elapsed}s | ${rate.toLocaleString()}/s`,
      );
      batch = [];
    }
  }

  // Final batch
  if (batch.length > 0) {
    const inserted = insertBatch(batch);
    totalInserted += inserted;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Get date range of what we inserted
  const range = db
    .prepare(
      `SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest, COUNT(*) as total
       FROM candles WHERE contract_id = ?`,
    )
    .get(contractId) as { oldest: number; newest: number; total: number };

  const oldest = new Date(range.oldest * 1000).toISOString().slice(0, 10);
  const newest = new Date(range.newest * 1000).toISOString().slice(0, 10);

  console.log(`\n\n  Done in ${elapsed}s`);
  console.log(`  Lines read:    ${totalLines.toLocaleString()}`);
  console.log(`  Rows inserted: ${totalInserted.toLocaleString()}`);
  console.log(`  Total in DB:   ${range.total.toLocaleString()} bars for ${contractId}`);
  console.log(`  Range:         ${oldest} → ${newest}\n`);

  db.close();
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
