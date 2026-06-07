import axios from 'axios';
import type { ExchangeTrades } from '../types';
import type { ProjectXHelpers } from './auth';

export function createProjectXTrades(h: ProjectXHelpers): ExchangeTrades {
  return {
    async search(params) {
      const body = { ...params, accountId: Number(params.accountId) };
      const response = await axios.post(
        `${h.getBaseUrl()}/api/Trade/search`,
        body,
        { headers: h.authHeaders() },
      );
      return response.data;
    },
  };
}
