import api from './api';
import { dedup } from '../utils/dedup';
import { metricCollector } from './monitor/metricCollector';

export interface AuthStatus {
  connected: boolean;
  baseUrl: string;
  defaultExchange?: string;
  exchanges?: Record<string, { connected: boolean; baseUrl: string }>;
}

export const authService = {
  async connect(userName: string, apiKey: string, baseUrl?: string, exchange = 'projectx'): Promise<void> {
    const t = performance.now();
    let ok = true;
    try { await api.post('/auth/connect', { exchange, userName, apiKey, baseUrl }); }
    catch (e) { ok = false; throw e; }
    finally { metricCollector.onApiCall('POST', '/auth/connect', performance.now() - t, ok); }
  },

  async disconnect(exchange?: string): Promise<void> {
    const t = performance.now();
    let ok = true;
    try { await api.post('/auth/disconnect', exchange ? { exchange } : {}); }
    catch (e) { ok = false; throw e; }
    finally { metricCollector.onApiCall('POST', '/auth/disconnect', performance.now() - t, ok); }
  },

  getStatus: dedup(async (): Promise<AuthStatus> => {
    const res = await api.get<AuthStatus>('/auth/status');
    return res.data;
  }),

  async listExchanges(): Promise<{ exchanges: string[]; connected: string[] }> {
    const res = await api.get<{ exchanges: string[]; connected: string[] }>('/auth/exchanges');
    return res.data;
  },
};
