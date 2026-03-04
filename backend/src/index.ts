import * as http from 'http';
import cors from 'cors';
import express from 'express';

import { getAdapter, isConnected } from './adapters/registry';
import authRoutes from './routes/authRoutes';
import accountRoutes from './routes/accountRoutes';
import marketDataRoutes from './routes/marketDataRoutes';
import orderRoutes from './routes/orderRoutes';
import tradeRoutes from './routes/tradeRoutes';
import settingsRoutes from './routes/settingsRoutes';

const PORT = 3001;
const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors({ origin: 'http://localhost:5173' }));
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
server.listen(PORT, () => {
  console.log(`✓ Proxy running  →  http://localhost:${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  GET  /auth/status`);
  console.log(`  POST /auth/connect`);
  console.log(`  GET  /accounts`);
  console.log(`  GET  /market/contracts/search?q=`);
  console.log(`  POST /market/bars`);
  console.log(`  GET  /orders/open?accountId=`);
  console.log(`  GET  /trades/search?accountId=&startTimestamp=`);
});
