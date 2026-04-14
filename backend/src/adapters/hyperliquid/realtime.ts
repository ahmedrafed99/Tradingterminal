import WebSocket, { WebSocketServer } from 'ws';
import type * as net from 'net';
import type * as http from 'http';
import type { Duplex } from 'stream';
import type { NativeWsRealtime } from '../types';
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

export function createRealtime(state: HlState): NativeWsRealtime {
  // Scoped to this adapter instance — avoids sharing across reconnects
  const wss = new WebSocketServer({ noServer: true });
  // These live in the closure — isolated per adapter instance
  const clients = new Set<WebSocket>();
  const subscriptions = new Map<string, Record<string, unknown>>();
  let upstream: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 2000; // starts at 2s, doubles up to 60s

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
      reconnectDelay = 2000; // reset backoff on successful connection
      replaySubscriptions();
    });

    upstream.on('message', (data) => {
      broadcastToClients(data.toString());
    });

    upstream.on('close', (code, reason) => {
      console.log(`[HL WS] upstream closed (${code} ${reason.toString()})`);
      upstream = null;
      // Reconnect if we still have clients (exponential backoff, cap at 60s)
      if (clients.size > 0) {
        console.log(`[HL WS] reconnecting in ${reconnectDelay}ms`);
        reconnectTimer = setTimeout(connectUpstream, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 60000);
      }
    });

    upstream.on('error', (err) => {
      console.error('[HL WS] upstream error:', err.message);
    });
  }

  function disconnectUpstream(): void {
    reconnectDelay = 2000;
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
    kind: 'ws' as const,
    wsPath: '/ws/hl',

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
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ error: 'invalid message', detail: (err as Error).message }));
            }
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
