import api from './api';
import { dedupByKey } from '../utils/dedup';
import { OrderSide } from '../types/enums';

export interface Trade {
  id: string;
  accountId: string;
  contractId: string;
  price: number;
  profitAndLoss: number | null;
  fees: number;
  side: OrderSide;
  size: number;
  voided: boolean;
  orderId: string;
  creationTimestamp: string;
}

const fetchTrades = dedupByKey(async (url: string): Promise<Trade[]> => {
  const res = await api.get<{ trades: Trade[]; success: boolean }>(url);
  return (res.data.trades ?? []).map((t) => ({
    ...t,
    id: String(t.id),
    accountId: String(t.accountId),
    orderId: String(t.orderId),
  }));
});

export const tradeService = {
  async searchTrades(accountId: string, startTimestamp: string, endTimestamp?: string): Promise<Trade[]> {
    let url = `/trades/search?accountId=${accountId}&startTimestamp=${encodeURIComponent(startTimestamp)}`;
    if (endTimestamp) url += `&endTimestamp=${encodeURIComponent(endTimestamp)}`;
    return fetchTrades(url);
  },
};
