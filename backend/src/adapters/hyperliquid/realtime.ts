import WebSocket, { WebSocketServer } from 'ws';
import type * as net from 'net';
import type * as http from 'http';
import type { Duplex } from 'stream';
import type { Request, Response } from 'express';
import type { ExchangeRealtime } from '../types';
import type { HlState } from './client';

// ---------------------------------------------------------------------------
// Canonical subscription key — sort keys so identical subscriptions always
// produce the same string regardless of property insertion order
// ---------------------------------------------------------------------------
function subscriptionKey(sub: Record<string, unknown>): string {
  const sorted = Object.fromEntries(
    Object.entries(sub).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(sorted);
}

// ---------------------------------------------------------------------------
// WebSocket upgrade server (noServer — we do the upgrade manually)
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

export function createRealtime(state: HlState): ExchangeRealtime {
  // These live in the closure — isolated per adapter instance
  const clients = new Set<WebSocket>();
  const subscriptions = new Map<string, Record<string, unknown>>();
  let upstream: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function wsUrl(): string {
    return state.apiUrl.replace(/^https?/, 'wss') + '/ws';
  }

  function sendToUpstream(msg: string): void {
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.send(msg);
    }
  }

  function broadcastToClients(msg: string): void {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  function replaySubscriptions(): void {
    for (const sub of subscriptions.values()) {
      sendToUpstream(JSON.stringify({ method: 'subscribe', subscription: sub }));
    }
  }

  function connectUpstream(): void {
    if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
      return; // Already open or connecting
    }

    console.log('[HL WS] connecting upstream', wsUrl());
    upstream = new WebSocket(wsUrl());

    upstream.on('open', () => {
      console.log('[HL WS] upstream open — replaying', subscriptions.size, 'subscriptions');
      replaySubscriptions();
    });

    upstream.on('message', (data) => {
      broadcastToClients(data.toString());
    });

    upstream.on('close', (code, reason) => {
      console.log(`[HL WS] upstream closed (${code} ${reason.toString()})`);
      upstream = null;
      // Reconnect if we still have clients
      if (clients.size > 0) {
        reconnectTimer = setTimeout(connectUpstream, 2000);
      }
    });

    upstream.on('error', (err) => {
      console.error('[HL WS] upstream error:', err.message);
    });
  }

  function disconnectUpstream(): void {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (upstream) {
      upstream.removeAllListeners();
      upstream.close();
      upstream = null;
    }
  }

  return {
    // Hyperliquid doesn't use SignalR — return 404 for any negotiate request
    negotiateMiddleware(_req: Request, res: Response) {
      res.status(404).json({
        success: false,
        errorMessage: 'Hyperliquid does not use SignalR hubs. Connect via /ws/hl instead.',
      });
    },

    handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
      wss.handleUpgrade(req, socket as net.Socket, head, (ws) => {
        clients.add(ws);
        console.log(`[HL WS] client connected (total: ${clients.size})`);

        // Start upstream if not running
        connectUpstream();

        ws.on('message', (data) => {
          const raw = data.toString();
          try {
            const msg = JSON.parse(raw) as Record<string, unknown>;
            if (msg['method'] === 'subscribe' && msg['subscription']) {
              const sub = msg['subscription'] as Record<string, unknown>;
              const key = subscriptionKey(sub);
              subscriptions.set(key, sub);
              sendToUpstream(raw);
            } else if (msg['method'] === 'unsubscribe' && msg['subscription']) {
              const sub = msg['subscription'] as Record<string, unknown>;
              const key = subscriptionKey(sub);
              subscriptions.delete(key);
              sendToUpstream(raw);
            } else {
              sendToUpstream(raw);
            }
          } catch (err) {
            console.error('[HL WS] client message parse error:', (err as Error).message);
          }
        });

        ws.on('close', () => {
          clients.delete(ws);
          console.log(`[HL WS] client disconnected (remaining: ${clients.size})`);
          if (clients.size === 0) {
            console.log('[HL WS] last client gone — closing upstream');
            subscriptions.clear();
            disconnectUpstream();
          }
        });

        ws.on('error', (err) => {
          console.error('[HL WS] client error:', err.message);
          clients.delete(ws);
        });
      });
    },
  };
}
