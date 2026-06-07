import axios from 'axios';
import type { ExchangeOrders, PlaceOrderParams } from '../types';
import type { ProjectXHelpers } from './auth';

const toNum = (id: string) => Number(id);

export function createProjectXOrders(h: ProjectXHelpers): ExchangeOrders {
  return {
    async place(params: PlaceOrderParams) {
      const { takeProfitBrackets, ...rest } = params;
      const converted: Record<string, unknown> = { ...rest, accountId: toNum(params.accountId) };
      if (takeProfitBrackets && takeProfitBrackets.length > 0) {
        converted.takeProfitBracket = takeProfitBrackets[0];
      }
      const response = await axios.post(
        `${h.getBaseUrl()}/api/Order/place`,
        converted,
        { headers: h.authHeaders() },
      );
      return response.data;
    },

    async cancel(params) {
      const body = { accountId: toNum(params.accountId), orderId: toNum(params.orderId) };
      const response = await axios.post(
        `${h.getBaseUrl()}/api/Order/cancel`,
        body,
        { headers: h.authHeaders() },
      );
      return response.data;
    },

    async modify(params) {
      const body = {
        ...params,
        accountId: toNum(params.accountId as string),
        orderId: toNum(params.orderId as string),
      };
      const response = await axios.post(
        `${h.getBaseUrl()}/api/Order/modify`,
        body,
        { headers: h.authHeaders() },
      );
      return response.data;
    },

    async searchOpen(accountId) {
      const response = await axios.post(
        `${h.getBaseUrl()}/api/Order/searchOpen`,
        { accountId: toNum(accountId) },
        { headers: h.authHeaders() },
      );
      return response.data;
    },
  };
}
