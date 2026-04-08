import type { ExchangeOrders } from '../types';
import { OrderType, OrderSide } from '../../types/enums';
import type { HlClient, HlState } from './client';
import { floatToWire, roundToSigFigs } from './client';
import { getAssetIndex, getAssetSzDecimals } from './marketData';

// ---------------------------------------------------------------------------
// HL API types
// ---------------------------------------------------------------------------
interface HlOpenOrder {
  coin: string;
  limitPx: string;
  oid: number;
  side: 'B' | 'A';
  sz: string;
  timestamp: number;
  orderType: string;  // e.g. "Limit", "Stop Market", "Take Profit Market"
  triggerPx?: string;
  isTrigger?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sideToHl(side: OrderSide): boolean {
  return side === OrderSide.Buy;
}

/** Parse "COIN:OID" back to { coin, oid } */
function parseOrderId(id: string): { coin: string; oid: number } {
  const sep = id.lastIndexOf(':');
  if (sep < 0) throw new Error(`[HL] Invalid order ID format: "${id}" — expected "COIN:OID"`);
  const coin = id.slice(0, sep);
  const oid = parseInt(id.slice(sep + 1), 10);
  if (!coin || isNaN(oid)) throw new Error(`[HL] Cannot parse order ID: "${id}"`);
  return { coin, oid };
}

/**
 * HL returns HTTP 200 + status:"ok" even when an individual order in the batch
 * was rejected. Check statuses[] and throw if any error is present.
 */
function assertOrderStatuses(result: unknown, context: string): void {
  const statuses = (result as { response?: { data?: { statuses?: unknown[] } } })
    ?.response?.data?.statuses;
  if (!Array.isArray(statuses)) return;
  for (const s of statuses) {
    // String statuses: "success" and "waitingForFill" are non-errors
    if (typeof s === 'string') {
      if (s !== 'success' && s !== 'waitingForFill') throw new Error(`[HL] ${context}: ${s}`);
      continue;
    }
    // Order statuses are objects: { resting: ... } | { filled: ... } | { error: "..." }
    const st = s as Record<string, unknown>;
    if ('error' in st) {
      throw new Error(`[HL] ${context}: ${st['error']}`);
    }
  }
}

/** Normalize a raw HL open order to our canonical shape */
function normalizeOrder(o: HlOpenOrder, accountId: string): Record<string, unknown> {
  return {
    id: `${o.coin}:${o.oid}`,
    contractId: o.coin,
    accountId,
    side: o.side === 'B' ? OrderSide.Buy : OrderSide.Sell,
    size: parseFloat(o.sz),
    limitPrice: parseFloat(o.limitPx),
    stopPrice: o.triggerPx != null ? parseFloat(o.triggerPx) : undefined,
    type: o.isTrigger ? OrderType.Stop : OrderType.Limit,
    isTrigger: o.isTrigger ?? false,
    // HL orderType string e.g. "Limit", "Stop Market", "Take Profit Market"
    orderType: o.orderType,
    status: 1, // Working
  };
}

/**
 * Distribute total size across TP legs.
 * Legs with an explicit size keep it; the rest split the remainder equally.
 */
function distributeSizes(tps: { price: number; size?: number }[], totalSize: number): number[] {
  const specifiedSum = tps.reduce((s, tp) => s + (tp.size ?? 0), 0);
  if (specifiedSum > totalSize + 1e-9) {
    throw new Error(`[HL] Explicit TP sizes (${specifiedSum}) exceed entry size (${totalSize})`);
  }
  const unspecifiedCount = tps.filter((tp) => tp.size == null).length;
  const remainder = totalSize - specifiedSum;
  const equalShare = unspecifiedCount > 0 ? remainder / unspecifiedCount : 0;
  if (equalShare < 0) throw new Error(`[HL] TP size distribution produced negative share`);
  return tps.map((tp) => tp.size ?? equalShare);
}

// ---------------------------------------------------------------------------
// Build HL order wire object
// ---------------------------------------------------------------------------
async function buildOrderWire(
  client: HlClient,
  params: {
    contractId: string;
    type: OrderType;
    side: OrderSide;
    size: number;
    limitPrice?: number;
    stopPrice?: number;
    reduceOnly?: boolean;
  },
): Promise<{ assetIndex: number; wire: Record<string, unknown> }> {
  const coin = params.contractId;
  const [assetIndex, szDecimals] = await Promise.all([
    getAssetIndex(client, coin),
    getAssetSzDecimals(client, coin),
  ]);

  const isBuy = sideToHl(params.side);
  const sz = params.size.toFixed(szDecimals);

  let orderType: Record<string, unknown>;
  let px: string;

  if (params.type === OrderType.Market) {
    // HL market = IOC limit at mid ± 5% slippage
    const allMids = await client.info<Record<string, string>>({ type: 'allMids' });
    const mid = parseFloat(allMids[coin] ?? '0');
    if (mid === 0) throw new Error(`[HL] No mid price available for ${coin}`);
    const slippagePrice = isBuy ? mid * 1.05 : mid * 0.95;
    px = floatToWire(roundToSigFigs(slippagePrice, 5));
    orderType = { limit: { tif: 'Ioc' } };
  } else if (params.type === OrderType.Stop) {
    if (params.stopPrice == null) throw new Error('[HL] Stop orders require a stopPrice');
    const triggerPx = floatToWire(roundToSigFigs(params.stopPrice, 5));
    const isMarket = params.limitPrice == null;
    // For trigger-market orders, p = triggerPx. Only limit-trigger uses a separate limitPrice.
    px = isMarket ? triggerPx : floatToWire(roundToSigFigs(params.limitPrice!, 5));
    orderType = { trigger: { isMarket, triggerPx, tpsl: 'sl' } };
  } else if (params.type === OrderType.Limit) {
    if (params.limitPrice == null) throw new Error('[HL] Limit orders require a limitPrice');
    px = floatToWire(roundToSigFigs(params.limitPrice, 5));
    orderType = { limit: { tif: 'Gtc' } };
  } else {
    throw new Error(`[HL] Unsupported order type: ${params.type}`);
  }

  return {
    assetIndex,
    wire: {
      a: assetIndex,
      b: isBuy,
      p: px,
      s: sz,
      r: params.reduceOnly ?? false,
      t: orderType,
    },
  };
}

/** Mark a trigger wire as a take-profit (overrides default 'sl') */
function markAsTp(wire: Record<string, unknown>): void {
  const t = wire['t'] as { trigger: { tpsl: string } };
  t.trigger.tpsl = 'tp';
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------
export function createOrders(client: HlClient, _state: HlState): ExchangeOrders {
  return {
    async place(params) {
      const {
        contractId,
        type,
        side,
        size,
        limitPrice,
        stopPrice,
        stopLossBracket,
        takeProfitBrackets,
      } = params as {
        contractId: string;
        type: OrderType;
        side: OrderSide;
        size: number;
        limitPrice?: number;
        stopPrice?: number;
        stopLossBracket?: { price: number };
        // Single or multiple TP legs; size per leg defaults to equal split
        takeProfitBrackets?: { price: number; size?: number }[];
      };

      const tpBrackets = takeProfitBrackets ?? [];
      const hasBrackets = stopLossBracket != null || tpBrackets.length > 0;
      const oppSide = side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;

      if (hasBrackets) {
        const tpSizes = distributeSizes(tpBrackets, size);

        // Build all wires in parallel
        const [entryWire, slWire, ...tpWires] = await Promise.all([
          buildOrderWire(client, { contractId, type, side, size, limitPrice, stopPrice }),
          stopLossBracket != null
            ? buildOrderWire(client, {
                contractId,
                type: OrderType.Stop,
                side: oppSide,
                size,
                stopPrice: stopLossBracket.price,
                reduceOnly: true,
              })
            : null,
          ...tpBrackets.map((tp, i) =>
            buildOrderWire(client, {
              contractId,
              type: OrderType.Stop,
              side: oppSide,
              size: tpSizes[i],
              stopPrice: tp.price,
              reduceOnly: true,
            }),
          ),
        ]);

        // Mark all TPs
        for (const tp of tpWires) markAsTp(tp.wire);

        // Exactly 1 TP + 1 SL → atomic normalTpsl: [entry, tp, sl]
        if (tpWires.length === 1 && slWire != null) {
          const result = await client.exchange({
            type: 'order',
            orders: [entryWire.wire, tpWires[0].wire, slWire.wire],
            grouping: 'normalTpsl',
          });
          assertOrderStatuses(result, 'place (bracket)');
          return result;
        }

        // All other cases (multi-TP, or only one leg) — entry first, then all legs in one batch
        const entryResult = await client.exchange({
          type: 'order',
          orders: [entryWire.wire],
          grouping: 'na',
        });
        assertOrderStatuses(entryResult, 'place (entry)');

        const legWires = [
          ...tpWires.map((w) => w.wire),
          ...(slWire != null ? [slWire.wire] : []),
        ];

        if (legWires.length === 0) return entryResult;

        const legsResult = await client.exchange({
          type: 'order',
          orders: legWires,
          grouping: 'na',
        });
        assertOrderStatuses(legsResult, 'place (bracket legs)');
        return legsResult;
      }

      // Simple order — no brackets
      const { wire } = await buildOrderWire(client, {
        contractId, type, side, size, limitPrice, stopPrice,
      });

      const result = await client.exchange({
        type: 'order',
        orders: [wire],
        grouping: 'na',
      });
      assertOrderStatuses(result, 'place');
      return result;
    },

    async cancel(params) {
      const { orderId } = params;
      const { coin, oid } = parseOrderId(orderId);
      const assetIndex = await getAssetIndex(client, coin);

      const result = await client.exchange({
        type: 'cancel',
        cancels: [{ a: assetIndex, o: oid }],
      });
      assertOrderStatuses(result, 'cancel');
      return result;
    },

    async modify(params) {
      const {
        orderId,
        size,
        limitPrice,
        stopPrice,
      } = params as {
        orderId: string;
        size?: number;
        limitPrice?: number;
        stopPrice?: number;
      };

      const { coin, oid } = parseOrderId(orderId);

      // Fetch the current open order to fill in missing fields
      const wallet = client.getWalletAddress();
      const openOrders = await client.info<HlOpenOrder[]>({
        type: 'frontendOpenOrders',
        user: wallet,
      });
      const existing = openOrders.find((o) => o.coin === coin && o.oid === oid);
      if (!existing) throw new Error(`[HL] Order not found: ${orderId}`);

      const assetIndex = await getAssetIndex(client, coin);
      const szDecimals = await getAssetSzDecimals(client, coin);
      const isBuy = existing.side === 'B';

      // Resolve final values
      const finalSize = size != null ? size.toFixed(szDecimals) : existing.sz;
      const finalPx = limitPrice != null
        ? roundToSigFigs(limitPrice, 5)
        : parseFloat(existing.limitPx);

      if (existing.isTrigger) {
        // Trigger orders: cancel-and-replace (batchModify doesn't support them)
        const triggerPx = stopPrice != null
          ? roundToSigFigs(stopPrice, 5)
          : (existing.triggerPx != null ? parseFloat(existing.triggerPx) : finalPx);

        const isMarket = existing.orderType?.includes('Market') ?? true;
        // Derive tpsl from the orderType string returned by HL:
        //   "Take Profit Market" / "Take Profit Limit" → tp
        //   "Stop Market" / "Stop Limit" / anything else → sl
        const orderTypeLower = existing.orderType?.toLowerCase() ?? '';
        const tpsl: 'tp' | 'sl' = orderTypeLower.startsWith('take profit') ? 'tp' : 'sl';

        // Cancel existing
        await client.exchange({
          type: 'cancel',
          cancels: [{ a: assetIndex, o: oid }],
        });

        // Re-place with updated values
        return await client.exchange({
          type: 'order',
          orders: [{
            a: assetIndex,
            b: isBuy,
            p: floatToWire(triggerPx),
            s: finalSize,
            r: true, // bracket triggers are always reduce-only
            t: { trigger: { isMarket, triggerPx: floatToWire(triggerPx), tpsl } },
          }],
          grouping: 'na',
        });
      }

      // Limit order — use batchModify
      return await client.exchange({
        type: 'batchModify',
        modifies: [{
          oid,
          order: {
            a: assetIndex,
            b: isBuy,
            p: floatToWire(finalPx),
            s: finalSize,
            r: false,
            t: { limit: { tif: 'Gtc' } },
          },
        }],
      });
    },

    async searchOpen(_accountId) {
      const wallet = client.getWalletAddress();
      const orders = await client.info<HlOpenOrder[]>({
        type: 'frontendOpenOrders',
        user: wallet,
      });
      return orders.map((o) => normalizeOrder(o, wallet));
    },
  };
}
