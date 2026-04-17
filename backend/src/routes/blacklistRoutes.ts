import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../validate';
import { getBlacklist, saveBlacklist } from '../services/blacklistService';

const router = Router();

// GET /blacklist
router.get('/', async (_req, res) => {
  try {
    const symbols = await getBlacklist();
    res.json({ success: true, symbols });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

// POST /blacklist/sync — replace full list (sent by frontend on every change)
router.post('/sync', validateBody(z.object({ symbols: z.array(z.string()) })), async (req, res) => {
  try {
    await saveBlacklist(req.body.symbols);
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

export default router;
