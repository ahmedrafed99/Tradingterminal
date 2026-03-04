import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../validate';
import { getAdapter, isConnected } from '../adapters/registry';

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
    const data = await getAdapter().marketData.retrieveBars(req.body);
    res.json(data);
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
    const live = req.query['live'] === 'true';
    const data = await getAdapter().marketData.searchContracts(
      (req.query['q'] as string) ?? '',
      live,
    );
    res.json(data);
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
    const data = await getAdapter().marketData.availableContracts(live);
    res.json(data);
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
    const data = await getAdapter().marketData.searchContractById(req.params.id, live);
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

export default router;
