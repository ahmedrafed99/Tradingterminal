import { Router } from 'express';
import { getEconomicEvents } from '../services/newsService';

const router = Router();

// GET /news/economic
router.get('/economic', async (_req, res) => {
  try {
    const events = await getEconomicEvents();
    res.json(events);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

export default router;
