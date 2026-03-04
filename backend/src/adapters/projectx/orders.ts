import axios from 'axios';
import type { ExchangeOrders } from '../types';
import { getBaseUrl, authHeaders } from './auth';

export const projectXOrders: ExchangeOrders = {
  async place(params) {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/place`,
      params,
      { headers: authHeaders() },
    );
    return response.data;
  },

  async cancel(params) {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/cancel`,
      params,
      { headers: authHeaders() },
    );
    return response.data;
  },

  async modify(params) {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/modify`,
      params,
      { headers: authHeaders() },
    );
    return response.data;
  },

  async searchOpen(accountId) {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/searchOpen`,
      { accountId },
      { headers: authHeaders() },
    );
    return response.data;
  },
};
