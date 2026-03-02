import { Router } from 'express';
import axios from 'axios';
import { getBaseUrl, authHeaders, isConnected } from '../auth';

const router = Router();

// POST /market/bars
// Body: { contractId, unit, unitNumber, startTime, endTime, limit?, includePartialBar? }
router.post('/bars', async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const response = await axios.post(
      `${getBaseUrl()}/api/History/retrieveBars`,
      req.body,
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

// GET /market/contracts/search?q=NQ
router.get('/contracts/search', async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    // `live` is required by the API — pass as query param ?live=true for live data
    const live = req.query['live'] === 'true';
    const response = await axios.post(
      `${getBaseUrl()}/api/Contract/search`,
      { searchText: (req.query['q'] as string) ?? '', live },
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

// GET /market/contracts/available?live=false
router.get('/contracts/available', async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const live = req.query['live'] === 'true';
    const response = await axios.post(
      `${getBaseUrl()}/api/Contract/available`,
      { live },
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

// GET /market/contracts/:id?live=false
router.get('/contracts/:id', async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const live = req.query['live'] === 'true';
    const response = await axios.post(
      `${getBaseUrl()}/api/Contract/searchById`,
      { contractId: req.params.id, live },
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

export default router;
