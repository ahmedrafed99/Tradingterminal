import 'dotenv/config';
import * as http from 'http';
import cors from 'cors';
import express from 'express';

import { getAdapter, setAdapter, isConnected } from './adapters/registry';
import { createProjectXAdapter } from './adapters/projectx';
import authRoutes from './routes/authRoutes';
import accountRoutes from './routes/accountRoutes';
import marketDataRoutes from './routes/marketDataRoutes';
import orderRoutes from './routes/orderRoutes';
import tradeRoutes from './routes/tradeRoutes';
import settingsRoutes from './routes/settingsRoutes';
import newsRoutes from './routes/newsRoutes';
import conditionRoutes from './routes/conditionRoutes';
import databaseRoutes from './routes/databaseRoutes';
import * as conditionEngine from './services/conditionEngine';
import * as databaseService from './services/databaseService';
import * as backfillService from './services/backfillService';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors({ origin: true }));
app.use(express.json());

// ---------------------------------------------------------------------------
// REST routes
// ---------------------------------------------------------------------------
app.use('/auth', authRoutes);
app.use('/accounts', accountRoutes);
app.use('/market', marketDataRoutes);
app.use('/orders', orderRoutes);
app.use('/trades', tradeRoutes);
app.use('/settings', settingsRoutes);
app.use('/news', newsRoutes);
app.use('/conditions', conditionRoutes);
app.use('/database', databaseRoutes);

// Health check — useful for smoke testing
app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// SignalR hub — HTTP negotiate proxy (/hubs/* HTTP requests)
//
// Delegates to the active exchange adapter's negotiate middleware.
// ---------------------------------------------------------------------------
app.use('/hubs', (req, res, next) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }
  getAdapter().realtime.negotiateMiddleware(req, res, next);
});

// ---------------------------------------------------------------------------
// HTTP server + WebSocket upgrade proxy
//
// Delegates to the active exchange adapter's upgrade handler.
// ---------------------------------------------------------------------------
const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  if (!isConnected()) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  getAdapter().realtime.handleUpgrade(req, socket, head);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Auto-connect from env vars (for headless / remote deployment)
// ---------------------------------------------------------------------------

async function autoConnect(): Promise<void> {
  const username = process.env.TOPSTEP_USERNAME;
  const apiKey = process.env.TOPSTEP_PASSWORD;
  if (!username || !apiKey) return;

  console.log(`[auto-connect] Connecting as ${username}...`);
  try {
    const adapter = createProjectXAdapter();
    await adapter.auth.connect({ username, apiKey });
    setAdapter(adapter);
    console.log('[auto-connect] Connected successfully');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[auto-connect] Failed:', msg);
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, async () => {
  console.log(`✓ Proxy running  →  http://localhost:${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  GET  /auth/status`);
  console.log(`  POST /auth/connect`);
  console.log(`  GET  /accounts`);
  console.log(`  GET  /market/contracts/search?q=`);
  console.log(`  POST /market/bars`);
  console.log(`  GET  /orders/open?accountId=`);
  console.log(`  GET  /trades/search?accountId=&startTimestamp=`);
  console.log(`  GET  /news/economic`);
  console.log(`  *    /conditions/*`);
  console.log(`  *    /database/*`);

  databaseService.init();
  databaseService.startAutoBackup();
  await autoConnect();
  conditionEngine.start();
  backfillService.startAutoSync();
});

// Graceful shutdown
process.on('SIGINT', () => {
  backfillService.stopAutoSync();
  conditionEngine.stop();
  databaseService.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  backfillService.stopAutoSync();
  conditionEngine.stop();
  databaseService.close();
  process.exit(0);
});
