import { Router } from 'express';
import { getHolidays } from '../services/holidayService';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const holidays = await getHolidays();
    res.json(holidays);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

export default router;
