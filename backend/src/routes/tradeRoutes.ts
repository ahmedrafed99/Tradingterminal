import { Router } from 'express';
import axios from 'axios';
import { getBaseUrl, authHeaders, isConnected } from '../auth';

const router = Router();

// GET /trades/search?accountId=123&startTimestamp=2026-02-24T00:00:00Z&endTimestamp=...
router.get('/search', async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  const accountId = Number(req.query['accountId']);
  if (!accountId) {
    res.status(400).json({ success: false, errorMessage: 'accountId query param is required' });
    return;
  }

  const startTimestamp = req.query['startTimestamp'] as string | undefined;
  if (!startTimestamp) {
    res.status(400).json({ success: false, errorMessage: 'startTimestamp query param is required' });
    return;
  }

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
