import api from './api';

export const persistenceService = {
  async loadSettings(): Promise<Record<string, unknown>> {
    const res = await api.get('/settings');
    return res.data.data ?? {};
  },

  async saveSettings(data: Record<string, unknown>): Promise<void> {
    await api.put('/settings', data);
  },
};
