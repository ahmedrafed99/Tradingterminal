import { Router } from 'express';
import { z } from 'zod';
import axios from 'axios';
import { validateBody } from '../validate';
import { withConnection } from '../middleware/withConnection';
import { getToken, authHeaders, getUserId, getUserApiBaseUrl } from '../adapters/projectx/auth';

const router = Router();

const AddLockoutSchema = z.object({
  tradingAccountId: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  expiresAt: z.string().datetime(),
});

// GET /lockout/active/:accountId — fetch active personal lockouts for an account
router.get('/active/:accountId', withConnection(async (req, res) => {
  const token = getToken();
  if (!token) { res.status(401).json({ success: false, errorMessage: 'Not connected' }); return; }

  const accountId = req.params['accountId'];
  const userApiBase = getUserApiBaseUrl();
  const response = await axios.get(
    `${userApiBase}/PersonalLockout/active/${accountId}`,
    { headers: authHeaders() },
  );

  // Array of active lockout objects; each has expiresAt
  const lockouts: { expiresAt: string }[] = Array.isArray(response.data) ? response.data : [];
  const active = lockouts
    .map((l) => ({ expiresAt: l.expiresAt, expiryMs: new Date(l.expiresAt).getTime() }))
    .filter((l) => l.expiryMs > Date.now())
    .sort((a, b) => b.expiryMs - a.expiryMs)[0] ?? null;

  res.json({ success: true, expiryMs: active?.expiryMs ?? null });
}));

router.post('/add', withConnection(async (req, res) => {
  const parsed = AddLockoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, errorMessage: parsed.error.issues[0]?.message ?? 'Invalid body' });
    return;
  }

  const token = getToken();
  if (!token) {
    res.status(401).json({ success: false, errorMessage: 'Not connected to ProjectX' });
    return;
  }

  const userId = getUserId();
  if (!userId) {
    res.status(500).json({ success: false, errorMessage: 'userId not available — reconnect and try again' });
    return;
  }

  const { tradingAccountId, expiresAt } = parsed.data;
  const now = new Date().toISOString();

  const payload = [{
    tradingAccountId,
    userId,
    createdAt: now,
    startsAt: now,
    expiresAt,
  }];

  const userApiBase = getUserApiBaseUrl();
  const response = await axios.post(
    `${userApiBase}/PersonalLockout/add`,
    payload,
    { headers: authHeaders() },
  );

  res.json(response.data);
}));

export default router;
