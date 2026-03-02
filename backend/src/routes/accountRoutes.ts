import { Router } from 'express';
import axios from 'axios';
import { getBaseUrl, authHeaders, isConnected } from '../auth';

const router = Router();

// GET /accounts
// Returns all accounts for the authenticated user
router.get('/', async (_req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const response = await axios.post(
      `${getBaseUrl()}/api/Account/search`,
      { onlyActiveAccounts: true },
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

export default router;
