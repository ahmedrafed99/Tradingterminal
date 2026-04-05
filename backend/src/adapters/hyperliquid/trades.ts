import type { ExchangeTrades } from '../types';
import { OrderSide } from '../../types/enums';
import type { HlClient } from './client';

interface HlFill {
  coin: string;
  px: string;
  sz: string;
  side: 'B' | 'A';
  time: number;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  feeToken: string;
  tid: number;
}

export function createTrades(client: HlClient): ExchangeTrades {
  return {
    async search({ startTimestamp, endTimestamp }) {
      const wallet = client.getWalletAddress();

      const startTime = new Date(startTimestamp).getTime();
      const payload: Record<string, unknown> = {
        type: 'userFills',
        user: wallet,
      };

      const fills = await client.info<HlFill[]>(payload);

      // Filter by time range client-side (HL doesn't support startTime on userFills)
      const endTime = endTimestamp ? new Date(endTimestamp).getTime() : Infinity;
      const filtered = fills.filter((f) => f.time >= startTime && f.time <= endTime);

      return filtered.map((f) => ({
        id: String(f.tid),
        accountId: wallet,
        contractId: f.coin,
        price: parseFloat(f.px),
        size: parseFloat(f.sz),
        side: f.side === 'B' ? OrderSide.Buy : OrderSide.Sell,
        fees: parseFloat(f.fee),
        voided: false,
        orderId: `${f.coin}:${f.oid}`,
        timestamp: new Date(f.time).toISOString(),
        closedPnl: parseFloat(f.closedPnl),
      }));
    },
  };
}
