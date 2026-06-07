import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../validate';
import { getAdapter, setAdapter, removeAdapter, isConnected, listConnected, getDefaultExchangeId, setDefaultExchangeId, registerAccountConnection, unregisterConnectionAccounts, getAdapterForAccount } from '../adapters/registry';
import { createAdapter, listExchanges } from '../adapters/factory';
import { realtimeService } from '../services/realtimeService';

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

  // For ProjectX, use username as the connectionId so multiple accounts can coexist
  const connectionId = exchange === 'projectx'
    ? (credentials['username'] ?? exchange)
    : exchange;

  try {
    const adapter = createAdapter(exchange);
    await adapter.auth.connect({
      exchange,
      credentials,
      baseUrl: credentials['baseUrl'],
    });
    setAdapter(connectionId, adapter);

    // Register each account → connectionId mapping for routing
    if (exchange === 'projectx') {
      try {
        const accountsData = await adapter.accounts.list() as { accounts?: { id: number | string }[] };
        const accountIds = (accountsData.accounts ?? []).map((a) => String(a.id));
        for (const aid of accountIds) {
          registerAccountConnection(aid, connectionId);
        }
        // Register with realtimeService BEFORE starting its hub so the initial
        // subscription flush routes to the right user hub
        const rtCreds = adapter.auth.getRealtimeCredentials?.();
        if (rtCreds) {
          realtimeService.registerConnectionAccounts(connectionId, accountIds);
          realtimeService.connect(connectionId, rtCreds.token, rtCreds.rtcBaseUrl).catch((err) => {
            console.error('[auth] realtimeService connect failed:', err instanceof Error ? err.message : err);
          });
        }
      } catch (err) {
        console.warn('[auth] account registration failed (non-fatal):', err instanceof Error ? err.message : err);
      }
    }

    res.json({ success: true, exchange, connectionId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[auth/connect]', msg);
    res.status(401).json({ success: false, errorMessage: 'Authentication failed' });
  }
});

// POST /auth/disconnect
router.post('/disconnect', (req, res) => {
  const body = req.body as Record<string, unknown>;
  // Accept both `exchange` (legacy) and `connectionId`
  const connectionId = (body?.connectionId ?? body?.exchange) as string | undefined;

  if (connectionId) {
    if (isConnected(connectionId)) {
      getAdapter(connectionId).auth.disconnect();
      unregisterConnectionAccounts(connectionId);
      removeAdapter(connectionId);
    }
    // Tear down only this account's user hub; market hub + other user hubs stay up
    realtimeService.disconnectUser(connectionId).catch(() => {});
  } else {
    // Disconnect all
    for (const id of listConnected()) {
      getAdapter(id).auth.disconnect();
      unregisterConnectionAccounts(id);
      removeAdapter(id);
    }
    realtimeService.disconnect().catch(() => {});
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
