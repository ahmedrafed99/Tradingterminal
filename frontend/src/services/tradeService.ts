import api from './api';

export interface Trade {
  id: number;
  accountId: number;
  contractId: string;
  price: number;
  profitAndLoss: number | null;
  fees: number;
  side: number;
  size: number;
  voided: boolean;
  orderId: number;
  creationTimestamp: string;
}

export const tradeService = {
  async searchTrades(accountId: number, startTimestamp: string): Promise<Trade[]> {
    const res = await api.get<{ trades: Trade[]; success: boolean }>(
      `/trades/search?accountId=${accountId}&startTimestamp=${encodeURIComponent(startTimestamp)}`,
    );
    return res.data.trades ?? [];
  },
};
