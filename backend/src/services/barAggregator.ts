/**
 * Bar Aggregator — polls for completed candle bars via REST API.
 *
 * Instead of blind 15s polling, schedules checks aligned to candle
 * boundaries. For a 1m condition it checks at :00, :01, :02 …
 * For 15m it checks at :00, :15, :30, :45. For 4h at 00:00, 04:00, etc.
 *
 * A small buffer (3s) is added after each boundary to give the API
 * time to finalize the completed bar.
 */

import { getAdapter, isConnected } from '../adapters/registry';
import * as store from './conditionStore';
import { evaluateBar } from './conditionEngine';

// ---------------------------------------------------------------------------
// Timeframe → API unit mapping
// ---------------------------------------------------------------------------

interface TfConfig {
  unit: number;       // API unit (2=min, 3=hour, 4=day)
  unitNumber: number; // e.g. 15 for 15m
  periodSec: number;  // candle duration in seconds
}

const TIMEFRAME_MAP: Record<string, TfConfig> = {
  '1m':  { unit: 2, unitNumber: 1,  periodSec: 60 },
  '3m':  { unit: 2, unitNumber: 3,  periodSec: 180 },
  '15m': { unit: 2, unitNumber: 15, periodSec: 900 },
  '1h':  { unit: 3, unitNumber: 1,  periodSec: 3600 },
  '4h':  { unit: 3, unitNumber: 4,  periodSec: 14400 },
  'D':   { unit: 4, unitNumber: 1,  periodSec: 86400 },
};

// Buffer after candle close before polling (ms) — gives the API time to finalize
const POLL_BUFFER_MS = 3_000;

// Track which bars we've already evaluated (prevent double-trigger)
// Key: `${contractId}|${timeframe}`, Value: candle start timestamp (ms)
const lastEvaluated = new Map<string, number>();

let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

// ---------------------------------------------------------------------------
// Candle boundary math
// ---------------------------------------------------------------------------

/** Next candle close time (ms) for a given period in seconds */
function nextCandleCloseMs(periodSec: number): number {
  const nowSec = Date.now() / 1000;
  const currentCandleStart = Math.floor(nowSec / periodSec) * periodSec;
  const nextClose = currentCandleStart + periodSec;
  return nextClose * 1000;
}

// ---------------------------------------------------------------------------
// Polling logic — only polls timeframes whose candle just closed
// ---------------------------------------------------------------------------

async function pollTimeframes(timeframes: Set<string>): Promise<void> {
  if (!isConnected()) return;

  const armed = store.getArmed();
  if (armed.length === 0) return;

  // Deduplicate: group by contract+timeframe, only for the timeframes that just closed
  const pairs = new Map<string, { contractId: string; timeframe: string }>();
  for (const c of armed) {
    if (!timeframes.has(c.timeframe)) continue;
    const key = `${c.contractId}|${c.timeframe}`;
    if (!pairs.has(key)) {
      pairs.set(key, { contractId: c.contractId, timeframe: c.timeframe });
    }
  }

  if (pairs.size === 0) return;

  const adapter = getAdapter();

  for (const [key, { contractId, timeframe }] of pairs) {
    const tf = TIMEFRAME_MAP[timeframe];
    if (!tf) continue;

    try {
      const now = new Date();
      const lookback = tf.periodSec * 3 * 1000;
      const startTime = new Date(now.getTime() - lookback).toISOString();

      const result = await adapter.marketData.retrieveBars({
        contractId,
        live: false,
        unit: tf.unit,
        unitNumber: tf.unitNumber,
        startTime,
        endTime: now.toISOString(),
        limit: 3,
        includePartialBar: false,
      }) as { bars?: Array<{ t: string; o: number; h: number; l: number; c: number }> };

      const bars = result?.bars;
      if (!bars || bars.length === 0) continue;

      const lastBar = bars[bars.length - 1];
      const barTime = new Date(lastBar.t).getTime();

      // Skip if we already evaluated this bar
      const prevTime = lastEvaluated.get(key);
      if (prevTime && prevTime >= barTime) continue;

      lastEvaluated.set(key, barTime);

      console.log(`[barAggregator] Completed bar: ${contractId} ${timeframe} close=${lastBar.c} @ ${lastBar.t}`);

      await evaluateBar(contractId, timeframe, lastBar.c);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Not connected')) {
        console.error(`[barAggregator] Error polling ${key}:`, msg);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler — wakes up at the next candle boundary
// ---------------------------------------------------------------------------

function scheduleNext(): void {
  if (!running) return;

  const armed = store.getArmed();
  if (armed.length === 0) {
    // No armed conditions — check again in 30s in case new ones are added
    scheduledTimer = setTimeout(scheduleNext, 30_000);
    return;
  }

  // Find all unique timeframes from armed conditions
  const activeTimeframes = new Set<string>();
  for (const c of armed) {
    if (TIMEFRAME_MAP[c.timeframe]) {
      activeTimeframes.add(c.timeframe);
    }
  }

  if (activeTimeframes.size === 0) {
    scheduledTimer = setTimeout(scheduleNext, 30_000);
    return;
  }

  // Find the earliest next candle close across all active timeframes
  const now = Date.now();
  let earliestClose = Infinity;
  const closingTimeframes = new Set<string>();

  for (const tf of activeTimeframes) {
    const periodSec = TIMEFRAME_MAP[tf].periodSec;
    const closeMs = nextCandleCloseMs(periodSec);
    if (closeMs < earliestClose) {
      earliestClose = closeMs;
      closingTimeframes.clear();
      closingTimeframes.add(tf);
    } else if (closeMs === earliestClose) {
      closingTimeframes.add(tf);
    }
  }

  // Also collect any other timeframes that close within 1s of the earliest
  // (handles alignment, e.g. 1m and 15m both close at :00)
  for (const tf of activeTimeframes) {
    const closeMs = nextCandleCloseMs(TIMEFRAME_MAP[tf].periodSec);
    if (closeMs - earliestClose < 1000) {
      closingTimeframes.add(tf);
    }
  }

  const delayMs = Math.max(earliestClose + POLL_BUFFER_MS - now, 100);
  const closeSec = Math.round(delayMs / 1000);

  console.log(
    `[barAggregator] Next check in ${closeSec}s for [${[...closingTimeframes].join(', ')}]`,
  );

  scheduledTimer = setTimeout(async () => {
    try {
      await pollTimeframes(closingTimeframes);
    } catch (err) {
      console.error('[barAggregator] Poll error:', err instanceof Error ? err.message : err);
    }
    scheduleNext();
  }, delayMs);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function start(): Promise<void> {
  if (running) return;
  running = true;

  // Do an initial poll immediately for any bars we may have missed
  const allTimeframes = new Set(Object.keys(TIMEFRAME_MAP));
  pollTimeframes(allTimeframes).catch(() => {});

  scheduleNext();
  console.log('[barAggregator] Started (candle-boundary aligned polling)');
}

/** Cancel the current timer and recompute the next boundary.
 *  Call this when a new condition is armed so we don't miss the next candle.
 *
 *  Also does an immediate poll for any timeframes whose candle boundary
 *  already passed (within the last POLL_BUFFER_MS + slack window).
 *  This prevents the race where reschedule() fires between candle close
 *  and the pending poll — cancelling the timer that would have checked it. */
export function reschedule(): void {
  if (!running) return;
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }

  // Check if any candle boundaries recently passed that we haven't polled yet
  const armed = store.getArmed();
  const now = Date.now();
  const recentlyClosedTfs = new Set<string>();

  for (const c of armed) {
    const tf = TIMEFRAME_MAP[c.timeframe];
    if (!tf) continue;
    const nowSec = now / 1000;
    const currentCandleStart = Math.floor(nowSec / tf.periodSec) * tf.periodSec;
    const prevCandleClose = currentCandleStart; // = when the previous candle ended
    const msSincePrevClose = now - prevCandleClose * 1000;
    // If the previous candle closed within the last 10s, poll it now
    if (msSincePrevClose < 10_000) {
      recentlyClosedTfs.add(c.timeframe);
    }
  }

  if (recentlyClosedTfs.size > 0) {
    console.log(`[barAggregator] Reschedule: immediate poll for recently closed [${[...recentlyClosedTfs].join(', ')}]`);
    pollTimeframes(recentlyClosedTfs).catch((err) => {
      console.error('[barAggregator] Immediate poll error:', err instanceof Error ? err.message : err);
    });
  }

  scheduleNext();
}

export function stop(): void {
  running = false;
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
  lastEvaluated.clear();
  console.log('[barAggregator] Stopped');
}
