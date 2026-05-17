/**
 * Backtest data service — reads tick-data CSVs, pre-aggregates to 1-minute bars,
 * then re-aggregates to any higher timeframe on demand.
 *
 * CSV layout (no header):
 *   trade_id, price, qty_base, qty_quote, timestamp_microseconds, is_buyer_maker, is_best_match
 *
 * Data layout on disk:
 *   data/tick-data/{EXCHANGE}/{SYMBOL}/{YYYY}-{MM}.csv       — raw tick CSV
 *   data/tick-data/{EXCHANGE}/{SYMBOL}/{YYYY}-{MM}.1m.json   — pre-aggregated 1m bars (built once)
 *
 * Cache:
 *   In-memory + disk JSON at data/backtest-cache/{exchange}_{symbol}_{tf}_{fromDay}_{toDay}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

export interface OhlcvBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface SymbolEntry {
  exchange: string;
  symbol:   string;
}

interface TimeframeSpec {
  unit:       number;  // 1=sec 2=min 3=hr 4=day
  unitNumber: number;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const TICK_DATA_DIR = path.resolve(
  process.env.TICK_DATA_DIR ?? path.join(__dirname, '../../data/tick-data'),
);

const CACHE_DIR = path.resolve(
  process.env.BACKTEST_CACHE_DIR ?? path.join(__dirname, '../../data/backtest-cache'),
);

// ---------------------------------------------------------------------------
// Timeframe helpers
// ---------------------------------------------------------------------------

function periodSeconds(unit: number, unitNumber: number): number {
  const mul = [0, 1, 60, 3600, 86400];
  return (mul[unit] ?? 60) * unitNumber;
}

function floorToBar(timestampSec: number, periodSec: number): number {
  return Math.floor(timestampSec / periodSec) * periodSec;
}

function tfLabel(unit: number, unitNumber: number): string {
  return `${unitNumber}${ ['', 's', 'm', 'h', 'd'][unit] ?? 'm' }`;
}

// ---------------------------------------------------------------------------
// Range query cache (exact date range + timeframe)
// ---------------------------------------------------------------------------

const memCache = new Map<string, OhlcvBar[]>();

function cacheKey(exchange: string, symbol: string, unit: number, unitNumber: number, fromMs: number, toMs: number): string {
  const fromDay = Math.floor(fromMs / 86_400_000);
  const toDay   = Math.floor(toMs   / 86_400_000);
  return `${exchange}_${symbol}_${tfLabel(unit, unitNumber)}_${fromDay}_${toDay}`;
}

function diskRead(key: string): OhlcvBar[] | null {
  try {
    const raw = fs.readFileSync(path.join(CACHE_DIR, `${key}.json`), 'utf8');
    return JSON.parse(raw) as OhlcvBar[];
  } catch { return null; }
}

function diskWrite(key: string, bars: OhlcvBar[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(bars), 'utf8');
  } catch (err) {
    console.error('[backtestData] cache write failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 1m monthly cache
// ---------------------------------------------------------------------------

function symbolDir(exchange: string, symbol: string): string {
  return path.join(TICK_DATA_DIR, exchange, symbol);
}

function cache1mPath(exchange: string, symbol: string, year: number, month: number): string {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  return path.join(symbolDir(exchange, symbol), `${monthStr}.1m.json`);
}

/** Stream a raw tick CSV and build a map of 1m OHLCV bars. */
function streamCsvTo1m(
  csvPath: string,
  barsMap: Map<number, OhlcvBar>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line) return;
      // Schema: trade_id,price,qty_base,qty_quote,timestamp_us,is_buyer_maker,is_best_match
      const comma1 = line.indexOf(',');
      const comma2 = line.indexOf(',', comma1 + 1);
      const comma3 = line.indexOf(',', comma2 + 1);
      const comma4 = line.indexOf(',', comma3 + 1);
      const comma5 = line.indexOf(',', comma4 + 1);
      if (comma5 < 0) return;

      const timestampUs = parseFloat(line.slice(comma4 + 1, comma5));
      const tickSec     = timestampUs / 1_000_000; // microseconds → seconds

      const price = parseFloat(line.slice(comma1 + 1, comma2));
      const qty   = parseFloat(line.slice(comma2 + 1, comma3));

      if (!isFinite(price) || !isFinite(qty) || price <= 0) return;

      const barStart = floorToBar(tickSec, 60); // 1m bars
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

    rl.on('close', resolve);
    rl.on('error', reject);
    stream.on('error', reject);
  });
}

/**
 * Returns 1m bars for a given month. On first call, streams the raw CSV and
 * saves the result as a .1m.json file. Subsequent calls read from that file.
 */
async function load1mMonth(
  exchange: string,
  symbol: string,
  year: number,
  month: number,
): Promise<OhlcvBar[]> {
  const cachePath = cache1mPath(exchange, symbol, year, month);

  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(raw) as OhlcvBar[];
  } catch { /* not cached yet */ }

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const csvPath  = path.join(symbolDir(exchange, symbol), `${monthStr}.csv`);

  if (!fs.existsSync(csvPath)) return [];

  console.log(`[backtestData] Building 1m cache: ${exchange}/${symbol}/${monthStr}...`);

  const barsMap = new Map<number, OhlcvBar>();
  await streamCsvTo1m(csvPath, barsMap);

  const bars = Array.from(barsMap.values()).sort(
    (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime(),
  );

  console.log(`[backtestData] Cached ${bars.length} 1m bars → ${monthStr}.1m.json`);

  try {
    fs.writeFileSync(cachePath, JSON.stringify(bars), 'utf8');
  } catch (err) {
    console.error('[backtestData] 1m cache write failed:', err);
  }

  return bars;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getAvailableSymbols(): SymbolEntry[] {
  const result: SymbolEntry[] = [];
  if (!fs.existsSync(TICK_DATA_DIR)) return result;

  for (const exchange of fs.readdirSync(TICK_DATA_DIR)) {
    const exchangeDir = path.join(TICK_DATA_DIR, exchange);
    try { if (!fs.statSync(exchangeDir).isDirectory()) continue; } catch { continue; }

    for (const symbol of fs.readdirSync(exchangeDir)) {
      const symDir = path.join(exchangeDir, symbol);
      try { if (!fs.statSync(symDir).isDirectory()) continue; } catch { continue; }
      const hasCsv = fs.readdirSync(symDir).some(f => f.endsWith('.csv'));
      if (hasCsv) result.push({ exchange, symbol });
    }
  }

  return result;
}

export function getAvailableRange(exchange: string, symbol: string): { from: string; to: string } | null {
  const dir = symbolDir(exchange, symbol);
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}\.csv$/.test(f))
    .sort();

  if (files.length === 0) return null;

  const parseYM = (name: string) => {
    const m = name.match(/^(\d{4})-(\d{2})\.csv$/);
    return m ? { year: parseInt(m[1]), month: parseInt(m[2]) } : null;
  };

  const first = parseYM(files[0]);
  const last  = parseYM(files[files.length - 1]);
  if (!first || !last) return null;

  return {
    from: `${first.year}-${String(first.month).padStart(2, '0')}-01`,
    to: new Date(Date.UTC(last.year, last.month, 0)).toISOString().slice(0, 10),
  };
}

/**
 * Returns OHLCV bars for the given range and timeframe.
 * - Loads 1m bars per affected month (cached after first load).
 * - Filters to [fromMs, toMs], then re-aggregates to the target period.
 */
export async function getBars(
  exchange: string,
  symbol: string,
  tf: TimeframeSpec,
  fromMs: number,
  toMs: number,
): Promise<OhlcvBar[]> {
  const key = cacheKey(exchange, symbol, tf.unit, tf.unitNumber, fromMs, toMs);

  const mem = memCache.get(key);
  if (mem) return mem;

  const disk = diskRead(key);
  if (disk) {
    memCache.set(key, disk);
    return disk;
  }

  // Collect 1m bars for every affected month
  const fromDate = new Date(fromMs);
  const toDate   = new Date(toMs);

  const base1m: OhlcvBar[] = [];
  let year  = fromDate.getUTCFullYear();
  let month = fromDate.getUTCMonth() + 1;

  while (true) {
    const monthBars = await load1mMonth(exchange, symbol, year, month);
    for (const bar of monthBars) {
      const t = new Date(bar.t).getTime();
      if (t >= fromMs && t <= toMs) base1m.push(bar);
    }

    if (year === toDate.getUTCFullYear() && month === toDate.getUTCMonth() + 1) break;
    month++;
    if (month > 12) { month = 1; year++; }
    if (year > toDate.getUTCFullYear() + 1) break;
  }

  // Re-aggregate to requested timeframe
  const periodSec = periodSeconds(tf.unit, tf.unitNumber);

  let bars: OhlcvBar[];

  if (periodSec === 60) {
    bars = base1m;
  } else {
    const barsMap = new Map<number, OhlcvBar>();
    for (const bar of base1m) {
      const barStart = floorToBar(new Date(bar.t).getTime() / 1000, periodSec);
      const existing = barsMap.get(barStart);
      if (!existing) {
        barsMap.set(barStart, { t: new Date(barStart * 1000).toISOString(), o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
      } else {
        if (bar.h > existing.h) existing.h = bar.h;
        if (bar.l < existing.l) existing.l = bar.l;
        existing.c = bar.c;
        existing.v += bar.v;
      }
    }
    bars = Array.from(barsMap.values()).sort(
      (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime(),
    );
  }

  console.log(`[backtestData] ${exchange}/${symbol} ${tfLabel(tf.unit, tf.unitNumber)}: ${bars.length} bars`);

  memCache.set(key, bars);
  diskWrite(key, bars);

  return bars;
}

// ---------------------------------------------------------------------------
// Raw tick streaming — used by the strategy runner for tick-accurate fills
// ---------------------------------------------------------------------------

function streamCsvTicksRaw(
  csvPath: string,
  fromMs: number,
  toMs: number,
  onTick: (ms: number, price: number, qty: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line) return;
      const c1 = line.indexOf(',');
      const c2 = line.indexOf(',', c1 + 1);
      const c3 = line.indexOf(',', c2 + 1);
      const c4 = line.indexOf(',', c3 + 1);
      const c5 = line.indexOf(',', c4 + 1);
      if (c5 < 0) return;

      const tickMs = parseFloat(line.slice(c4 + 1, c5)) / 1000; // µs → ms
      if (tickMs < fromMs || tickMs > toMs) return;

      const price = parseFloat(line.slice(c1 + 1, c2));
      const qty   = parseFloat(line.slice(c2 + 1, c3));
      if (!isFinite(price) || !isFinite(qty) || price <= 0) return;

      onTick(tickMs, price, qty);
    });

    rl.on('close', resolve);
    rl.on('error', reject);
    stream.on('error', reject);
  });
}

/**
 * Streams every raw tick in [fromMs, toMs] from the extracted monthly CSVs.
 * The strategy runner uses this for tick-accurate stop/target simulation.
 */
export async function streamTicksFromRange(
  exchange: string,
  symbol: string,
  fromMs: number,
  toMs: number,
  onTick: (ms: number, price: number, qty: number) => void,
): Promise<void> {
  const fromDate = new Date(fromMs);
  const toDate   = new Date(toMs);
  let year  = fromDate.getUTCFullYear();
  let month = fromDate.getUTCMonth() + 1;

  while (true) {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const csvPath  = path.join(symbolDir(exchange, symbol), `${monthStr}.csv`);
    if (fs.existsSync(csvPath)) {
      await streamCsvTicksRaw(csvPath, fromMs, toMs, onTick);
    }
    if (year === toDate.getUTCFullYear() && month === toDate.getUTCMonth() + 1) break;
    month++;
    if (month > 12) { month = 1; year++; }
    if (year > toDate.getUTCFullYear() + 1) break;
  }
}

/**
 * Aggregates an array of 1m bars into a higher-period bar array.
 * Returns the input unchanged if periodSec === 60.
 */
export function aggregateBars(bars1m: OhlcvBar[], periodSec: number): OhlcvBar[] {
  if (periodSec === 60) return bars1m;
  const barsMap = new Map<number, OhlcvBar>();
  for (const bar of bars1m) {
    const barStart = floorToBar(new Date(bar.t).getTime() / 1000, periodSec);
    const existing = barsMap.get(barStart);
    if (!existing) {
      barsMap.set(barStart, { t: new Date(barStart * 1000).toISOString(), o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
    } else {
      if (bar.h > existing.h) existing.h = bar.h;
      if (bar.l < existing.l) existing.l = bar.l;
      existing.c = bar.c;
      existing.v += bar.v;
    }
  }
  return Array.from(barsMap.values()).sort(
    (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime(),
  );
}

/**
 * Async generator — yields one array of aggregated bars per affected month.
 * Builds the .1m.json cache on first access per month.
 */
export async function* streamBarsMonthly(
  exchange: string,
  symbol: string,
  tf: TimeframeSpec,
  fromMs: number,
  toMs: number,
): AsyncGenerator<OhlcvBar[]> {
  const fromDate  = new Date(fromMs);
  const toDate    = new Date(toMs);
  const periodSec = periodSeconds(tf.unit, tf.unitNumber);

  let year  = fromDate.getUTCFullYear();
  let month = fromDate.getUTCMonth() + 1;

  while (true) {
    const monthBars = await load1mMonth(exchange, symbol, year, month);
    const filtered  = monthBars.filter((b) => {
      const t = new Date(b.t).getTime();
      return t >= fromMs && t <= toMs;
    });

    if (filtered.length > 0) {
      yield aggregateBars(filtered, periodSec);
    }

    if (year === toDate.getUTCFullYear() && month === toDate.getUTCMonth() + 1) break;
    month++;
    if (month > 12) { month = 1; year++; }
    if (year > toDate.getUTCFullYear() + 1) break;
  }
}
