// Run a strategy with the standard eval harness and save results to disk
// (same format/path the lab UI uses — so the lab picks it up without a re-run).
// Usage: node run-baseline.mjs "<strategy folder name>" [unit=2] [unitNumber=15]

import { readFileSync } from 'fs';
import { resolve } from 'path';

const [,, stratDir, unitArg = '2', unitNumberArg = '15'] = process.argv;
if (!stratDir) {
  console.error('Usage: node run-baseline.mjs <strategyDir> [unit=2] [unitNumber=15]');
  process.exit(1);
}

const unit = parseInt(unitArg);
const unitNumber = parseInt(unitNumberArg);
const strategyCode = readFileSync(resolve(`data/strategies/${stratDir}/strategy.js`), 'utf8');

const FROM = '2025-05-01';
const TO   = '2026-04-30';
const INITIAL = 1000;
const FEE = 0.0003;

function timeframeLabel(u, n) {
  const suffix = { 1: 's', 2: 'm', 3: 'h', 4: 'D' }[u] || '?';
  return `${n}${suffix}`;
}

// FNV-1a 32-bit — same as frontend backtestService.makeRunKey
function makeRunKey(p) {
  const str = `${p.exchange}|${p.symbol}|${p.from}|${p.to}|${p.timeframe}|${p.strategyCode}`;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const body = {
  exchange: 'BINANCE', symbol: 'BTCUSDT',
  unit, unitNumber, from: FROM, to: TO,
  initialEquity: INITIAL, strategyCode, takerFee: FEE,
};

const resp = await fetch('http://localhost:3001/backtest/run', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!resp.ok) {
  console.error('HTTP', resp.status, await resp.text());
  process.exit(1);
}

const reader = resp.body.getReader();
const dec = new TextDecoder();
let buf = '', eventType = '';
let equity = [];
let summary = null;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) { eventType = ''; continue; }
    if (line.startsWith('event:')) { eventType = line.slice(6).trim(); continue; }
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (eventType === 'status') {
      let m; try { m = JSON.parse(raw); } catch { continue; }
      if (m.message) process.stdout.write('\r  ' + m.message + '                  ');
    } else if (eventType === 'equity') {
      let pts; try { pts = JSON.parse(raw); } catch { continue; }
      for (const p of pts) equity.push(p);
    } else if (eventType === 'done') {
      try { summary = JSON.parse(raw); } catch {}
    }
  }
}
console.log('');

if (!summary) { console.error('No done event received'); process.exit(1); }
const trades = summary.trades || [];

function stats(t, label) {
  if (!t.length) { console.log(`${label}  (no trades)`); return; }
  const w = t.filter(x => x.pnl > 0), l = t.filter(x => x.pnl <= 0);
  const net = t.reduce((s,x)=>s+x.pnl,0);
  const fees = t.reduce((s,x)=>s+(x.fees||0),0);
  let peak = INITIAL, dd = 0, eq = INITIAL;
  for (const x of t) { eq += x.pnl; if (eq > peak) peak = eq; const d=(peak-eq)/peak*100; if (d>dd) dd=d; }
  const days = (new Date(t[t.length-1].exitTime) - new Date(t[0].entryTime))/86400000;
  const ann = days > 0 ? (net / INITIAL) * (365/days) * 100 : 0;
  console.log(`${label}  Net ${net.toFixed(2)}  (${ann.toFixed(1)}%/yr)  WR ${(w.length/t.length*100).toFixed(1)}%  n=${t.length}  DD ${dd.toFixed(1)}%  avgW/L ${(w.reduce((s,x)=>s+x.pnl,0)/Math.max(w.length,1)).toFixed(2)}/${(Math.abs(l.reduce((s,x)=>s+x.pnl,0))/Math.max(l.length,1)).toFixed(2)}  Fees ${fees.toFixed(0)}`);
}

console.log(`\n=== ${stratDir}  (${timeframeLabel(unit, unitNumber)}, ${FROM}→${TO}, $${INITIAL}, ${(FEE*100).toFixed(3)}% fee) ===`);
stats(trades, '  Full:  ');
stats(trades.filter(t => t.exitTime < '2026-02-01'), '  Per1:  ');
stats(trades.filter(t => t.exitTime >= '2026-02-01'), '  Per2:  ');

// Save in the same format/path the lab UI uses — runKey ensures the cached
// result is keyed identically so the lab picks it up without a re-run.
const meta = {
  exchange:      'BINANCE',
  symbol:        'BTCUSDT',
  from:          FROM,
  to:            TO,
  timeframe:     timeframeLabel(unit, unitNumber),
  initialEquity: INITIAL,
  strategyCode,
};
const result = {
  trades,
  equityCurve:  equity,
  finalEquity:  summary.finalEquity,
  totalReturn:  summary.totalReturn,
  winRate:      summary.winRate,
  totalTrades:  summary.totalTrades,
  maxDrawdown:  summary.maxDrawdown,
  sharpe:       summary.sharpe,
  accounts:     summary.accounts ?? [],
};
const runKey = makeRunKey({
  exchange: meta.exchange, symbol: meta.symbol,
  from: meta.from, to: meta.to,
  timeframe: meta.timeframe, strategyCode: meta.strategyCode,
});

const saveResp = await fetch(`http://localhost:3001/backtest/strategies/${encodeURIComponent(stratDir)}/result`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ result, meta, runKey }),
});
if (saveResp.ok) {
  console.log(`  → Saved to data/strategies/${stratDir}/ (runKey ${runKey})`);
} else {
  console.error(`  → Save failed: HTTP ${saveResp.status}`);
}