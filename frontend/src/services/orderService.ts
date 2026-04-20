import api from './api';
import { retryAsync } from '../utils/retry';
import { OrderType, OrderSide, OrderStatus } from '../types/enums';
import * as copyTracker from './copyTracker';
import { metricCollector } from './monitor/metricCollector';

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
  contractName?: string;
  type: OrderType;
  side: OrderSide;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLossBracket?: OrderBracket;
  takeProfitBrackets?: OrderBracket[];
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
    const t = performance.now();
    let ok = true;
    try {
      const result = await retryAsync(async () => {
        const res = await api.post<GatewayResponse & { orderId: number | string }>('/orders/place', params);
        assertSuccess(res.data);
        return { orderId: String(res.data.orderId) };
      });
      copyTracker.onPlaceOrder(params.accountId, params, result.orderId);
      return result;
    } catch (e) { ok = false; throw e; }
    finally { metricCollector.onApiCall('POST', '/orders/place', performance.now() - t, ok); }
  },

  async cancelOrder(accountId: string, orderId: string): Promise<void> {
    const t = performance.now();
    let ok = true;
    try {
      await retryAsync(async () => {
        const res = await api.post<GatewayResponse>('/orders/cancel', { accountId, orderId });
        assertSuccess(res.data);
      });
      copyTracker.onCancelOrder(accountId, orderId);
    } catch (e) { ok = false; throw e; }
    finally { metricCollector.onApiCall('POST', '/orders/cancel', performance.now() - t, ok); }
  },

  async modifyOrder(params: ModifyOrderParams): Promise<void> {
    const t = performance.now();
    let ok = true;
    try {
      await retryAsync(async () => {
        const res = await api.patch<GatewayResponse>('/orders/modify', params);
        assertSuccess(res.data);
      });
      copyTracker.onModifyOrder(params.accountId, params.orderId, params);
    } catch (e) { ok = false; throw e; }
    finally { metricCollector.onApiCall('PATCH', '/orders/modify', performance.now() - t, ok); }
  },

  async searchOpenOrders(accountId: string): Promise<Order[]> {
    const t = performance.now();
    let ok = true;
    try {
      const res = await retryAsync(() =>
        api.get<GatewayResponse & { orders: Order[] }>(`/orders/open?accountId=${accountId}`),
      );
      assertSuccess(res.data);
      return (res.data.orders ?? []).map((o) => ({ ...o, id: String(o.id) }));
    } catch (e) { ok = false; throw e; }
    finally { metricCollector.onApiCall('GET', '/orders/open', performance.now() - t, ok); }
  },
};
