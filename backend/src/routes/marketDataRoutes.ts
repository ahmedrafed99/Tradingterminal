import { Router } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { getBaseUrl, authHeaders, isConnected } from '../auth';
import { validateBody } from '../validate';

const router = Router();

const RetrieveBarsSchema = z.object({
  contractId: z.string().min(1),
  live: z.boolean().default(false),
  unit: z.number().int().positive(),
  unitNumber: z.number().int().positive(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  limit: z.number().int().positive().max(50000).optional(),
  includePartialBar: z.boolean().optional(),
});

// POST /market/bars
router.post('/bars', validateBody(RetrieveBarsSchema), async (req, res) => {
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
    if (axios.isAxiosError(err) && err.response) {
      console.error(`[bars] upstream ${err.response.status}`, err.response.data);
    }
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
