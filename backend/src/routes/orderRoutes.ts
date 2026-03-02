import { Router } from 'express';
import axios from 'axios';
import { getBaseUrl, authHeaders, isConnected } from '../auth';

const router = Router();

// POST /orders/place
// Body: { accountId, contractId, type, side, size, limitPrice?, stopPrice?,
//         stopLossBracket?, takeProfitBracket? }
router.post('/place', async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/place`,
      req.body,
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

// POST /orders/cancel
// Body: { accountId, orderId }
router.post('/cancel', async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/cancel`,
      req.body,
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

// PATCH /orders/modify
// Body: { accountId, orderId, size?, limitPrice?, stopPrice?, trailPrice? }
router.patch('/modify', async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/modify`,
      req.body,
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

// GET /orders/open?accountId=12345
router.get('/open', async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  const accountId = Number(req.query['accountId']);
  if (!accountId) {
    res.status(400).json({ success: false, errorMessage: 'accountId query param is required' });
    return;
  }

  try {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/searchOpen`,
      { accountId },
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

export default router;
