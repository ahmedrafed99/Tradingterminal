import api from './api';

export interface AuthStatus {
  connected: boolean;
  baseUrl: string;
}

// In-flight dedup for getStatus — prevents StrictMode double-calls
let statusInflight: Promise<AuthStatus> | null = null;

export const authService = {
  async connect(userName: string, apiKey: string, baseUrl?: string): Promise<void> {
    await api.post('/auth/connect', { userName, apiKey, baseUrl });
  },

  async disconnect(): Promise<void> {
    await api.post('/auth/disconnect');
  },

  async getStatus(): Promise<AuthStatus> {
    if (statusInflight) return statusInflight;
    statusInflight = api
      .get<AuthStatus>('/auth/status')
      .then((res) => res.data)
      .finally(() => { statusInflight = null; });
    return statusInflight;
  },
};
