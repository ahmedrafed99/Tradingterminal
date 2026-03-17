import api from './api';
import { retryAsync } from '../utils/retry';
import { OrderType, OrderSide, OrderStatus } from '../types/enums';

export interface Order {
  id: string;
  contractId: string;
  type: OrderType;
  side: OrderSide;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  status?: OrderStatus;
  customTag?: string;
}

export interface OrderBracket {
  ticks: number;
  type: number;
}

export interface PlaceOrderParams {
  accountId: string;
  contractId: string;
  type: OrderType;
  side: OrderSide;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLossBracket?: OrderBracket;
  takeProfitBracket?: OrderBracket;
}

export interface ModifyOrderParams {
  accountId: string;
  orderId: string;
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
  async placeOrder(params: PlaceOrderParams): Promise<{ orderId: string }> {
    return retryAsync(async () => {
      const res = await api.post<GatewayResponse & { orderId: number | string }>('/orders/place', params);
      assertSuccess(res.data);
      return { orderId: String(res.data.orderId) };
    });
  },

  async cancelOrder(accountId: string, orderId: string): Promise<void> {
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

  async searchOpenOrders(accountId: string): Promise<Order[]> {
    const res = await retryAsync(() =>
      api.get<GatewayResponse & { orders: Order[] }>(
        `/orders/open?accountId=${accountId}`,
      ),
    );
    assertSuccess(res.data);
    return (res.data.orders ?? []).map((o) => ({ ...o, id: String(o.id) }));
  },
};
