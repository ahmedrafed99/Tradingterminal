import api from './api';

export interface Order {
  id: number;
  contractId: string;
  type: number;
  side: number;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  status?: number;
}

export interface Bracket {
  ticks: number;
  type: number;
}

export interface PlaceOrderParams {
  accountId: number;
  contractId: string;
  type: 1 | 2 | 4 | 5;      // Limit | Market | Stop | TrailingStop
  side: 0 | 1;               // Buy | Sell
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLossBracket?: Bracket;
  takeProfitBracket?: Bracket;
}

export interface ModifyOrderParams {
  accountId: number;
  orderId: number;
  size?: number;
  limitPrice?: number;
  stopPrice?: number;
  trailPrice?: number;
}

export const orderService = {
  async placeOrder(params: PlaceOrderParams): Promise<{ orderId: number }> {
    const res = await api.post<{ orderId: number; success: boolean }>('/orders/place', params);
    return { orderId: res.data.orderId };
  },

  async cancelOrder(accountId: number, orderId: number): Promise<void> {
    await api.post('/orders/cancel', { accountId, orderId });
  },

  async modifyOrder(params: ModifyOrderParams): Promise<void> {
    await api.patch('/orders/modify', params);
  },

  async searchOpenOrders(accountId: number): Promise<Order[]> {
    const res = await api.get<{ orders: Order[]; success: boolean }>(
      `/orders/open?accountId=${accountId}`,
    );
    return res.data.orders ?? [];
  },
};
