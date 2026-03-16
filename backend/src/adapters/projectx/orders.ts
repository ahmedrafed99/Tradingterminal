import axios from 'axios';
import type { ExchangeOrders } from '../types';
import { getBaseUrl, authHeaders } from './auth';

/** ProjectX uses numeric IDs — convert at boundary. */
const toNum = (id: string) => Number(id);

export const projectXOrders: ExchangeOrders = {
  async place(params) {
    const body = { ...params, accountId: toNum(params.accountId as string) };
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/place`,
      body,
      { headers: authHeaders() },
    );
    return response.data;
  },

  async cancel(params) {
    const body = { accountId: toNum(params.accountId), orderId: toNum(params.orderId) };
    console.log('[backend][orders] cancel request:', body);
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/cancel`,
      body,
      { headers: authHeaders() },
    );
    console.log('[backend][orders] cancel response:', response.data);
    return response.data;
  },

  async modify(params) {
    const body = {
      ...params,
      accountId: toNum(params.accountId as string),
      orderId: toNum(params.orderId as string),
    };
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/modify`,
      body,
      { headers: authHeaders() },
    );
    return response.data;
  },

  async searchOpen(accountId) {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/searchOpen`,
      { accountId: toNum(accountId) },
      { headers: authHeaders() },
    );
    return response.data;
  },
};
