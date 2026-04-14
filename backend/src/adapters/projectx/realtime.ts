import axios from 'axios';
import httpProxy from 'http-proxy';
import type * as http from 'http';
import type * as net from 'net';
import type { Duplex } from 'stream';
import type { Request, Response } from 'express';
import type { ExchangeRealtime } from '../types';
import { getRtcBaseUrl, getToken, authHeaders } from './auth';

const wsProxy = httpProxy.createProxyServer({ changeOrigin: true });

wsProxy.on('error', (err, _req, socket) => {
  console.error('[WS proxy error]', err.message);
  if (socket && 'destroy' in socket) (socket as net.Socket).destroy();
});

export const projectXRealtime: ExchangeRealtime = {
  kind: 'signalr',
  async negotiateMiddleware(req: Request, res: Response) {
    try {
      const targetUrl = `${getRtcBaseUrl()}${req.originalUrl}`;
      const response = await axios({
        method: req.method as 'GET' | 'POST' | 'PUT' | 'DELETE',
        url: targetUrl,
        headers: {
          ...authHeaders(),
          ...(req.headers['content-type']
            ? { 'Content-Type': req.headers['content-type'] }
            : {}),
        },
        data: Object.keys(req.body ?? {}).length ? req.body : undefined,
        responseType: 'arraybuffer',
        validateStatus: () => true,
      });

      res.status(response.status);
      const ct = response.headers['content-type'];
      if (ct) res.setHeader('Content-Type', ct);
      res.send(response.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(502).json({ success: false, errorMessage: msg });
    }
  },

  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
    const url = req.url ?? '';
    console.log(`[WS upgrade] ${url}`);

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

    const sep = url.includes('?') ? '&' : '?';
    req.url = `${url}${sep}access_token=${encodeURIComponent(token)}`;

    const baseWss = getRtcBaseUrl().replace(/^https/, 'wss').replace(/^http/, 'ws');
    console.log(`[WS upgrade] proxying ${url} → ${baseWss}`);

    wsProxy.ws(req, socket, head, { target: baseWss }, (err) => {
      console.error('[WS proxy upgrade error]', err?.message);
      socket.destroy();
    });
  },
};
