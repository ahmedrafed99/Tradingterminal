/**
 * Forwards quote ticks to the backend's tick aggregator over WebSocket.
 *
 * When conditions are armed, this opens a WS to the backend and sends
 * every quote tick so the backend can aggregate candles and evaluate
 * conditions in real-time (zero delay on candle close).
 */

import { realtimeService } from './realtimeService';
import type { GatewayQuote } from './realtimeService';
import { resolveConditionServerUrl } from '../store/slices/conditionsSlice';
import { useStore } from '../store/useStore';

let ws: WebSocket | null = null;
let quoteHandler: ((contractId: string, data: GatewayQuote) => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function getWsUrl(): string {
  const httpUrl = resolveConditionServerUrl(useStore.getState().conditionServerUrl);
  return httpUrl.replace(/^http/, 'ws') + '/ws/condition-quotes';
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const url = getWsUrl();
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[conditionTickForwarder] Connected to backend');
  };

  ws.onclose = () => {
    ws = null;
    // Reconnect if we still have armed conditions
    const armed = useStore.getState().conditions.filter((c) => c.status === 'armed');
    if (armed.length > 0) {
      reconnectTimer = setTimeout(connect, 3000);
    }
  };

  ws.onerror = () => {
    // onclose will fire after this
  };
}

function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (quoteHandler) {
    realtimeService.offQuote(quoteHandler);
    quoteHandler = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}

function startForwarding(): void {
  if (quoteHandler) return; // already forwarding

  connect();

  quoteHandler = (contractId: string, data: GatewayQuote) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (data.lastPrice == null || !isFinite(data.lastPrice)) return;

    ws.send(JSON.stringify({
      contractId,
      price: data.lastPrice,
      timestamp: new Date(data.lastUpdated).getTime(),
    }));
  };

  realtimeService.onQuote(quoteHandler);
  console.log('[conditionTickForwarder] Started forwarding ticks');
}

/**
 * Call this whenever conditions change. It will start or stop forwarding
 * based on whether any conditions are armed.
 */
export function syncForwarder(hasArmedConditions: boolean): void {
  if (hasArmedConditions) {
    startForwarding();
  } else {
    disconnect();
  }
}
