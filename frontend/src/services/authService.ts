import api from './api';
import { dedup } from '../utils/dedup';

export interface AuthStatus {
  connected: boolean;
  baseUrl: string;
}

export const authService = {
  async connect(userName: string, apiKey: string, baseUrl?: string): Promise<void> {
    await api.post('/auth/connect', { userName, apiKey, baseUrl });
  },

  async disconnect(): Promise<void> {
    await api.post('/auth/disconnect');
  },

  getStatus: dedup(async (): Promise<AuthStatus> => {
    const res = await api.get<AuthStatus>('/auth/status');
    return res.data;
  }),
};
