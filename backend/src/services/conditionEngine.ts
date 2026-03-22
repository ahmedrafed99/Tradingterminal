import type { Response } from 'express';
import { getAdapter, isConnected } from '../adapters/registry';
import * as store from './conditionStore';
import type { Condition, ConditionStatus } from '../types/condition';
import { OrderType, OrderSide } from '../types/enums';
import * as barAggregator from './barAggregator';

// ---------------------------------------------------------------------------
// SSE client registry
// ---------------------------------------------------------------------------

const sseClients = new Set<Response>();

export function addSSEClient(res: Response): void {
  sseClients.add(res);
  const cleanup = () => sseClients.delete(res);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// ---------------------------------------------------------------------------
// Bar evaluation — called when a completed bar arrives
// ---------------------------------------------------------------------------

/**
 * Evaluate all armed conditions against a completed bar.
 * Called externally when a bar closes (from real-time subscription).
 *
 * @param contractId - The contract the bar belongs to
 * @param timeframe  - e.g. "1m", "5m", "15m"
 * @param close      - The bar's close price
 */
export async function evaluateBar(
  contractId: string,
  timeframe: string,
  close: number,
  barCloseTime?: string,
): Promise<void> {
  const allArmed = store.getArmed();
  const armed = allArmed.filter(
    (c) => c.contractId === contractId && c.timeframe === timeframe,
  );

  if (armed.length === 0) return;

  // Measure delay from candle close to evaluation
  const delaySec = barCloseTime
    ? ((Date.now() - new Date(barCloseTime).getTime()) / 1000).toFixed(1)
    : '?';

  for (const condition of armed) {
    const met =
      (condition.conditionType === 'closes_above' && close > condition.triggerPrice) ||
      (condition.conditionType === 'closes_below' && close < condition.triggerPrice);

    if (!met) {
      console.log(`[conditionEngine] ${condition.conditionType} trigger=${condition.triggerPrice} close=${close} → not met (delay: ${delaySec}s)`);
      continue;
    }

    console.log(`[conditionEngine] TRIGGERED ${condition.id}: ${condition.conditionType} trigger=${condition.triggerPrice} close=${close} (delay: ${delaySec}s after bar close)`);

    try {
      await executeCondition(condition);
      const updated = store.setStatus(condition.id, 'triggered', {
        triggeredAt: new Date().toISOString(),
      });
      broadcast('triggered', updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[conditionEngine] Failed to execute condition ${condition.id}:`, msg);
      const updated = store.setStatus(condition.id, 'failed', { errorMessage: msg });
      broadcast('failed', updated);
    }
  }
}

// ---------------------------------------------------------------------------
// Order execution
// ---------------------------------------------------------------------------

async function executeCondition(condition: Condition): Promise<void> {
  if (!isConnected()) throw new Error('Not connected to exchange');

  const adapter = getAdapter();

  const orderParams: Record<string, unknown> = {
    accountId: condition.accountId,
    contractId: condition.contractId,
    type: condition.orderType === 'market' ? OrderType.Market : OrderType.Limit,
    side: condition.orderSide === 'buy' ? OrderSide.Buy : OrderSide.Sell,
    size: condition.orderSize,
  };

  if (condition.orderType === 'limit' && condition.orderPrice != null) {
    orderParams.limitPrice = condition.orderPrice;
  }

  // Attach gateway-native bracket if enabled with a single TP (or SL only)
  // Exchange expects signed ticks: SL negative when long, TP negative when short
  if (condition.bracket?.enabled) {
    const isBuy = condition.orderSide === 'buy';
    if (condition.bracket.sl) {
      orderParams.stopLossBracket = {
        ticks: pointsToTicks(condition.bracket.sl.points, condition.contractTickSize) * (isBuy ? -1 : 1),
        type: OrderType.Stop,
      };
    }
    if (condition.bracket.tp && condition.bracket.tp.length === 1) {
      orderParams.takeProfitBracket = {
        ticks: pointsToTicks(condition.bracket.tp[0].points, condition.contractTickSize) * (isBuy ? 1 : -1),
        type: OrderType.Limit,
      };
    }
  }

  const result = await adapter.orders.place(orderParams) as { success?: boolean; errorMessage?: string };

  if (result && result.success === false) {
    throw new Error(result.errorMessage || 'Gateway returned success=false');
  }

  // TODO: For 2+ TPs, monitor fill via SignalR and place additional TPs client-side
  // (same pattern as frontend bracketEngine)
}

function pointsToTicks(points: number, tickSize: number): number {
  return Math.round(points / tickSize);
}

// ---------------------------------------------------------------------------
// Expiry check — call periodically (e.g. every 60s)
// ---------------------------------------------------------------------------

export function checkExpired(): void {
  const now = Date.now();
  for (const c of store.getArmed()) {
    if (c.expiresAt && new Date(c.expiresAt).getTime() <= now) {
      const updated = store.setStatus(c.id, 'expired');
      broadcast('expired', updated);
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let expiryInterval: ReturnType<typeof setInterval> | null = null;

export function start(): void {
  // Check expiry every 60 seconds
  expiryInterval = setInterval(checkExpired, 60_000);
  console.log('[conditionEngine] Engine started (expiry check every 60s)');

  // Start the bar aggregator (connects to exchange SignalR for live quotes)
  barAggregator.start().catch((err) => {
    console.error('[conditionEngine] Failed to start bar aggregator:', err);
  });
}

export function stop(): void {
  barAggregator.stop();
  if (expiryInterval) {
    clearInterval(expiryInterval);
    expiryInterval = null;
  }
  store.flushSync();
  console.log('[conditionEngine] Engine stopped');
}
