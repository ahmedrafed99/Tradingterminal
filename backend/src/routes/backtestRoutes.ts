import { Router } from 'express';
import { z } from 'zod';
import * as vm from 'vm';
import * as fs from 'fs';
import * as path from 'path';
import { validateQuery } from '../validate';
import { getBars, streamBarsMonthly, streamTicksFromRange, getAvailableRange, getAvailableSymbols, type OhlcvBar } from '../services/backtestDataService';

// ---------------------------------------------------------------------------
// Strategy file persistence — backend/data/strategies/{name}/strategy.js|result.json
// ---------------------------------------------------------------------------

const STRATEGIES_DIR = path.resolve(
  process.env.STRATEGIES_DIR ?? path.join(__dirname, '../../data/strategies'),
);

function safeName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 100);
}

function strategyDir(name: string): string {
  return path.join(STRATEGIES_DIR, safeName(name));
}

const router = Router();

// ---------------------------------------------------------------------------
// GET /backtest/symbols  — list all available exchange/symbol pairs
// ---------------------------------------------------------------------------

router.get('/symbols', (_req, res) => {
  const symbols = getAvailableSymbols();
  res.json({ success: true, symbols });
});

// ---------------------------------------------------------------------------
// GET /backtest/bars
// ---------------------------------------------------------------------------

const BarsQuery = z.object({
  exchange:   z.string().default('BINANCE'),
  symbol:     z.string().default('BTCUSDT'),
  unit:       z.coerce.number().int().min(1).max(4),
  unitNumber: z.coerce.number().int().min(1),
  from:       z.string().min(1),
  to:         z.string().min(1),
  limit:      z.coerce.number().int().min(1).optional(),
});

router.get('/bars', validateQuery(BarsQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof BarsQuery>;
  const { exchange, symbol, unit, unitNumber, from, to } = q;

  try {
    const fromMs = new Date(from as string).getTime();
    const toMs   = new Date(to   as string).getTime() + 86_399_999;

    if (isNaN(fromMs) || isNaN(toMs) || fromMs >= toMs) {
      res.status(400).json({ success: false, error: 'Invalid date range' });
      return;
    }

    const tf = { unit: unit as number, unitNumber: unitNumber as number };
    const bars = await getBars(exchange as string, symbol as string, tf, fromMs, toMs);
    res.json({ success: true, bars });
  } catch (err) {
    console.error('[backtestRoutes] /bars error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /backtest/bars/stream  — SSE: streams bars month by month as they load
// ---------------------------------------------------------------------------

router.get('/bars/stream', async (req, res) => {
  const exchange   = (req.query.exchange   as string) ?? 'BINANCE';
  const symbol     = (req.query.symbol     as string) ?? 'BTCUSDT';
  const unit       = parseInt(req.query.unit       as string, 10);
  const unitNumber = parseInt(req.query.unitNumber as string, 10);
  const from       = req.query.from as string;
  const to         = req.query.to   as string;

  if (!from || !to || isNaN(unit) || isNaN(unitNumber)) {
    res.status(400).json({ success: false, error: 'Missing params' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const fromMs = new Date(from).getTime();
    const toMs   = new Date(to).getTime() + 86_399_999;
    const tf     = { unit, unitNumber };

    for await (const chunk of streamBarsMonthly(exchange, symbol, tf, fromMs, toMs)) {
      send('chunk', chunk);
    }

    send('done', {});
  } catch (err) {
    send('error', { message: String(err) });
  }

  res.end();
});

// ---------------------------------------------------------------------------
// GET /backtest/range  — available date range for a symbol
// ---------------------------------------------------------------------------

router.get('/range', (req, res) => {
  const exchange = (req.query.exchange as string) ?? 'BINANCE';
  const symbol   = (req.query.symbol   as string) ?? 'BTCUSDT';
  const range = getAvailableRange(exchange, symbol);
  if (!range) {
    res.json({ success: false, error: 'No data found' });
    return;
  }
  res.json({ success: true, ...range });
});

// ---------------------------------------------------------------------------
// POST /backtest/run  — execute strategy via SSE streaming
// ---------------------------------------------------------------------------

interface Trade {
  entryTime:  string;
  exitTime:   string;
  side:       'long' | 'short';
  entryPrice: number;
  exitPrice:  number;
  qty:        number;
  pnl:        number;     // net of fees
  pnlPct:     number;     // net of fees
  fees:       number;     // round-trip taker fees (entry + exit)
  tradeId?:   number;     // groups partial closes from the same entry
  isPartial?: boolean;    // true when this row is a partial close
}

interface PartialTarget {
  price:     number;
  fraction:  number;   // fraction of original entry qty to close
  moveSLTo?: number;   // price to move stop to after this target hits
}

interface EquityPoint {
  t:      string;
  equity: number;
}

const RunBody = z.object({
  exchange:     z.string().default('BINANCE'),
  symbol:       z.string().default('BTCUSDT'),
  unit:         z.number().int().min(1).max(4),
  unitNumber:   z.number().int().min(1),
  from:         z.string().min(1),
  to:           z.string().min(1),
  initialEquity: z.number().positive().default(10000),
  strategyCode: z.string().min(1),
  takerFee:     z.number().min(0).max(0.01).default(0.00055), // per-side fraction; worst-case Bybit taker
});

router.post('/run', async (req, res) => {
  const parsed = RunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.message });
    return;
  }

  const { exchange, symbol, unit, unitNumber, from, to, initialEquity, strategyCode, takerFee } = parsed.data;

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const fromMs = new Date(from).getTime();
    const toMs   = new Date(to).getTime() + 86_399_999;

    send('status', { message: 'Replaying ticks...' });

    const result = await runStrategy(
      exchange, symbol, { unit, unitNumber }, fromMs, toMs,
      strategyCode, initialEquity, takerFee,
      (points) => send('equity', points),
      (msg)    => send('status', { message: msg }),
    );

    // Strip equityCurve — already streamed in equity batches; sending it again
    // in 'done' causes a multi-MB JSON parse on the main thread → browser freeze.
    const { equityCurve: _ec, ...summary } = result;
    send('done', summary);
    res.end();
  } catch (err) {
    send('error', { message: String(err) });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Strategy runner — tick-accurate, sandboxed via vm module
// ---------------------------------------------------------------------------

interface StrategyResult {
  trades:       Trade[];
  equityCurve:  EquityPoint[];
  finalEquity:  number;
  totalReturn:  number;
  winRate:      number;
  totalTrades:  number;
  maxDrawdown:  number;
  sharpe:       number;
}

async function runStrategy(
  exchange: string,
  symbol: string,
  tf: { unit: number; unitNumber: number },
  fromMs: number,
  toMs: number,
  strategyCode: string,
  initialEquity: number,
  takerFee: number,
  onEquityBatch: (points: EquityPoint[]) => void,
  onStatus: (msg: string) => void,
): Promise<StrategyResult> {
  // Stream equity points in batches and yield to the event loop between
  // batches so Node can flush the socket — keeps the UI responsive and
  // avoids a single fat SSE chunk that the browser's message handler can't
  // process within one frame.
  const EQUITY_BATCH_SIZE = 200;
  let pointBatch: EquityPoint[] = [];
  const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));
  const flushBatch = () => {
    if (pointBatch.length === 0) return;
    onEquityBatch(pointBatch);
    pointBatch = [];
  };
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  let equity      = initialEquity;
  let position    = 0;
  let entryPrice  = 0;
  let entryTime   = '';
  let entrySide: 'long' | 'short' = 'long';
  let entryQty    = 0;
  let tradeCounter = 0;
  let currentTradeId: number | null = null;
  let stopPrice:   number | null = null;
  let targetPrice: number | null = null;
  let trailingDist: number | null = null; // active trailing stop distance (null = none)
  let trailingRef:  number = 0;           // peak price driving the trail
  let partialTargets: PartialTarget[] = [];
  const state: Record<string, unknown> = {};
  const prevBarsBuffer: OhlcvBar[] = [];

  function openPosition(side: 'long' | 'short', qty: number, price: number, time: string) {
    if (position !== 0) return;
    tradeCounter++;
    currentTradeId  = tradeCounter;
    position        = side === 'long' ? qty : -qty;
    entryPrice      = price;
    entryTime       = time;
    entrySide       = side;
    entryQty        = qty;
    stopPrice       = null;
    targetPrice     = null;
    trailingDist    = null;
    trailingRef     = price;
    partialTargets  = [];
  }

  function closePosition(exitPrice: number, exitTime: string) {
    if (position === 0) return;
    const qty       = Math.abs(position);
    const grossPnl  = entrySide === 'long'
      ? (exitPrice - entryPrice) * qty
      : (entryPrice - exitPrice) * qty;
    const fees      = (entryPrice + exitPrice) * qty * takerFee;
    const pnl       = grossPnl - fees;
    const pnlPct    = (pnl / (entryPrice * qty)) * 100;
    trades.push({ entryTime, exitTime, side: entrySide, entryPrice, exitPrice, qty, pnl, pnlPct, fees, tradeId: currentTradeId ?? undefined, isPartial: false });
    equity         += pnl;
    position        = 0;
    stopPrice       = null;
    targetPrice     = null;
    trailingDist    = null;
    partialTargets  = [];
    currentTradeId  = null;
    entryQty        = 0;
  }

  function closePartialPosition(fractionOfOriginal: number, exitPrice: number, exitTime: string) {
    if (position === 0 || entryQty === 0) return;
    const closeQty = Math.min(entryQty * fractionOfOriginal, Math.abs(position));
    if (closeQty < 1e-10) return;
    const grossPnl = entrySide === 'long'
      ? (exitPrice - entryPrice) * closeQty
      : (entryPrice - exitPrice) * closeQty;
    const fees     = (entryPrice + exitPrice) * closeQty * takerFee;
    const pnl      = grossPnl - fees;
    const pnlPct   = (pnl / (entryPrice * closeQty)) * 100;
    trades.push({ entryTime, exitTime, side: entrySide, entryPrice, exitPrice, qty: closeQty, pnl, pnlPct, fees, tradeId: currentTradeId ?? undefined, isPartial: true });
    equity += pnl;
    if (position > 0) position -= closeQty;
    else              position += closeQty;
    if (Math.abs(position) < 1e-10) {
      position       = 0;
      stopPrice      = null;
      targetPrice    = null;
      trailingDist   = null;
      partialTargets = [];
      currentTradeId = null;
      entryQty       = 0;
    }
  }

  // Advance the trailing stop to the new tick price (only moves in the favourable direction).
  function updateTrailingStop(price: number) {
    if (trailingDist === null || position === 0) return;
    if (position > 0) {
      if (price > trailingRef) { trailingRef = price; stopPrice = trailingRef - trailingDist; }
    } else {
      if (price < trailingRef) { trailingRef = price; stopPrice = trailingRef + trailingDist; }
    }
  }

  // Compile strategy once
  let strategyFn: (ctx: object) => void;
  try {
    const wrapped = `(function(ctx) { with(ctx) { ${strategyCode} } })`;
    strategyFn = vm.runInNewContext(wrapped, { Math, parseFloat, parseInt, isNaN, isFinite });
  } catch (err) {
    throw new Error(`Strategy compile error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const periodSec = [0, 1, 60, 3600, 86400][tf.unit] * tf.unitNumber;
  let peakEquity  = initialEquity;
  let maxDrawdown = 0;

  // Load all bars upfront — fast, uses 1m cache + re-aggregation
  onStatus('Loading bars...');
  const bars = await getBars(exchange, symbol, tf, fromMs, toMs);
  // Load 1m sub-bars for trailing-stop simulation (avoids per-bar CSV reads)
  const bars1m = periodSec <= 60
    ? bars
    : await getBars(exchange, symbol, { unit: 2, unitNumber: 1 }, fromMs, toMs);
  onStatus(`Loaded ${bars.length} bars — running strategy...`);

  let lastMonth = '';

  for (const bar of bars) {
    // Status update on month boundary
    const barMonth = bar.t.slice(0, 7);
    if (barMonth !== lastMonth) { lastMonth = barMonth; onStatus(`Processing ${barMonth}...`); }

    // ── Stop / target / trailing check BEFORE strategy call ──────────────────
    if (position !== 0) {
      const isLong   = position > 0;
      const barMs    = new Date(bar.t).getTime();
      const barEndMs = barMs + periodSec * 1000 - 1;

      if (trailingDist !== null) {
        // Bar-level check: does this bar even threaten the stop?
        // For a long, the worst-case stop after the trail fully advances is bar.h - trailingDist.
        // If bar.l is above both the current stop and that post-advance stop, nothing can trigger.
        const wouldTrigger = isLong
          ? bar.l <= Math.max(stopPrice!, bar.h - trailingDist)
          : bar.h >= Math.min(stopPrice!, bar.l + trailingDist);

        if (!wouldTrigger) {
          // Safe bar — just advance the trail peak using the bar's favorable extreme.
          updateTrailingStop(isLong ? bar.h : bar.l);
        } else {
          // Stop is at risk — stream raw ticks for this exact bar to get tick-accurate exit.
          let closed = false;
          await streamTicksFromRange(exchange, symbol, barMs, barEndMs, (tickMs, price) => {
            if (closed) return;
            updateTrailingStop(price);
            if (stopPrice !== null && (isLong ? price <= stopPrice : price >= stopPrice)) {
              closePosition(stopPrice, new Date(tickMs).toISOString());
              closed = true;
            }
          });
          // If stop didn't fire, ensure trail reflects the bar's favorable extreme.
          if (!closed) updateTrailingStop(isLong ? bar.h : bar.l);
        }
      } else {
        // 1. Process partial targets in price order (sorted closest-first on setPartialTargets)
        if (partialTargets.length > 0) {
          const remaining: PartialTarget[] = [];
          for (const pt of partialTargets) {
            if (position === 0) break;
            const curLong = position > 0;
            const hit = curLong ? bar.h >= pt.price : bar.l <= pt.price;
            if (hit) {
              closePartialPosition(pt.fraction, pt.price, bar.t);
              if (pt.moveSLTo !== undefined) stopPrice = pt.moveSLTo;
            } else {
              remaining.push(pt);
            }
          }
          partialTargets = remaining;
        }

        // 2. Fixed stop/target on remaining position
        if (position !== 0) {
          const curLong   = position > 0;
          const stopHit   = stopPrice   !== null && (curLong ? bar.l <= stopPrice   : bar.h >= stopPrice);
          const targetHit = targetPrice !== null && (curLong ? bar.h >= targetPrice : bar.l <= targetPrice);

          if (stopHit && targetHit) {
            // Both penetrated in the same bar — use 1m sub-bars to find which hit first
            const fill = resolveAmbiguousWith1m(bars1m, barMs, barEndMs, stopPrice, targetPrice, curLong);
            closePosition(fill.price, fill.time || bar.t);
          } else if (stopHit) {
            closePosition(stopPrice!, bar.t);
          } else if (targetHit) {
            closePosition(targetPrice!, bar.t);
          }
        }
      }
    }

    // ── Call strategy ─────────────────────────────────────────────────────────
    prevBarsBuffer.push(bar);
    if (prevBarsBuffer.length > 101) prevBarsBuffer.shift();

    const ctx = {
      bar:      { open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v, time: bar.t },
      prevBars: prevBarsBuffer.slice(0, -1).slice(-100).map(
        b => ({ open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, time: b.t }),
      ),
      position, equity, state,
      buy:              (qty: number) => openPosition('long',  qty, bar.c, bar.t),
      sell:             (qty: number) => openPosition('short', qty, bar.c, bar.t),
      close:            ()            => closePosition(bar.c, bar.t),
      // setStop clears any active trailing stop
      setStop:          (p: number)   => { stopPrice = p; trailingDist = null; },
      setTarget:        (p: number)   => { targetPrice = p; },
      // setPartialTargets — scales out of position at multiple price levels.
      // fraction is portion of the ORIGINAL entry qty to close at each level.
      // moveSLTo (optional) moves the stop to that price after the target hits.
      // Targets are sorted automatically (closest-to-entry first).
      setPartialTargets: (targets: Array<{ price: number; fraction: number; moveSLTo?: number }>) => {
        if (position === 0) return;
        const curLong = position > 0;
        partialTargets = [...targets].sort((a, b) => curLong ? a.price - b.price : b.price - a.price);
      },
      // closePartial — manually close a fraction of the original entry qty at bar close.
      closePartial: (fraction: number) => closePartialPosition(fraction, bar.c, bar.t),
      // setTrailingStop trails `distance` from the price peak since first activation.
      // Re-calling updates the distance but preserves the tracked peak reference.
      setTrailingStop:  (distance: number) => {
        const firstActivation = trailingDist === null;
        trailingDist = distance;
        if (firstActivation) {
          trailingRef = bar.c;
          stopPrice   = position > 0 ? bar.c - distance : bar.c + distance;
        } else {
          // Keep the peak ref — only recompute stop from the existing reference
          stopPrice = position > 0 ? trailingRef - distance : trailingRef + distance;
        }
      },
    };

    try { strategyFn(ctx); } catch { /* ignore runtime errors per bar */ }

    // ── Mark-to-market equity point ───────────────────────────────────────────
    const mtm = position !== 0
      ? (entrySide === 'long' ? bar.c - entryPrice : entryPrice - bar.c) * Math.abs(position)
      : 0;
    const runningEquity = Math.round((equity + mtm) * 100) / 100;

    const point: EquityPoint = { t: bar.t, equity: runningEquity };
    equityCurve.push(point);
    pointBatch.push(point);
    if (pointBatch.length >= EQUITY_BATCH_SIZE) {
      flushBatch();
      await yieldToLoop();
    }

    if (runningEquity > peakEquity) peakEquity = runningEquity;
    const dd = (peakEquity - runningEquity) / peakEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  flushBatch();

  // Close any open position at the final bar's close
  if (position !== 0 && bars.length > 0) {
    const lastBar = bars[bars.length - 1];
    closePosition(lastBar.c, lastBar.t);
  }

  // Group partial-close trades by tradeId so win rate and count are per-entry, not per-partial.
  const grouped = new Map<number, number>(); // tradeId → total pnl
  const ungrouped: Trade[] = [];
  for (const t of trades) {
    if (t.tradeId != null) {
      grouped.set(t.tradeId, (grouped.get(t.tradeId) ?? 0) + t.pnl);
    } else {
      ungrouped.push(t);
    }
  }
  const entryPnls = [...Array.from(grouped.values()), ...ungrouped.map(t => t.pnl)];
  const totalTrades = entryPnls.length;
  const winners = entryPnls.filter(p => p > 0);
  const winRate = totalTrades > 0 ? winners.length / totalTrades : 0;

  let sharpe = 0;
  if (equityCurve.length > 1) {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      returns.push((equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity);
    }
    const mean     = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
    const std      = Math.sqrt(variance);
    sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  return {
    trades, equityCurve,
    finalEquity:  equity,
    totalReturn:  ((equity - initialEquity) / initialEquity) * 100,
    winRate:      winRate * 100,
    totalTrades,
    maxDrawdown:  maxDrawdown * 100,
    sharpe,
  };
}

// When both fixed stop and target are penetrated in the same TF bar, walk the
// constituent 1m sub-bars (using their hf flag for intra-bar ordering) to find
// which level was touched first.
function resolveAmbiguousWith1m(
  bars1m:   OhlcvBar[],
  barMs:    number,
  barEndMs: number,
  stop:     number | null,
  target:   number | null,
  isLong:   boolean,
): { price: number; time: string } {
  let startIdx = 0;
  while (startIdx < bars1m.length && Date.parse(bars1m[startIdx].t) < barMs) startIdx++;
  for (let i = startIdx; i < bars1m.length; i++) {
    const m   = bars1m[i];
    const mMs = Date.parse(m.t);
    if (mMs > barEndMs) break;

    const stopHit   = stop   !== null && (isLong ? m.l <= stop   : m.h >= stop);
    const targetHit = target !== null && (isLong ? m.h >= target : m.l <= target);
    if (!stopHit && !targetHit) continue;

    if (stopHit && targetHit) {
      // Both levels in same 1m bar — hf resolves order
      const hFirst = m.hf ?? m.c >= m.o;
      if (isLong) return hFirst
        ? { price: target!, time: m.t }  // high (target) first
        : { price: stop!,   time: m.t }; // low (stop) first
      else return hFirst
        ? { price: stop!,   time: m.t }  // high (stop for short) first
        : { price: target!, time: m.t }; // low (target for short) first
    }
    if (stopHit)   return { price: stop!,   time: m.t };
    if (targetHit) return { price: target!, time: m.t };
  }
  // Fallback: stop wins (conservative)
  return { price: stop ?? target!, time: '' };
}

// ---------------------------------------------------------------------------
// GET /backtest/strategies  — list all strategy folders with their code
// ---------------------------------------------------------------------------

router.get('/strategies', (_req, res) => {
  try {
    if (!fs.existsSync(STRATEGIES_DIR)) {
      res.json({ success: true, strategies: [] });
      return;
    }
    const strategies = fs.readdirSync(STRATEGIES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const codePath = path.join(STRATEGIES_DIR, d.name, 'strategy.js');
        const code = fs.existsSync(codePath) ? fs.readFileSync(codePath, 'utf8') : '';
        return { name: d.name, code };
      });
    res.json({ success: true, strategies });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// PUT /backtest/strategies/:name  — create / update strategy code
// ---------------------------------------------------------------------------

router.put('/strategies/:name', (req, res) => {
  try {
    const name = safeName(req.params.name);
    const { code } = req.body as { code: string };
    const dir = strategyDir(name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'strategy.js'), code ?? '', 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /backtest/strategies/:name  — rename strategy folder
// ---------------------------------------------------------------------------

router.patch('/strategies/:name', (req, res) => {
  try {
    const oldName = safeName(req.params.name);
    const newName = safeName((req.body as { newName: string }).newName ?? '');
    if (!newName) { res.status(400).json({ success: false, error: 'newName required' }); return; }
    const oldDir = strategyDir(oldName);
    const newDir = strategyDir(newName);
    if (fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /backtest/strategies/:name  — delete strategy folder
// ---------------------------------------------------------------------------

router.delete('/strategies/:name', (req, res) => {
  try {
    const dir = strategyDir(req.params.name);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// PUT /backtest/strategies/:name/result  — save run result
// Body: { result: BacktestResult, meta: { exchange, symbol, from, to, timeframe, initialEquity } }
// Writes summary.json (human-readable stats), equity.json, trades.json
// ---------------------------------------------------------------------------

interface SaveResultBody {
  result: {
    trades:      Array<{ pnl: number; pnlPct: number; side: string; entryTime: string; exitTime: string; entryPrice: number; exitPrice: number; qty: number; fees: number; tradeId?: number }>;
    equityCurve: Array<{ t: string; equity: number }>;
    finalEquity:  number;
    totalReturn:  number;
    winRate:      number;
    totalTrades:  number;
    maxDrawdown:  number;
    sharpe:       number;
  };
  meta: {
    exchange:      string;
    symbol:        string;
    from:          string;
    to:            string;
    timeframe:     string;
    initialEquity: number;
  };
}

router.put('/strategies/:name/result', (req, res) => {
  try {
    const name = safeName(req.params.name);
    const dir = strategyDir(name);
    fs.mkdirSync(dir, { recursive: true });

    const { result, meta } = req.body as SaveResultBody;
    const { trades, equityCurve, finalEquity, totalReturn, winRate, totalTrades, maxDrawdown, sharpe } = result;

    // Compute extra stats from trades (group partials by tradeId for accurate per-entry avg win/loss)
    const entryMap = new Map<number, number>();
    const entryPnls: number[] = [];
    for (const t of trades) {
      if (t.tradeId != null) {
        entryMap.set(t.tradeId, (entryMap.get(t.tradeId) ?? 0) + t.pnl);
      } else {
        entryPnls.push(t.pnl);
      }
    }
    const allEntryPnls = [...Array.from(entryMap.values()), ...entryPnls];
    const winners = allEntryPnls.filter(p => p > 0);
    const losers  = allEntryPnls.filter(p => p < 0);
    const grossProfit = winners.reduce((s, p) => s + p, 0);
    const grossLoss   = Math.abs(losers.reduce((s, p) => s + p, 0));
    const avgWin      = winners.length > 0 ? grossProfit / winners.length : 0;
    const avgLoss     = losers.length  > 0 ? grossLoss  / losers.length  : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const bestTrade  = trades.length > 0 ? Math.max(...trades.map(t => t.pnl)) : 0;
    const worstTrade = trades.length > 0 ? Math.min(...trades.map(t => t.pnl)) : 0;

    let longestWinStreak = 0, longestLossStreak = 0, curWin = 0, curLoss = 0;
    for (const p of allEntryPnls) {
      if (p > 0) { curWin++; curLoss = 0; longestWinStreak  = Math.max(longestWinStreak,  curWin);  }
      else       { curLoss++; curWin = 0; longestLossStreak = Math.max(longestLossStreak, curLoss); }
    }

    const summary = {
      runDate:      new Date().toISOString(),
      exchange:     meta.exchange,
      symbol:       meta.symbol,
      from:         meta.from,
      to:           meta.to,
      timeframe:    meta.timeframe,
      initialEquity: meta.initialEquity,
      finalEquity:  Math.round(finalEquity * 100) / 100,
      netPnl:       Math.round((finalEquity - meta.initialEquity) * 100) / 100,
      totalReturn:  Math.round(totalReturn * 100) / 100,
      totalTrades,
      winRate:      Math.round(winRate * 100) / 100,
      winners:      winners.length,
      losers:       losers.length,
      avgWin:       Math.round(avgWin * 100) / 100,
      avgLoss:      Math.round(avgLoss * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      bestTrade:    Math.round(bestTrade * 100) / 100,
      worstTrade:   Math.round(worstTrade * 100) / 100,
      maxDrawdown:  Math.round(maxDrawdown * 100) / 100,
      sharpe:       Math.round(sharpe * 100) / 100,
      longestWinStreak,
      longestLossStreak,
    };

    fs.writeFileSync(path.join(dir, 'summary.json'),  JSON.stringify(summary,    null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, 'equity.json'),   JSON.stringify(equityCurve, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, 'trades.json'),   JSON.stringify(trades,     null, 2), 'utf8');

    // Remove old monolithic result.json if it exists
    const legacy = path.join(dir, 'result.json');
    if (fs.existsSync(legacy)) fs.unlinkSync(legacy);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /backtest/strategies/:name/result  — load last run result
// ---------------------------------------------------------------------------

router.get('/strategies/:name/result', (req, res) => {
  try {
    const dir = strategyDir(req.params.name);
    const summaryPath = path.join(dir, 'summary.json');
    if (!fs.existsSync(summaryPath)) {
      res.json({ success: false, error: 'No result' });
      return;
    }
    const summary    = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const equityPath = path.join(dir, 'equity.json');
    const tradesPath = path.join(dir, 'trades.json');
    const equityCurve = fs.existsSync(equityPath) ? JSON.parse(fs.readFileSync(equityPath, 'utf8')) : [];
    const trades      = fs.existsSync(tradesPath) ? JSON.parse(fs.readFileSync(tradesPath, 'utf8')) : [];

    res.json({
      success: true,
      result: {
        trades,
        equityCurve,
        finalEquity:  summary.finalEquity,
        totalReturn:  summary.totalReturn,
        winRate:      summary.winRate,
        totalTrades:  summary.totalTrades,
        maxDrawdown:  summary.maxDrawdown,
        sharpe:       summary.sharpe,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
