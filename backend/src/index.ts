import 'dotenv/config';
import * as http from 'http';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { getAdapter, setAdapter, isConnected } from './adapters/registry';
import { createAdapter } from './adapters/factory';
import authRoutes from './routes/authRoutes';
import accountRoutes from './routes/accountRoutes';
import marketDataRoutes from './routes/marketDataRoutes';
import orderRoutes from './routes/orderRoutes';
import positionRoutes from './routes/positionRoutes';
import tradeRoutes from './routes/tradeRoutes';
import settingsRoutes from './routes/settingsRoutes';
import credentialRoutes from './routes/credentialRoutes';
import newsRoutes from './routes/newsRoutes';
import conditionRoutes from './routes/conditionRoutes';
import databaseRoutes from './routes/databaseRoutes';
import drawingRoutes from './routes/drawingRoutes';
import WebSocket from 'ws';
import * as conditionEngine from './services/conditionEngine';
import * as conditionStore from './services/conditionStore';
import * as databaseService from './services/databaseService';
import * as backfillService from './services/backfillService';
import * as tickAggregator from './services/tickAggregator';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Rate limiters — prevent runaway loops from burning ProjectX API quota
const orderLimiter = rateLimit({
  windowMs: 1_000,       // 1-second window
  max: 10,               // max 10 order actions/sec
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, errorMessage: 'Order rate limit exceeded (10/sec)' },
});

const apiLimiter = rateLimit({
  windowMs: 1_000,
  max: 30,               // max 30 general API calls/sec
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, errorMessage: 'API rate limit exceeded (30/sec)' },
});

app.use('/orders', orderLimiter);
app.use('/market', apiLimiter);
app.use('/positions', apiLimiter);
app.use('/trades', apiLimiter);
app.use('/accounts', apiLimiter);

// ---------------------------------------------------------------------------
// REST routes
// ---------------------------------------------------------------------------
app.use('/auth', authRoutes);
app.use('/accounts', accountRoutes);
app.use('/market', marketDataRoutes);
app.use('/orders', orderRoutes);
app.use('/positions', positionRoutes);
app.use('/trades', tradeRoutes);
app.use('/settings', settingsRoutes);
app.use('/credentials', credentialRoutes);
app.use('/news', newsRoutes);
app.use('/conditions', conditionRoutes);
app.use('/database', databaseRoutes);
app.use('/drawings', drawingRoutes);

// Health check — connection status, condition engine, backfill
app.get('/health', (_req, res) => {
  const armed = conditionStore.getArmed();
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    connected: isConnected(),
    conditions: { armed: armed.length, total: conditionStore.getAll().length },
    backfill: { autoSyncRunning: backfillService.isAutoSyncRunning() },
  });
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
  const { realtime } = getAdapter();
  if (realtime?.negotiateMiddleware) {
    realtime.negotiateMiddleware(req, res, next);
  } else {
    res.status(404).json({ success: false, errorMessage: 'This exchange does not support SignalR hubs' });
  }
});

// ---------------------------------------------------------------------------
// HTTP server + WebSocket upgrade proxy
//
// Delegates to the active exchange adapter's upgrade handler.
// ---------------------------------------------------------------------------
const server = http.createServer(app);

// WebSocket server for frontend → backend tick forwarding (condition engine)
const conditionWss = new WebSocket.Server({ noServer: true });
conditionWss.on('connection', (ws) => tickAggregator.addClient(ws));

server.on('upgrade', (req, socket, head) => {
  const url = req.url ?? '';

  // Condition tick feed — no auth needed (local only)
  if (url.startsWith('/ws/condition-quotes')) {
    conditionWss.handleUpgrade(req, socket, head, (ws) => {
      conditionWss.emit('connection', ws, req);
    });
    return;
  }

  if (!isConnected()) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const { realtime } = getAdapter();
  if (realtime?.handleUpgrade) {
    realtime.handleUpgrade(req, socket, head);
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Auto-connect from env vars (for headless / remote deployment)
// ---------------------------------------------------------------------------

async function autoConnect(): Promise<void> {
  // Generic: AUTO_CONNECT_EXCHANGE + AUTO_CONNECT_CREDENTIALS (JSON)
  // Legacy: TOPSTEP_USERNAME + TOPSTEP_PASSWORD → projectx
  const exchange = process.env.AUTO_CONNECT_EXCHANGE ?? (process.env.TOPSTEP_USERNAME ? 'projectx' : '');
  if (!exchange) return;

  let credentials: Record<string, string>;
  if (process.env.AUTO_CONNECT_CREDENTIALS) {
    try {
      credentials = JSON.parse(process.env.AUTO_CONNECT_CREDENTIALS);
    } catch {
      console.error('[auto-connect] AUTO_CONNECT_CREDENTIALS is not valid JSON');
      return;
    }
  } else {
    // Legacy env vars
    const username = process.env.TOPSTEP_USERNAME;
    const apiKey = process.env.TOPSTEP_PASSWORD;
    if (!username || !apiKey) return;
    credentials = { username, apiKey };
  }

  console.log(`[auto-connect] Connecting to ${exchange}...`);
  try {
    const adapter = createAdapter(exchange);
    await adapter.auth.connect({ exchange, credentials });
    setAdapter(exchange, adapter);
    console.log(`[auto-connect] Connected to ${exchange} successfully`);
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
  console.log(`  GET  /positions/open?accountId=`);
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
