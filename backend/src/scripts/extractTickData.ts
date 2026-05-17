/**
 * Extracts Binance tick-data ZIPs and pre-builds 1-minute OHLCV caches.
 *
 * Two steps per month:
 *   1. Extract ZIP → {EXCHANGE}/{SYMBOL}/{YYYY}-{MM}.csv
 *   2. Stream CSV  → {EXCHANGE}/{SYMBOL}/{YYYY}-{MM}.1m.json  (pre-aggregated 1m bars)
 *
 * After this runs, the app reads from .1m.json and re-aggregates to any TF instantly.
 * Both steps are skipped individually if the output already exists.
 *
 * Usage:
 *   npx tsx src/scripts/extractTickData.ts [--source <dir>] [--exchange <name>]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import yauzl from 'yauzl';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DEFAULT_SOURCE = process.env.TICK_DATA_PATH ?? 'C:/Users/ahmed/projects/cryptoBot/tick_data';
const DEST_DIR = path.resolve(__dirname, '../../data/tick-data');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

// ---------------------------------------------------------------------------
// Filename parsing
// ---------------------------------------------------------------------------

interface ParsedFile {
  exchange: string;
  symbol:   string;
  year:     number;
  month:    number;
  ext:      'zip' | 'csv';
}

function parseFilename(name: string, exchangeOverride: string): ParsedFile | null {
  const m = name.match(/^([A-Z0-9a-z]+)-trades-(\d{4})-(\d{2})\.(zip|csv)$/i);
  if (!m) return null;
  return {
    exchange: exchangeOverride,
    symbol:   m[1].toUpperCase(),
    year:     parseInt(m[2], 10),
    month:    parseInt(m[3], 10),
    ext:      m[4].toLowerCase() as 'zip' | 'csv',
  };
}

// ---------------------------------------------------------------------------
// ZIP extraction
// ---------------------------------------------------------------------------

function extractCsvFromZip(zipPath: string, destCsvPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('Cannot open zip'));

      let extracted = false;
      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        if (!entry.fileName.endsWith('.csv')) { zipfile.readEntry(); return; }

        zipfile.openReadStream(entry, (err2, stream) => {
          if (err2 || !stream) return reject(err2 ?? new Error('Cannot open stream'));
          const out = fs.createWriteStream(destCsvPath);
          stream.pipe(out);
          out.on('finish', () => { extracted = true; zipfile.readEntry(); });
          out.on('error', reject);
          stream.on('error', reject);
        });
      });

      zipfile.on('end', () => {
        if (!extracted) reject(new Error(`No CSV found inside ${path.basename(zipPath)}`));
        else resolve();
      });
      zipfile.on('error', reject);
    });
  });
}

// ---------------------------------------------------------------------------
// 1m pre-aggregation
// ---------------------------------------------------------------------------

interface OhlcvBar { t: string; o: number; h: number; l: number; c: number; v: number; }

function floorToMinute(tickSec: number): number {
  return Math.floor(tickSec / 60) * 60;
}

function buildCache1m(csvPath: string, cachePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const barsMap = new Map<number, OhlcvBar>();
    const stream  = fs.createReadStream(csvPath);
    const rl      = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line) return;
      // Schema: trade_id,price,qty_base,qty_quote,timestamp_us,is_buyer_maker,is_best_match
      const c1 = line.indexOf(',');
      const c2 = line.indexOf(',', c1 + 1);
      const c3 = line.indexOf(',', c2 + 1);
      const c4 = line.indexOf(',', c3 + 1);
      const c5 = line.indexOf(',', c4 + 1);
      if (c5 < 0) return;

      const tickSec = parseFloat(line.slice(c4 + 1, c5)) / 1_000_000; // µs → s
      const price   = parseFloat(line.slice(c1 + 1, c2));
      const qty     = parseFloat(line.slice(c2 + 1, c3));

      if (!isFinite(price) || !isFinite(qty) || price <= 0) return;

      const barStart = floorToMinute(tickSec);
      const existing = barsMap.get(barStart);

      if (!existing) {
        barsMap.set(barStart, { t: new Date(barStart * 1000).toISOString(), o: price, h: price, l: price, c: price, v: qty });
      } else {
        if (price > existing.h) existing.h = price;
        if (price < existing.l) existing.l = price;
        existing.c = price;
        existing.v += qty;
      }
    });

    rl.on('close', () => {
      const bars = Array.from(barsMap.values()).sort(
        (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime(),
      );
      fs.writeFileSync(cachePath, JSON.stringify(bars), 'utf8');
      resolve(bars.length);
    });

    rl.on('error', reject);
    stream.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sourceDir = getArg('--source', getArg('--path', DEFAULT_SOURCE));
  const exchange  = getArg('--exchange', 'BINANCE').toUpperCase();

  console.log(`Source  : ${sourceDir}`);
  console.log(`Dest    : ${DEST_DIR}`);
  console.log(`Exchange: ${exchange}`);
  console.log('');

  if (!fs.existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(sourceDir).sort();
  let errors  = 0;

  for (const file of files) {
    const parsed = parseFilename(file, exchange);
    if (!parsed) continue;

    const { symbol, year, month, ext } = parsed;
    const monthStr  = `${year}-${String(month).padStart(2, '0')}`;
    const destDir   = path.join(DEST_DIR, exchange, symbol);
    const destCsv   = path.join(destDir, `${monthStr}.csv`);
    const destCache = path.join(destDir, `${monthStr}.1m.json`);

    fs.mkdirSync(destDir, { recursive: true });

    // Step 1: extract / copy CSV
    if (!fs.existsSync(destCsv)) {
      const srcPath = path.join(sourceDir, file);
      try {
        process.stdout.write(`  ${ext === 'zip' ? 'extract' : 'copy   '} ${file} → ${monthStr}.csv ... `);
        if (ext === 'zip') await extractCsvFromZip(srcPath, destCsv);
        else fs.copyFileSync(srcPath, destCsv);
        console.log('done');
      } catch (err) {
        console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
        try { fs.unlinkSync(destCsv); } catch { /* ignore */ }
        errors++;
        continue;
      }
    } else {
      console.log(`  skip    ${monthStr}.csv  (already exists)`);
    }

    // Step 2: build 1m cache
    if (!fs.existsSync(destCache)) {
      try {
        process.stdout.write(`  cache   ${monthStr}.csv → ${monthStr}.1m.json ... `);
        const count = await buildCache1m(destCsv, destCache);
        console.log(`done (${count} bars)`);
      } catch (err) {
        console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
        try { fs.unlinkSync(destCache); } catch { /* ignore */ }
        errors++;
      }
    } else {
      console.log(`  skip    ${monthStr}.1m.json  (already exists)`);
    }
  }

  console.log('');
  if (errors > 0) {
    console.log(`Finished with ${errors} error(s).`);
    process.exit(1);
  } else {
    console.log('Done. All months extracted and cached.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
