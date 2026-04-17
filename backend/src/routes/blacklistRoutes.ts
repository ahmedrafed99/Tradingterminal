import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../validate';
import { getBlacklist, saveBlacklist } from '../services/blacklistService';

const router = Router();

// GET /blacklist
router.get('/', async (_req, res) => {
  try {
    const data = await getBlacklist();
    res.json({ success: true, ...data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

// POST /blacklist/sync — replace full structure (sent by frontend on every change)
const SyncSchema = z.object({
  global: z.array(z.string()),
  accounts: z.record(z.string(), z.array(z.string())),
});

router.post('/sync', validateBody(SyncSchema), async (req, res) => {
  try {
    await saveBlacklist(req.body);
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

export default router;
