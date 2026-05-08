/**
 * Tests tick chart fetching end-to-end via /market/chartapi-test.
 * Backend must be running on localhost:3001 and connected to ProjectX.
 * Usage: npx tsx scripts/testTickResolutions.ts
 */
import axios from 'axios';

const BACKEND = 'http://localhost:3001';
const SYMBOL  = '/NQ';
const NOW     = Math.floor(Date.now() / 1000);
// Wide window so chartapi has enough trades to fill the requested tick bars
const FROM    = NOW - 60 * 60 * 24 * 3;

interface Case {
  label:      string;
  resolution: string;
  countback:  number;
}

const CASES: Case[] = [
  { label: '100  ticks', resolution: '100T',  countback: 50 },
  { label: '233  ticks', resolution: '233T',  countback: 50 },
  { label: '500  ticks', resolution: '500T',  countback: 50 },
  { label: '1000 ticks', resolution: '1000T', countback: 50 },
  { label: '2000 ticks', resolution: '2000T', countback: 50 },
];

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

interface Result {
  label:    string;
  ok:       boolean;
  count:    number;
  elapsed:  number;
  firstBar: string;
  lastBar:  string;
  error?:   string;
}

async function runCase(c: Case): Promise<Result> {
  const params = new URLSearchParams({
    symbol:     SYMBOL,
    resolution: c.resolution,
    countback:  String(c.countback),
    from:       String(FROM),
    to:         String(NOW),
  });

  const t0 = Date.now();
  try {
    const res = await axios.get(`${BACKEND}/market/chartapi-test?${params}`);
    const elapsed = Date.now() - t0;
    const bars: Bar[] = res.data?.data?.bars ?? [];

    if (bars.length === 0) {
      return { label: c.label, ok: false, count: 0, elapsed, firstBar: '-', lastBar: '-', error: 'empty bars array' };
    }

    const times = bars.map(b => b.t).sort((a, b) => a - b);
    return {
      label:    c.label,
      ok:       true,
      count:    bars.length,
      elapsed,
      firstBar: new Date(times[0]).toISOString().slice(0, 16),
      lastBar:  new Date(times[times.length - 1]).toISOString().slice(0, 16),
    };
  } catch (err: unknown) {
    const elapsed = Date.now() - t0;
    const msg = axios.isAxiosError(err)
      ? `HTTP ${err.response?.status}: ${JSON.stringify(err.response?.data)}`
      : String(err);
    return { label: c.label, ok: false, count: 0, elapsed, firstBar: '-', lastBar: '-', error: msg };
  }
}

async function main() {
  console.log(`Symbol: ${SYMBOL}  |  backend: ${BACKEND}`);
  console.log(`Now: ${new Date(NOW * 1000).toISOString()}\n`);

  const results = await Promise.all(CASES.map(runCase));

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${pad('Resolution', 13)} ${pad('Status', 6)} ${pad('Bars', 6)} ${pad('ms', 6)} ${pad('First bar', 17)} Last bar`);
  console.log('─'.repeat(75));

  for (const r of results) {
    const status = r.ok ? '✓ ok ' : '✗ FAIL';
    console.log(
      `${pad(r.label, 13)} ${pad(status, 6)} ${pad(String(r.count), 6)} ${pad(String(r.elapsed), 6)} ${pad(r.firstBar, 17)} ${r.lastBar}${r.error ? `\n  └─ ${r.error}` : ''}`,
    );
  }

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed < results.length) process.exit(1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
