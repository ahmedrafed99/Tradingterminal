import api from './api';
import { retryAsync } from '../utils/retry';
import { OrderType, OrderSide, OrderStatus } from '../types/enums';

export interface Order {
  id: number;
  contractId: string;
  type: OrderType;
  side: OrderSide;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  status?: OrderStatus;
}

export interface Bracket {
  ticks: number;
  type: number;
}

export interface PlaceOrderParams {
  accountId: number;
  contractId: string;
  type: OrderType;
  side: OrderSide;
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
    return retryAsync(async () => {
      const res = await api.post<{ orderId: number; success: boolean }>('/orders/place', params);
      return { orderId: res.data.orderId };
    });
  },

  async cancelOrder(accountId: number, orderId: number): Promise<void> {
    await retryAsync(() => api.post('/orders/cancel', { accountId, orderId }));
  },

  async modifyOrder(params: ModifyOrderParams): Promise<void> {
    await retryAsync(() => api.patch('/orders/modify', params));
  },

  async searchOpenOrders(accountId: number): Promise<Order[]> {
    const res = await retryAsync(() =>
      api.get<{ orders: Order[]; success: boolean }>(
        `/orders/open?accountId=${accountId}`,
      ),
    );
    return res.data.orders ?? [];
  },
};
