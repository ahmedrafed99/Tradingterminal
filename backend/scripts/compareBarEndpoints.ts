/**
 * Compares old /market/bars vs new chartapi endpoint.
 * Backend must be running on localhost:3001.
 * Usage: npx tsx scripts/compareBarEndpoints.ts
 */
import axios from 'axios';

const BACKEND = 'http://localhost:3001';

const CONTRACT_ID = 'CON.F.US.ENQ.M26';  // NQ June 2026
const SYMBOL = '/NQ';
const UNIT = 2;         // Minute
const UNIT_NUMBER = 15; // 15-minute bars
const RESOLUTION = '15';
const BAR_COUNT = 200;

const NOW = Math.floor(Date.now() / 1000);
const FROM = NOW - 60 * 60 * 24 * 3; // 3 days back

async function fetchOld() {
  const body = {
    contractId: CONTRACT_ID,
    live: false,
    unit: UNIT,
    unitNumber: UNIT_NUMBER,
    startTime: new Date(FROM * 1000).toISOString(),
    endTime: new Date(NOW * 1000).toISOString(),
    limit: BAR_COUNT,
    includePartialBar: false,
  };
  console.log(`\n[OLD] POST ${BACKEND}/market/bars`);
  const t0 = Date.now();
  try {
    const res = await axios.post(`${BACKEND}/market/bars`, body);
    const elapsed = Date.now() - t0;
    console.log(`[OLD] HTTP ${res.status} in ${elapsed}ms`);
    return { elapsed, data: res.data };
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) console.error(`[OLD] ERROR ${err.response?.status}:`, err.response?.data);
    else console.error('[OLD] ERROR:', err);
    return null;
  }
}

async function fetchNew() {
  const url = `${BACKEND}/market/chartapi-test?symbol=${encodeURIComponent(SYMBOL)}&resolution=${RESOLUTION}&countback=${BAR_COUNT}&from=${FROM}&to=${NOW}`;
  console.log(`\n[NEW] GET ${url}`);
  const t0 = Date.now();
  try {
    const res = await axios.get(url);
    const elapsed = Date.now() - t0;
    console.log(`[NEW] HTTP ${res.status} in ${elapsed}ms (chartapi latency: ${res.data.elapsed}ms)`);
    return { elapsed, data: res.data.data };
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) console.error(`[NEW] ERROR ${err.response?.status}:`, err.response?.data);
    else console.error('[NEW] ERROR:', err);
    return null;
  }
}

type Bar = Record<string, unknown>;

function summarise(label: string, data: unknown) {
  console.log(`\n--- ${label} ---`);
  if (!data) { console.log('no data'); return; }

  const bars: Bar[] = Array.isArray(data) ? data
    : Array.isArray((data as Record<string, unknown>)['bars']) ? (data as Record<string, unknown>)['bars'] as Bar[]
    : [];

  if (bars.length === 0) {
    console.log('0 bars. raw:', JSON.stringify(data).slice(0, 500));
    return;
  }

  const keys = Object.keys(bars[0]);
  console.log(`${bars.length} bars | keys: [${keys.join(', ')}]`);

  // Try to find timestamp field
  const tField = keys.find(k => ['t', 'time', 'timestamp', 'Time', 'ts'].includes(k));
  if (tField) {
    const vals = bars.map(b => b[tField]).sort();
    console.log(`time range: ${vals[0]} → ${vals[vals.length - 1]}`);
  }

  console.log('first bar:', JSON.stringify(bars[0]));
  console.log('last bar: ', JSON.stringify(bars[bars.length - 1]));
}

async function main() {
  console.log(`Symbol: ${SYMBOL} | ${UNIT_NUMBER}m bars | ${BAR_COUNT} bars`);
  console.log(`Range: ${new Date(FROM * 1000).toISOString()} → ${new Date(NOW * 1000).toISOString()}`);

  const [old_, new_] = await Promise.all([fetchOld(), fetchNew()]);

  console.log('\n' + '='.repeat(60));
  summarise('OLD /api/History/retrieveBars', old_?.data);
  summarise('NEW chartapi.topstepx.com/History/v2', new_?.data);

  if (old_?.elapsed && new_?.elapsed) {
    console.log(`\nLatency — old: ${old_.elapsed}ms | new: ${new_.elapsed}ms`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
