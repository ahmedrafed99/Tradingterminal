import api from './api';

export interface SavedCredentials {
  userName: string;
  apiKey: string;
}

export const credentialService = {
  async load(): Promise<SavedCredentials | null> {
    const res = await api.get('/credentials');
    return res.data.data ?? null;
  },

  async save(userName: string, apiKey: string): Promise<void> {
    await api.put('/credentials', { userName, apiKey });
  },

  async clear(): Promise<void> {
    await api.delete('/credentials');
  },
};
