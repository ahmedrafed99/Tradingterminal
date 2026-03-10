import api from './api';
import { dedupByKey } from '../utils/dedup';
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

const fetchTrades = dedupByKey(async (url: string): Promise<Trade[]> => {
  const res = await api.get<{ trades: Trade[]; success: boolean }>(url);
  return res.data.trades ?? [];
});

export const tradeService = {
  async searchTrades(accountId: number, startTimestamp: string, endTimestamp?: string): Promise<Trade[]> {
    let url = `/trades/search?accountId=${accountId}&startTimestamp=${encodeURIComponent(startTimestamp)}`;
    if (endTimestamp) url += `&endTimestamp=${encodeURIComponent(endTimestamp)}`;
    return fetchTrades(url);
  },
};
