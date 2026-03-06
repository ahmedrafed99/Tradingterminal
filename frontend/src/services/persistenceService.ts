import api from './api';

// In-flight dedup for loadSettings — prevents StrictMode double-calls
let loadInflight: Promise<Record<string, unknown>> | null = null;

export const persistenceService = {
  async loadSettings(): Promise<Record<string, unknown>> {
    if (loadInflight) return loadInflight;
    loadInflight = api
      .get('/settings')
      .then((res) => res.data.data ?? {})
      .finally(() => { loadInflight = null; });
    return loadInflight;
  },

  async saveSettings(data: Record<string, unknown>): Promise<void> {
    await api.put('/settings', data);
  },
};
