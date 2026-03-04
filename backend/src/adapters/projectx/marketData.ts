import axios from 'axios';
import type { ExchangeMarketData } from '../types';
import { getBaseUrl, authHeaders } from './auth';

export const projectXMarketData: ExchangeMarketData = {
  async retrieveBars(params) {
    const response = await axios.post(
      `${getBaseUrl()}/api/History/retrieveBars`,
      params,
      { headers: authHeaders() },
    );
    return response.data;
  },

  async searchContracts(searchText, live) {
    const response = await axios.post(
      `${getBaseUrl()}/api/Contract/search`,
      { searchText, live },
      { headers: authHeaders() },
    );
    return response.data;
  },

  async availableContracts(live) {
    const response = await axios.post(
      `${getBaseUrl()}/api/Contract/available`,
      { live },
      { headers: authHeaders() },
    );
    return response.data;
  },

  async searchContractById(contractId, live) {
    const response = await axios.post(
      `${getBaseUrl()}/api/Contract/searchById`,
      { contractId, live },
      { headers: authHeaders() },
    );
    return response.data;
  },
};
