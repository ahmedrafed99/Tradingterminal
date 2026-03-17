import api from './api';

export interface SavedCredentials {
  userName: string;
  apiKey: string;
}

let cached: SavedCredentials | null | undefined;

export const credentialService = {
  async load(): Promise<SavedCredentials | null> {
    if (cached !== undefined) return cached;
    const res = await api.get('/credentials');
    cached = res.data.data ?? null;
    return cached;
  },

  async save(userName: string, apiKey: string): Promise<void> {
    await api.put('/credentials', { userName, apiKey });
    cached = { userName, apiKey };
  },

  async clear(): Promise<void> {
    await api.delete('/credentials');
    cached = null;
  },
};
