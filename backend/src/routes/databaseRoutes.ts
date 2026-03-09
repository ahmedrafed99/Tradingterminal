import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../validate';
import { isConnected } from '../adapters/registry';
import * as databaseService from '../services/databaseService';
import * as backfillService from '../services/backfillService';

const router = Router();

// Guard: must be connected for fetch operations
function requireConnection(
  _req: unknown,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// GET /database/status
// ---------------------------------------------------------------------------

router.get('/status', (_req, res) => {
  const status = databaseService.getStatus();
  res.json(status);
});

// ---------------------------------------------------------------------------
// POST /database/fetch
// ---------------------------------------------------------------------------

const fetchSchema = z.object({
  contractId: z.string().min(1),
  mode: z.enum(['sync', 'range']),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

router.post(
  '/fetch',
  requireConnection,
  validateBody(fetchSchema),
  async (req, res) => {
    try {
      const result = await backfillService.startFetch(req.body);
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(400).json({ success: false, errorMessage: msg });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /database/fetch/progress
// ---------------------------------------------------------------------------

router.get('/fetch/progress', (_req, res) => {
  res.json(backfillService.getProgress());
});

// ---------------------------------------------------------------------------
// POST /database/fetch/cancel
// ---------------------------------------------------------------------------

router.post('/fetch/cancel', (_req, res) => {
  const cancelled = backfillService.cancel();
  res.json({ cancelled });
});

// ---------------------------------------------------------------------------
// GET /database/candles
// ---------------------------------------------------------------------------

const candlesQuerySchema = z.object({
  contractId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  timeframe: z.string().optional().default('1m'),
});

router.get('/candles', validateQuery(candlesQuerySchema), (req, res) => {
  try {
    const { contractId, from, to, timeframe } = req.query as {
      contractId: string;
      from: string;
      to: string;
      timeframe: string;
    };

    const fromEpoch = Math.floor(new Date(from).getTime() / 1000);
    const toEpoch = Math.floor(new Date(to).getTime() / 1000);

    const candles = databaseService.getAggregatedCandles(
      contractId,
      fromEpoch,
      toEpoch,
      timeframe,
    );

    res.json({ candles, count: candles.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ success: false, errorMessage: msg });
  }
});

// ---------------------------------------------------------------------------
// DELETE /database/contracts/:id
// ---------------------------------------------------------------------------

router.delete('/contracts/:id', (req, res) => {
  const deleted = databaseService.deleteContract(req.params.id);
  res.json({ deleted });
});

export default router;
