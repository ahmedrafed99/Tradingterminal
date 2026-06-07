import { Router } from 'express';
import { z } from 'zod';
import axios from 'axios';
import { validateBody } from '../validate';
import { withConnection, resolveAdapter } from '../middleware/withConnection';

const router = Router();

const AddLockoutSchema = z.object({
  tradingAccountId: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  expiresAt: z.string().datetime(),
});

// GET /lockout/active/:accountId — fetch active personal lockouts for an account
router.get('/active/:accountId', withConnection(async (req, res) => {
  const accountId = req.params['accountId'];
  // Route via accountId so multi-account works correctly
  req.body = { ...(req.body ?? {}), accountId };
  const auth = resolveAdapter(req).auth;
  const token = auth.getRealtimeCredentials?.()?.token;
  if (!token) { res.status(401).json({ success: false, errorMessage: 'Not connected' }); return; }

  const userApiBase = auth.getUserApiBaseUrl?.();
  if (!userApiBase) { res.status(500).json({ success: false, errorMessage: 'userApiBase unavailable' }); return; }

  const response = await axios.get(
    `${userApiBase}/PersonalLockout/active/${accountId}`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } },
  );

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

  // tradingAccountId is used to route to the correct connection
  const body = req.body as { tradingAccountId?: string | number };
  if (body.tradingAccountId) {
    req.body = { ...req.body, accountId: String(body.tradingAccountId) };
  }
  const auth = resolveAdapter(req).auth;
  const token = auth.getRealtimeCredentials?.()?.token;
  if (!token) {
    res.status(401).json({ success: false, errorMessage: 'Not connected to ProjectX' });
    return;
  }

  const userId = auth.getUserId?.();
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

  const userApiBase = auth.getUserApiBaseUrl?.();
  if (!userApiBase) {
    res.status(500).json({ success: false, errorMessage: 'userApiBase unavailable' });
    return;
  }

  const response = await axios.post(
    `${userApiBase}/PersonalLockout/add`,
    payload,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } },
  );

  res.json(response.data);
}));

export default router;
