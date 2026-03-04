import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../validate';
import { getAdapter, setAdapter, clearAdapter, isConnected } from '../adapters/registry';
import { createProjectXAdapter } from '../adapters/projectx';

const router = Router();

const ConnectSchema = z
  .object({
    userName: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    apiKey: z.string().min(1, 'apiKey is required'),
    baseUrl: z.string().url().optional(),
  })
  .refine((d) => d.userName || d.username, {
    message: 'userName (or username) is required',
  });

// POST /auth/connect
// Accepts both "userName" (ProjectX style) and "username" (our style)
// baseUrl is optional — defaults to https://api.topstepx.com
router.post('/connect', validateBody(ConnectSchema), async (req, res) => {
  const body = req.body as Record<string, string>;
  const username = body['username'] ?? body['userName'];
  const apiKey = body['apiKey'];
  const baseUrl = body['baseUrl'];

  try {
    const adapter = createProjectXAdapter();
    await adapter.auth.connect({ username, apiKey, baseUrl });
    setAdapter(adapter);
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(401).json({ success: false, errorMessage: msg });
  }
});

// POST /auth/disconnect
router.post('/disconnect', (_req, res) => {
  if (isConnected()) {
    getAdapter().auth.disconnect();
    clearAdapter();
  }
  res.json({ success: true });
});

// GET /auth/status
router.get('/status', (_req, res) => {
  if (!isConnected()) {
    res.json({ connected: false });
    return;
  }
  res.json(getAdapter().auth.getStatus());
});

export default router;
