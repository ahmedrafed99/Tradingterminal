import { Router } from 'express';
import { z } from 'zod';
import * as vm from 'vm';
import { validateQuery } from '../validate';
import { getBars, streamBarsMonthly, streamTicksFromRange, getAvailableRange, getAvailableSymbols, type OhlcvBar } from '../services/backtestDataService';

const router = Router();

// ---------------------------------------------------------------------------
// GET /backtest/bars
// ---------------------------------------------------------------------------

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
  pnl:        number;
  pnlPct:     number;
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
});

router.post('/run', async (req, res) => {
  const parsed = RunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.message });
    return;
  }

  const { exchange, symbol, unit, unitNumber, from, to, initialEquity, strategyCode } = parsed.data;

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
      strategyCode, initialEquity,
      (point) => send('equity', point),
      (msg)   => send('status', { message: msg }),
    );

    send('done', result);
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
  onEquityPoint: (p: EquityPoint) => void,
  onStatus: (msg: string) => void,
): Promise<StrategyResult> {
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  let equity      = initialEquity;
  let position    = 0;
  let entryPrice  = 0;
  let entryTime   = '';
  let entrySide: 'long' | 'short' = 'long';
  let stopPrice:   number | null = null;
  let targetPrice: number | null = null;
  let trailingDist: number | null = null; // active trailing stop distance (null = none)
  let trailingRef:  number = 0;           // peak price driving the trail
  const state: Record<string, unknown> = {};
  const prevBarsBuffer: OhlcvBar[] = [];

  function openPosition(side: 'long' | 'short', qty: number, price: number, time: string) {
    if (position !== 0) return;
    position     = side === 'long' ? qty : -qty;
    entryPrice   = price;
    entryTime    = time;
    entrySide    = side;
    stopPrice    = null;
    targetPrice  = null;
    trailingDist = null;
    trailingRef  = price;
  }

  function closePosition(exitPrice: number, exitTime: string) {
    if (position === 0) return;
    const qty    = Math.abs(position);
    const pnl    = entrySide === 'long'
      ? (exitPrice - entryPrice) * qty
      : (entryPrice - exitPrice) * qty;
    const pnlPct = (pnl / (entryPrice * qty)) * 100;
    trades.push({ entryTime, exitTime, side: entrySide, entryPrice, exitPrice, qty, pnl, pnlPct });
    equity       += pnl;
    position      = 0;
    stopPrice     = null;
    targetPrice   = null;
    trailingDist  = null;
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
        // Trailing stop: must track tick-by-tick so the reference updates as price moves
        let closed = false;
        await streamTicksFromRange(exchange, symbol, barMs, barEndMs, (tickMs, price) => {
          if (closed) return;
          updateTrailingStop(price);
          if (stopPrice !== null && (isLong ? price <= stopPrice : price >= stopPrice)) {
            closePosition(stopPrice, new Date(tickMs).toISOString());
            closed = true;
          }
        });
      } else {
        // Fixed stop/target: bar-level H/L check
        const stopHit   = stopPrice   !== null && (isLong ? bar.l <= stopPrice   : bar.h >= stopPrice);
        const targetHit = targetPrice !== null && (isLong ? bar.h >= targetPrice : bar.l <= targetPrice);

        if (stopHit && targetHit) {
          // Both penetrated in the same bar — drill into ticks to find which hit first
          const fill = await resolveAmbiguousBar(
            exchange, symbol, barMs, barEndMs, stopPrice, targetPrice, isLong,
          );
          closePosition(fill.price, fill.time);
        } else if (stopHit) {
          closePosition(stopPrice!, bar.t);
        } else if (targetHit) {
          closePosition(targetPrice!, bar.t);
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
    onEquityPoint(point);

    if (runningEquity > peakEquity) peakEquity = runningEquity;
    const dd = (peakEquity - runningEquity) / peakEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Close any open position at the final bar's close
  if (position !== 0 && bars.length > 0) {
    const lastBar = bars[bars.length - 1];
    closePosition(lastBar.c, lastBar.t);
  }

  const winners = trades.filter(t => t.pnl > 0);
  const winRate = trades.length > 0 ? winners.length / trades.length : 0;

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
    totalTrades:  trades.length,
    maxDrawdown:  maxDrawdown * 100,
    sharpe,
  };
}

// When both stop and target are penetrated within the same bar, stream the raw
// ticks for that bar and return whichever level was touched first.
async function resolveAmbiguousBar(
  exchange:    string,
  symbol:      string,
  barMs:       number,
  barEndMs:    number,
  stop:        number | null,
  target:      number | null,
  isLong:      boolean,
): Promise<{ price: number; time: string }> {
  let firstHit: { price: number; time: string } | null = null;

  await streamTicksFromRange(exchange, symbol, barMs, barEndMs, (tickMs, price) => {
    if (firstHit) return;
    const stopHit   = stop   !== null && (isLong ? price <= stop   : price >= stop);
    const targetHit = target !== null && (isLong ? price >= target : price <= target);
    if (stopHit)   firstHit = { price: stop!,   time: new Date(tickMs).toISOString() };
    else if (targetHit) firstHit = { price: target!, time: new Date(tickMs).toISOString() };
  });

  // Fallback: stop wins (conservative) if ticks aren't available
  return firstHit ?? { price: stop ?? target!, time: new Date(barMs).toISOString() };
}

export default router;
