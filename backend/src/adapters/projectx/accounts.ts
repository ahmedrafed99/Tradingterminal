import axios from 'axios';
import type { ExchangeAccounts } from '../types';
import { getBaseUrl, authHeaders } from './auth';

export const projectXAccounts: ExchangeAccounts = {
  async list() {
    const response = await axios.post(
      `${getBaseUrl()}/api/Account/search`,
      { onlyActiveAccounts: true },
      { headers: authHeaders() },
    );
    return response.data;
  },
};
