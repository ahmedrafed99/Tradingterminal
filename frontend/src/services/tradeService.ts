import api from './api';
import { OrderSide } from '../types/enums';

export interface Trade {
  id: number;
  accountId: number;
  contractId: string;
  price: number;
  profitAndLoss: number | null;
  fees: number;
  side: OrderSide;
  size: number;
  voided: boolean;
  orderId: number;
  creationTimestamp: string;
}

// In-flight dedup for searchTrades — prevents StrictMode double-calls
const tradesInflight = new Map<string, Promise<Trade[]>>();

export const tradeService = {
  async searchTrades(accountId: number, startTimestamp: string, endTimestamp?: string): Promise<Trade[]> {
    let url = `/trades/search?accountId=${accountId}&startTimestamp=${encodeURIComponent(startTimestamp)}`;
    if (endTimestamp) url += `&endTimestamp=${encodeURIComponent(endTimestamp)}`;
    const existing = tradesInflight.get(url);
    if (existing) return existing;
    const promise = api
      .get<{ trades: Trade[]; success: boolean }>(url)
      .then((res) => res.data.trades ?? [])
      .finally(() => { tradesInflight.delete(url); });
    tradesInflight.set(url, promise);
    return promise;
  },
};
