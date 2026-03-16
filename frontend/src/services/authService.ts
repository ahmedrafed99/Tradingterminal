import api from './api';
import { dedup } from '../utils/dedup';

export interface AuthStatus {
  connected: boolean;
  baseUrl: string;
  defaultExchange?: string;
  exchanges?: Record<string, { connected: boolean; baseUrl: string }>;
}

export const authService = {
  async connect(userName: string, apiKey: string, baseUrl?: string, exchange = 'projectx'): Promise<void> {
    await api.post('/auth/connect', { exchange, userName, apiKey, baseUrl });
  },

  async disconnect(exchange?: string): Promise<void> {
    await api.post('/auth/disconnect', exchange ? { exchange } : {});
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
