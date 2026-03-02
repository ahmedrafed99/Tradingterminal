import * as http from 'http';
import axios from 'axios';
import cors from 'cors';
import express from 'express';
import httpProxy from 'http-proxy';

import { getRtcBaseUrl, getToken, isConnected, authHeaders } from './auth';
import authRoutes from './routes/authRoutes';
import accountRoutes from './routes/accountRoutes';
import marketDataRoutes from './routes/marketDataRoutes';
import orderRoutes from './routes/orderRoutes';
import tradeRoutes from './routes/tradeRoutes';

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

// Health check — useful for smoke testing
app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// SignalR hub — HTTP negotiate proxy (/hubs/* HTTP requests)
//
// SignalR first POSTs to /hubs/<hub>/negotiate before upgrading to WebSocket.
// We proxy those negotiate HTTP calls here, injecting the JWT server-side.
// ---------------------------------------------------------------------------
app.use('/hubs', async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const targetUrl = `${getRtcBaseUrl()}${req.originalUrl}`;
    const response = await axios({
      method: req.method as 'GET' | 'POST' | 'PUT' | 'DELETE',
      url: targetUrl,
      headers: {
        ...authHeaders(),
        // preserve content-type from the client if present
        ...(req.headers['content-type']
          ? { 'Content-Type': req.headers['content-type'] }
          : {}),
      },
      data: Object.keys(req.body ?? {}).length ? req.body : undefined,
      // Don't let axios parse the response — pass it through raw
      responseType: 'arraybuffer',
      validateStatus: () => true, // pass all HTTP statuses through
    });

    res.status(response.status);
    // Forward content-type from upstream
    const ct = response.headers['content-type'];
    if (ct) res.setHeader('Content-Type', ct);
    res.send(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

// ---------------------------------------------------------------------------
// HTTP server + WebSocket upgrade proxy for SignalR
//
// After negotiate, the SignalR client upgrades to WebSocket.
// Incoming WS path:  ws://localhost:3001/hubs/market
// Forwarded to:      wss://rtc.topstepx.com/hubs/market
// The JWT is injected via the Authorization header here server-side.
// ---------------------------------------------------------------------------
const wsProxy = httpProxy.createProxyServer({ changeOrigin: true });

wsProxy.on('error', (err, _req, socket) => {
  console.error('[WS proxy error]', err.message);
  if (socket && 'destroy' in socket) (socket as NodeJS.Socket).destroy();
});

const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  const url = req.url ?? '';
  console.log(`[WS upgrade] ${url}`);

  // Only proxy WebSocket connections to /hubs/*
  if (!url.startsWith('/hubs/')) {
    console.log('[WS upgrade] not a /hubs/ path, destroying');
    socket.destroy();
    return;
  }

  const token = getToken();
  if (!token) {
    console.log('[WS upgrade] no token, rejecting');
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Inject the JWT as a query parameter — SignalR servers read access_token
  // from the URL, not the Authorization header, for WebSocket connections.
  const sep = url.includes('?') ? '&' : '?';
  req.url = `${url}${sep}access_token=${encodeURIComponent(token)}`;

  // Convert https → wss for the target (uses RTC host, not API host)
  const baseWss = getRtcBaseUrl().replace(/^https/, 'wss').replace(/^http/, 'ws');
  console.log(`[WS upgrade] proxying ${url} → ${baseWss}`);

  wsProxy.ws(req, socket, head, { target: baseWss }, (err) => {
    console.error('[WS proxy upgrade error]', err?.message);
    socket.destroy();
  });
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
