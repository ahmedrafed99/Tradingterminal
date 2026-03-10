import api from './api';
import { dedup } from '../utils/dedup';

export const persistenceService = {
  loadSettings: dedup(async (): Promise<Record<string, unknown>> => {
    const res = await api.get('/settings');
    return res.data.data ?? {};
  }),

  async saveSettings(data: Record<string, unknown>): Promise<void> {
    await api.put('/settings', data);
  },
};
