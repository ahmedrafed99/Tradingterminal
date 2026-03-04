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

interface GatewayResponse {
  success: boolean;
  errorMessage?: string;
}

function assertSuccess(data: GatewayResponse) {
  if (!data.success) {
    throw new Error(data.errorMessage || 'Gateway returned success=false');
  }
}

export const orderService = {
  async placeOrder(params: PlaceOrderParams): Promise<{ orderId: number }> {
    return retryAsync(async () => {
      const res = await api.post<GatewayResponse & { orderId: number }>('/orders/place', params);
      assertSuccess(res.data);
      return { orderId: res.data.orderId };
    });
  },

  async cancelOrder(accountId: number, orderId: number): Promise<void> {
    await retryAsync(async () => {
      const res = await api.post<GatewayResponse>('/orders/cancel', { accountId, orderId });
      assertSuccess(res.data);
    });
  },

  async modifyOrder(params: ModifyOrderParams): Promise<void> {
    await retryAsync(async () => {
      const res = await api.patch<GatewayResponse>('/orders/modify', params);
      assertSuccess(res.data);
    });
  },

  async searchOpenOrders(accountId: number): Promise<Order[]> {
    const res = await retryAsync(() =>
      api.get<GatewayResponse & { orders: Order[] }>(
        `/orders/open?accountId=${accountId}`,
      ),
    );
    assertSuccess(res.data);
    return res.data.orders ?? [];
  },
};
