import { Router } from 'express';
import { withConnection } from '../middleware/withConnection';
import { listConnected, getAdapter } from '../adapters/registry';

const router = Router();

// GET /accounts — aggregate accounts from all connected adapters
router.get('/', withConnection(async (_req, res) => {
  const connected = listConnected();
  const results = await Promise.allSettled(
    connected.map((id) => getAdapter(id).accounts.list() as Promise<{ accounts?: unknown[] }>),
  );
  const allAccounts = results.flatMap((r) =>
    r.status === 'fulfilled' ? (r.value.accounts ?? []) : [],
  );
  res.json({ success: true, accounts: allAccounts });
}));

// GET /accounts/eligibility — aggregate eligibility from all connected adapters
router.get('/eligibility', withConnection(async (_req, res) => {
  const connected = listConnected();
  const results = await Promise.allSettled(
    connected.map(async (id) => {
      const accts = getAdapter(id).accounts;
      if (!accts.eligibility) return [];
      return accts.eligibility() as Promise<unknown[]>;
    }),
  );
  const allEligibility = results.flatMap((r) =>
    r.status === 'fulfilled' ? r.value : [],
  );
  res.json(allEligibility);
}));

export default router;
