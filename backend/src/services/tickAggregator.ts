/**
 * Tick Aggregator — builds candles from live quote ticks forwarded by the frontend.
 *
 * When the frontend is connected (local mode), it pushes quote ticks over a
 * WebSocket. This aggregator maintains one in-progress candle per
 * (contractId, timeframe) pair. When the clock rolls into a new candle period,
 * the previous candle's close is sent to evaluateBar() — zero delay.
 *
 * Falls back to REST polling (barAggregator) when no frontend is connected.
 */

import type { WebSocket } from 'ws';
import * as store from './conditionStore';
import { evaluateBar } from './conditionEngine';

// ---------------------------------------------------------------------------
// Candle state
// ---------------------------------------------------------------------------

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  periodStart: number; // candle start (epoch seconds)
}

// Key: `${contractId}|${timeframe}`, Value: current building candle
const candles = new Map<string, Candle>();

// Set of connected frontend WebSocket clients
const clients = new Set<WebSocket>();

// Timeframe → period in seconds (mirrors barAggregator's TIMEFRAME_MAP)
const PERIOD_SEC: Record<string, number> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  'D': 86400,
};

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function floorToPeriod(timestampSec: number, periodSec: number): number {
  return Math.floor(timestampSec / periodSec) * periodSec;
}

/**
 * Process a single quote tick.
 * Called for every GatewayQuote the frontend sends.
 */
export function processTick(contractId: string, price: number, timestampMs: number): void {
  const armed = store.getArmed();
  if (armed.length === 0) return;

  // Find all timeframes that have armed conditions for this contract
  const timeframes = new Set<string>();
  for (const c of armed) {
    if (c.contractId === contractId && PERIOD_SEC[c.timeframe]) {
      timeframes.add(c.timeframe);
    }
  }

  if (timeframes.size === 0) return;

  const tickSec = timestampMs / 1000;

  for (const tf of timeframes) {
    const periodSec = PERIOD_SEC[tf];
    const periodStart = floorToPeriod(tickSec, periodSec);
    const key = `${contractId}|${tf}`;
    const existing = candles.get(key);

    if (!existing) {
      // First tick for this pair — start a new candle
      candles.set(key, { open: price, high: price, low: price, close: price, periodStart });
      continue;
    }

    if (existing.periodStart === periodStart) {
      // Same candle — update OHLC
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
    } else {
      // New period — the old candle is closed!
      const closedClose = existing.close;
      const closedPeriodStart = existing.periodStart;

      // Replace with new candle
      candles.set(key, { open: price, high: price, low: price, close: price, periodStart });

      // Fire condition evaluation with the closed candle
      const barCloseIso = new Date((closedPeriodStart + periodSec) * 1000).toISOString();
      console.log(`[tickAggregator] Candle closed: ${contractId} ${tf} close=${closedClose} @ period ${new Date(closedPeriodStart * 1000).toISOString()}`);
      evaluateBar(contractId, tf, closedClose, barCloseIso).catch((err) => {
        console.error(`[tickAggregator] evaluateBar error:`, err instanceof Error ? err.message : err);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocket client management
// ---------------------------------------------------------------------------

export function addClient(ws: WebSocket): void {
  clients.add(ws);
  console.log(`[tickAggregator] Frontend connected (${clients.size} client(s))`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // Expected format: { contractId: string, price: number, timestamp: number }
      if (msg.contractId && typeof msg.price === 'number' && msg.timestamp) {
        processTick(msg.contractId, msg.price, msg.timestamp);
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[tickAggregator] Frontend disconnected (${clients.size} client(s))`);
  });
}

/** Whether any frontend is forwarding ticks (used by barAggregator to skip polling) */
export function hasLiveClients(): boolean {
  return clients.size > 0;
}

/** Clear all candle state (e.g. on disconnect) */
export function clear(): void {
  candles.clear();
}
