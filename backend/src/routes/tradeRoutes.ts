import { Router } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { getBaseUrl, authHeaders, isConnected } from '../auth';
import { validateQuery } from '../validate';

const router = Router();

const TradeSearchQuery = z.object({
  accountId: z.string().regex(/^\d+$/, 'accountId must be a number'),
  startTimestamp: z.string().min(1, 'startTimestamp is required'),
  endTimestamp: z.string().optional(),
});

// GET /trades/search?accountId=123&startTimestamp=2026-02-24T00:00:00Z&endTimestamp=...
router.get('/search', validateQuery(TradeSearchQuery), async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  const accountId = Number(req.query['accountId']);
  const startTimestamp = req.query['startTimestamp'] as string;
  const endTimestamp = req.query['endTimestamp'] as string | undefined;

  try {
    const response = await axios.post(
      `${getBaseUrl()}/api/Trade/search`,
      { accountId, startTimestamp, endTimestamp: endTimestamp || undefined },
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

export default router;
