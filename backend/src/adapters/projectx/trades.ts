import axios from 'axios';
import type { ExchangeTrades } from '../types';
import { getBaseUrl, authHeaders } from './auth';

export const projectXTrades: ExchangeTrades = {
  async search(params) {
    const response = await axios.post(
      `${getBaseUrl()}/api/Trade/search`,
      params,
      { headers: authHeaders() },
    );
    return response.data;
  },
};
