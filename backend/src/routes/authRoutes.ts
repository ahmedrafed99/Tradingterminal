import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../validate';
import { getAdapter, setAdapter, removeAdapter, isConnected, listConnected, getDefaultExchangeId, setDefaultExchangeId } from '../adapters/registry';
import { createAdapter, listExchanges } from '../adapters/factory';

const router = Router();

const ConnectSchema = z.object({
  exchange: z.string().min(1).default('projectx'),
  credentials: z.record(z.string(), z.string()).default({}),
  // Legacy ProjectX fields — mapped to credentials internally
  userName: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
});

// POST /auth/connect
router.post('/connect', validateBody(ConnectSchema), async (req, res) => {
  const body = req.body as z.infer<typeof ConnectSchema>;
  const exchange = body.exchange;

  // Build credentials: merge legacy fields into credentials map
  const credentials: Record<string, string> = { ...body.credentials };
  if (!credentials['username'] && (body.username || body.userName)) {
    credentials['username'] = body.username ?? body.userName!;
  }
  if (!credentials['apiKey'] && body.apiKey) {
    credentials['apiKey'] = body.apiKey;
  }
  if (!credentials['baseUrl'] && body.baseUrl) {
    credentials['baseUrl'] = body.baseUrl;
  }

  try {
    const adapter = createAdapter(exchange);
    await adapter.auth.connect({
      exchange,
      credentials,
      baseUrl: credentials['baseUrl'],
    });
    setAdapter(exchange, adapter);
    res.json({ success: true, exchange });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(401).json({ success: false, errorMessage: msg });
  }
});

// POST /auth/disconnect
router.post('/disconnect', (req, res) => {
  const exchange = (req.body as Record<string, unknown>)?.exchange as string | undefined;

  if (exchange) {
    // Disconnect specific exchange
    if (isConnected(exchange)) {
      getAdapter(exchange).auth.disconnect();
      removeAdapter(exchange);
    }
  } else {
    // Disconnect all
    for (const id of listConnected()) {
      getAdapter(id).auth.disconnect();
      removeAdapter(id);
    }
  }
  res.json({ success: true });
});

// GET /auth/status
router.get('/status', (_req, res) => {
  const connected = listConnected();
  if (connected.length === 0) {
    res.json({ connected: false });
    return;
  }
  const defaultId = getDefaultExchangeId();
  const statuses = Object.fromEntries(
    connected.map((id) => [id, getAdapter(id).auth.getStatus()]),
  );
  res.json({
    connected: true,
    defaultExchange: defaultId,
    exchanges: statuses,
    // Legacy compat: include top-level fields from default adapter
    ...(defaultId ? getAdapter(defaultId).auth.getStatus() : {}),
  });
});

// GET /auth/exchanges — list available exchange types
router.get('/exchanges', (_req, res) => {
  res.json({ exchanges: listExchanges(), connected: listConnected() });
});

// POST /auth/default — set default exchange
router.post('/default', (req, res) => {
  const exchange = (req.body as Record<string, unknown>)?.exchange as string | undefined;
  if (!exchange) {
    res.status(400).json({ success: false, errorMessage: 'exchange is required' });
    return;
  }
  try {
    setDefaultExchangeId(exchange);
    res.json({ success: true, defaultExchange: exchange });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ success: false, errorMessage: msg });
  }
});

export default router;
