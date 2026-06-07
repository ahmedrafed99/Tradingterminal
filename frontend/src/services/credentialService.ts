import api from './api';

export interface CredentialProfile {
  id: string;        // username used as stable key
  userName: string;
  apiKey: string;
  baseUrl?: string;
  label?: string;    // display name (optional)
}

export const credentialService = {
  async loadAll(): Promise<CredentialProfile[]> {
    const res = await api.get<{ data: CredentialProfile[] }>('/credentials');
    return res.data.data ?? [];
  },

  async save(profile: CredentialProfile): Promise<void> {
    await api.put(`/credentials/${encodeURIComponent(profile.id)}`, profile);
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/credentials/${encodeURIComponent(id)}`);
  },

  async clear(): Promise<void> {
    await api.delete('/credentials');
  },
};
