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
  const { exchange, symbol, unit, unitNumber, from, to, limit } = q;

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
  const state: Record<string, unknown> = {};
  const prevBarsBuffer: OhlcvBar[] = [];

  function openPosition(side: 'long' | 'short', qty: number, price: number, time: string) {
    if (position !== 0) return;
    position    = side === 'long' ? qty : -qty;
    entryPrice  = price;
    entryTime   = time;
    entrySide   = side;
    stopPrice   = null;
    targetPrice = null;
  }

  function closePosition(exitPrice: number, exitTime: string) {
    if (position === 0) return;
    const qty    = Math.abs(position);
    const pnl    = entrySide === 'long'
      ? (exitPrice - entryPrice) * qty
      : (entryPrice - exitPrice) * qty;
    const pnlPct = (pnl / (entryPrice * qty)) * 100;
    trades.push({ entryTime, exitTime, side: entrySide, entryPrice, exitPrice, qty, pnl, pnlPct });
    equity     += pnl;
    position    = 0;
    stopPrice   = null;
    targetPrice = null;
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

  // Current bar being built tick by tick
  let currentBarStart = -1;
  let currentBar: OhlcvBar | null = null;

  function onBarClose(bar: OhlcvBar) {
    prevBarsBuffer.push(bar);
    if (prevBarsBuffer.length > 101) prevBarsBuffer.shift();

    const ctx = {
      bar:      { open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v, time: bar.t },
      prevBars: prevBarsBuffer.slice(0, -1).slice(-100).map(
        b => ({ open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, time: b.t }),
      ),
      position, equity, state,
      buy:       (qty: number) => openPosition('long',  qty, bar.c, bar.t),
      sell:      (qty: number) => openPosition('short', qty, bar.c, bar.t),
      close:     ()            => closePosition(bar.c, bar.t),
      setStop:   (p: number)   => { stopPrice   = p; },
      setTarget: (p: number)   => { targetPrice = p; },
    };

    try { strategyFn(ctx); } catch { /* ignore runtime errors per bar */ }

    // Mark-to-market equity point
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

  let processedMonths = 0;

  await streamTicksFromRange(exchange, symbol, fromMs, toMs, (tickMs, price, qty) => {
    const barStart = Math.floor(tickMs / 1000 / periodSec) * periodSec;

    if (barStart > currentBarStart) {
      // Crossed into a new period — finalize the previous bar
      if (currentBar) onBarClose(currentBar);

      // Track months for status updates
      const newMonth = new Date(barStart * 1000).getUTCMonth();
      const oldMonth = currentBarStart >= 0 ? new Date(currentBarStart * 1000).getUTCMonth() : -1;
      if (newMonth !== oldMonth) {
        processedMonths++;
        const monthLabel = new Date(barStart * 1000).toISOString().slice(0, 7);
        onStatus(`Processing ${monthLabel}...`);
      }

      currentBarStart = barStart;
      currentBar = {
        t: new Date(barStart * 1000).toISOString(),
        o: price, h: price, l: price, c: price, v: qty,
      };
    } else if (currentBar) {
      if (price > currentBar.h) currentBar.h = price;
      if (price < currentBar.l) currentBar.l = price;
      currentBar.c  = price;
      currentBar.v += qty;
    }

    // Check stop/target at exact tick price
    if (position !== 0) {
      const isLong    = position > 0;
      const tickTime  = new Date(tickMs).toISOString();
      if (stopPrice !== null && (isLong ? price <= stopPrice : price >= stopPrice)) {
        closePosition(stopPrice, tickTime);
      } else if (targetPrice !== null && (isLong ? price >= targetPrice : price <= targetPrice)) {
        closePosition(targetPrice, tickTime);
      }
    }
  });

  // Finalize last bar and close any open position
  if (currentBar !== null) {
    const lastBar: OhlcvBar = currentBar;
    onBarClose(lastBar);
    if (position !== 0) closePosition(lastBar.c, lastBar.t);
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

export default router;
