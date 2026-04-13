/**
 * Tick Aggregator — builds candles from live quote ticks forwarded by the frontend.
 *
 * When the frontend is connected (local mode), it pushes quote ticks over a
 * WebSocket. This aggregator maintains one in-progress candle per
 * (contractId, timeframe) pair. When the clock rolls into a new candle period,
 * the previous candle's close is sent to evaluateBar() — zero delay.
 *
 * Falls back to REST polling (barAggregator) when no frontend is connected.
 *
 * Boundary timers: in addition to detecting bar close from the first new-period
 * tick, we schedule a setTimeout aligned to the candle boundary (+ 250ms buffer).
 * This mirrors the CountdownPrimitive's Date.now() math and fires ~250ms after
 * bar close regardless of when the next exchange tick arrives — eliminating the
 * 1–3s delay caused by waiting for the exchange to start printing a new period.
 * Dedup prevents double-evaluation if both paths fire for the same candle.
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

// Last completed candle close per key — saved when a candle rolls over so the
// boundary timer can still access it even after the candle map is replaced.
const prevCompleted = new Map<string, { close: number; periodStart: number }>();

// Dedup: tracks the periodStart (seconds) of the last evaluated candle per key.
// Prevents double-fire when both the tick path and the boundary timer trigger
// evaluateBar for the same candle close.
const lastEvaluated = new Map<string, number>();

// Active boundary timers per key
const boundaryTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Set of connected frontend WebSocket clients
const clients = new Set<WebSocket>();

// How long after candle boundary to fire evaluation (ms).
// Covers in-flight tick latency (~20–100ms RTT) while staying far faster than
// the 3s REST poll buffer.
const EVAL_BUFFER_MS = 250;

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
      // New period — the old candle is closed.
      const closedClose = existing.close;
      const closedPeriodStart = existing.periodStart;

      // Save previous close before replacing — boundary timer may need it if
      // the candle is already replaced by the time the timer fires.
      prevCompleted.set(key, { close: closedClose, periodStart: closedPeriodStart });

      // Replace with new candle
      candles.set(key, { open: price, high: price, low: price, close: price, periodStart });

      // Dedup: skip if boundary timer already evaluated this candle
      const alreadyEval = lastEvaluated.get(key);
      if (alreadyEval === closedPeriodStart) {
        console.log(`[tickAggregator] Tick path: candle already evaluated by boundary timer ${contractId} ${tf}`);
        continue;
      }
      lastEvaluated.set(key, closedPeriodStart);

      const barCloseIso = new Date((closedPeriodStart + periodSec) * 1000).toISOString();
      console.log(`[tickAggregator] Tick close: ${contractId} ${tf} close=${closedClose} @ period ${new Date(closedPeriodStart * 1000).toISOString()}`);
      evaluateBar(contractId, tf, closedClose, barCloseIso).catch((err) => {
        console.error(`[tickAggregator] evaluateBar error:`, err instanceof Error ? err.message : err);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Boundary timers — Date.now() aligned, mirrors CountdownPrimitive math
// ---------------------------------------------------------------------------

/**
 * Schedule a timer that fires EVAL_BUFFER_MS after the next candle boundary
 * for a specific (contractId, timeframe) pair.
 *
 * Uses the same Math.ceil(nowMs / periodMs) * periodMs math as CountdownPrimitive
 * so it fires at the same moment the countdown resets, plus a small buffer for
 * in-flight ticks to arrive.
 */
function scheduleBoundaryTimer(contractId: string, tf: string, periodSec: number): void {
  const key = `${contractId}|${tf}`;

  // Clear any existing timer for this pair
  const existing = boundaryTimers.get(key);
  if (existing) clearTimeout(existing);

  const nowMs = Date.now();
  const periodMs = periodSec * 1000;
  const nextBoundaryMs = Math.ceil(nowMs / periodMs) * periodMs;

  // The period that is about to close (starts periodSec before the boundary)
  const closingPeriodStartSec = (nextBoundaryMs - periodMs) / 1000;

  const delay = nextBoundaryMs - nowMs + EVAL_BUFFER_MS;

  const timer = setTimeout(() => {
    boundaryTimers.delete(key);

    // Only evaluate if a frontend is still connected
    if (clients.size === 0) return;

    // Dedup: if tick path already evaluated this candle, skip
    const alreadyEval = lastEvaluated.get(key);
    if (alreadyEval === closingPeriodStartSec) {
      console.log(`[tickAggregator] Boundary timer: already evaluated by tick path ${contractId} ${tf}`);
    } else {
      // Resolve the close price: prefer current candle if still same period,
      // otherwise fall back to prevCompleted (candle already replaced by new tick)
      const candle = candles.get(key);
      let closePrice: number | null = null;

      if (candle && candle.periodStart === closingPeriodStartSec) {
        closePrice = candle.close;
      } else {
        const prev = prevCompleted.get(key);
        if (prev && prev.periodStart === closingPeriodStartSec) {
          closePrice = prev.close;
        }
      }

      if (closePrice !== null) {
        lastEvaluated.set(key, closingPeriodStartSec);
        const barCloseIso = new Date(nextBoundaryMs).toISOString();
        console.log(`[tickAggregator] Boundary eval: ${contractId} ${tf} close=${closePrice} (${EVAL_BUFFER_MS}ms after boundary)`);
        evaluateBar(contractId, tf, closePrice, barCloseIso).catch((err) => {
          console.error(`[tickAggregator] boundary evaluateBar error:`, err instanceof Error ? err.message : err);
        });
      } else {
        console.log(`[tickAggregator] Boundary timer: no candle data for ${contractId} ${tf} — skipping`);
      }
    }

    // Chain: schedule the next boundary
    if (clients.size > 0) {
      scheduleBoundaryTimer(contractId, tf, periodSec);
    }
  }, delay);

  boundaryTimers.set(key, timer);
}

/**
 * Start or refresh boundary timers for all armed (contractId, timeframe) pairs.
 * Call when a frontend connects or when new conditions are armed.
 */
export function refreshBoundaryTimers(): void {
  if (clients.size === 0) return;

  const armed = store.getArmed();
  const activeKeys = new Set<string>();

  for (const c of armed) {
    const periodSec = PERIOD_SEC[c.timeframe];
    if (!periodSec) continue;
    const key = `${c.contractId}|${c.timeframe}`;
    activeKeys.add(key);
    // Only schedule if no timer already running for this pair
    if (!boundaryTimers.has(key)) {
      scheduleBoundaryTimer(c.contractId, c.timeframe, periodSec);
    }
  }

  // Cancel timers for pairs that are no longer armed
  for (const [key, timer] of boundaryTimers) {
    if (!activeKeys.has(key)) {
      clearTimeout(timer);
      boundaryTimers.delete(key);
    }
  }
}

function clearBoundaryTimers(): void {
  for (const timer of boundaryTimers.values()) clearTimeout(timer);
  boundaryTimers.clear();
}

// ---------------------------------------------------------------------------
// WebSocket client management
// ---------------------------------------------------------------------------

// Prune stale candle entries every 5 minutes
setInterval(() => pruneStale(), 5 * 60 * 1000).unref();

export function addClient(ws: WebSocket): void {
  clients.add(ws);
  console.log(`[tickAggregator] Frontend connected (${clients.size} client(s))`);

  // Start boundary timers now that a live client is present
  refreshBoundaryTimers();

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
    if (clients.size === 0) {
      clearBoundaryTimers();
    }
  });
}

/** Whether any frontend is forwarding ticks (used by barAggregator to skip polling) */
export function hasLiveClients(): boolean {
  return clients.size > 0;
}

/** Clear all candle state (e.g. on disconnect) */
export function clear(): void {
  candles.clear();
  prevCompleted.clear();
  lastEvaluated.clear();
  clearBoundaryTimers();
}

/** Remove candle entries for contracts/timeframes no longer armed */
export function pruneStale(): void {
  const armed = store.getArmed();
  const activeKeys = new Set<string>();
  for (const c of armed) {
    if (PERIOD_SEC[c.timeframe]) {
      activeKeys.add(`${c.contractId}|${c.timeframe}`);
    }
  }
  for (const key of candles.keys()) {
    if (!activeKeys.has(key)) candles.delete(key);
  }
  for (const key of prevCompleted.keys()) {
    if (!activeKeys.has(key)) prevCompleted.delete(key);
  }
  for (const key of lastEvaluated.keys()) {
    if (!activeKeys.has(key)) lastEvaluated.delete(key);
  }
}
