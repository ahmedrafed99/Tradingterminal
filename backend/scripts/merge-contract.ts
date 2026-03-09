/**
 * Merge a specific contract's candle data into a base symbol.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/merge-contract.ts <from-contract-id> <to-symbol>
 *
 * Example:
 *   npx tsx scripts/merge-contract.ts CON.F.US.ENQ.H26 NQ
 */

import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(__dirname, '..', 'data', 'candles.db');
const db = new Database(dbPath);

const [, , fromId, toSymbol] = process.argv;

if (!fromId || !toSymbol) {
  console.error('Usage: npx tsx scripts/merge-contract.ts <from-contract-id> <to-symbol>');
  process.exit(1);
}

console.log(`\n  Merging "${fromId}" → "${toSymbol}"`);

// Count before
const before = db
  .prepare('SELECT COUNT(*) as n FROM candles WHERE contract_id = ?')
  .get(fromId) as { n: number };

console.log(`  Rows to merge: ${before.n.toLocaleString()}`);

if (before.n === 0) {
  console.log('  Nothing to merge.\n');
  process.exit(0);
}

// INSERT OR IGNORE — keeps existing rows in the target, adds new ones
const merged = db
  .prepare(
    `INSERT OR IGNORE INTO candles (contract_id, timestamp, open, high, low, close, volume)
     SELECT ?, timestamp, open, high, low, close, volume
     FROM candles WHERE contract_id = ?`,
  )
  .run(toSymbol, fromId);

console.log(`  Inserted: ${merged.changes.toLocaleString()} new rows into "${toSymbol}"`);

// Delete the old contract
const deleted = db
  .prepare('DELETE FROM candles WHERE contract_id = ?')
  .run(fromId);

console.log(`  Deleted:  ${deleted.changes.toLocaleString()} rows from "${fromId}"`);

// Final count
const after = db
  .prepare('SELECT COUNT(*) as n FROM candles WHERE contract_id = ?')
  .get(toSymbol) as { n: number };

console.log(`  Total "${toSymbol}" bars: ${after.n.toLocaleString()}\n`);

db.close();
