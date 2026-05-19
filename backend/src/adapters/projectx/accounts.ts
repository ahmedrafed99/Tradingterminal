import axios from 'axios';
import type { ExchangeAccounts } from '../types';
import { getBaseUrl, getUserApiBaseUrl, authHeaders } from './auth';

export const projectXAccounts: ExchangeAccounts = {
  async list() {
    const response = await axios.post(
      `${getBaseUrl()}/api/Account/search`,
      { onlyActiveAccounts: true },
      { headers: authHeaders() },
    );
    return response.data;
  },

  async eligibility() {
    const response = await axios.get(
      `${getUserApiBaseUrl()}/TradingAccount`,
      { headers: authHeaders() },
    );
    const data: { accountId: number; ineligible: boolean }[] = response.data ?? [];
    return data.map((a) => ({ accountId: String(a.accountId), ineligible: a.ineligible }));
  },
};
