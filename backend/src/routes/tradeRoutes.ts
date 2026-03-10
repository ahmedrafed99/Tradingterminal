import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../validate';
import { withConnection, getAdapter } from '../middleware/withConnection';

const router = Router();

const TradeSearchQuery = z.object({
  accountId: z.string().regex(/^\d+$/, 'accountId must be a number'),
  startTimestamp: z.string().min(1, 'startTimestamp is required'),
  endTimestamp: z.string().optional(),
});

// GET /trades/search?accountId=123&startTimestamp=2026-02-24T00:00:00Z&endTimestamp=...
router.get('/search', validateQuery(TradeSearchQuery), withConnection(async (req, res) => {
  const accountId = Number(req.query['accountId']);
  const startTimestamp = req.query['startTimestamp'] as string;
  const endTimestamp = req.query['endTimestamp'] as string | undefined;

  const data = await getAdapter().trades.search({
    accountId,
    startTimestamp,
    endTimestamp: endTimestamp || undefined,
  });
  res.json(data);
}));

export default router;
