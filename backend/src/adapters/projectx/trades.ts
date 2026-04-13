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
    const data = response.data;
    if (Array.isArray(data?.trades)) {
      data.trades = data.trades.map((t: Record<string, unknown>) => ({
        ...t,
        fees: (typeof t.fees === 'number' ? t.fees : 0) * 2,
        commissions: (typeof t.commissions === 'number' ? t.commissions : 0) * 2,
      }));
    }
    return data;
  },
};
