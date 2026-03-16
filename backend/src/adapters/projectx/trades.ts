import axios from 'axios';
import type { ExchangeTrades } from '../types';
import { getBaseUrl, authHeaders } from './auth';

export const projectXTrades: ExchangeTrades = {
  async search(params) {
    const body = { ...params, accountId: Number(params.accountId) };
    const response = await axios.post(
      `${getBaseUrl()}/api/Trade/search`,
      body,
      { headers: authHeaders() },
    );
    return response.data;
  },
};
