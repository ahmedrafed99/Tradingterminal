import { Router } from 'express';
import * as auth from '../auth';

const router = Router();

// POST /auth/connect
// Accepts both "userName" (ProjectX style) and "username" (our style)
// baseUrl is optional — defaults to https://api.topstepx.com
// Minimal body: { "userName": "yourname", "apiKey": "yourkey" }
router.post('/connect', async (req, res) => {
  const body = req.body as Record<string, string>;

  // Accept either casing
  const username = body['username'] ?? body['userName'];
  const apiKey   = body['apiKey'];
  const baseUrl  = body['baseUrl'];   // optional

  if (!username || !apiKey) {
    res.status(400).json({
      success: false,
      errorMessage: 'userName (or username) and apiKey are required',
    });
    return;
  }

  try {
    await auth.connect(username, apiKey, baseUrl);
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(401).json({ success: false, errorMessage: msg });
  }
});

// POST /auth/disconnect
router.post('/disconnect', (_req, res) => {
  auth.disconnect();
  res.json({ success: true });
});

// GET /auth/status
router.get('/status', (_req, res) => {
  res.json({
    connected: auth.isConnected(),
    baseUrl: auth.getBaseUrl(),
  });
});

// GET /auth/token — exposes JWT for internal use (SignalR direct connect)
router.get('/token', (_req, res) => {
  const token = auth.getToken();
  if (!token) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }
  res.json({ success: true, token });
});

export default router;
