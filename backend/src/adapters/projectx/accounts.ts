import axios from 'axios';
import type { ExchangeAccounts } from '../types';
import type { ProjectXHelpers } from './auth';

export function createProjectXAccounts(h: ProjectXHelpers): ExchangeAccounts {
  return {
    async list() {
      const response = await axios.post(
        `${h.getBaseUrl()}/api/Account/search`,
        { onlyActiveAccounts: true },
        { headers: h.authHeaders() },
      );
      return response.data;
    },

    async eligibility() {
      const response = await axios.get(
        `${h.getUserApiBaseUrl()}/TradingAccount`,
        { headers: h.authHeaders() },
      );
      const data: { accountId: number; ineligible: boolean; maximumLoss: number }[] = response.data ?? [];
      return data.map((a) => ({
        accountId: String(a.accountId),
        ineligible: a.ineligible,
        maximumLoss: a.maximumLoss,
      }));
    },
  };
}
