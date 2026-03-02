import api from './api';

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

  async getStatus(): Promise<AuthStatus> {
    const res = await api.get<AuthStatus>('/auth/status');
    return res.data;
  },

  async getToken(): Promise<string> {
    const res = await api.get<{ success: boolean; token: string }>('/auth/token');
    return res.data.token;
  },
};
