import { Router } from 'express';
import { getAdapter, isConnected } from '../adapters/registry';

const router = Router();

// GET /accounts
// Returns all accounts for the authenticated user
router.get('/', async (_req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const data = await getAdapter().accounts.list();
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

export default router;
