import api from './api';

export interface Account {
  id: number;
  name: string;
  balance: number;
  canTrade: boolean;
  isVisible: boolean;
}

export const accountService = {
  async searchAccounts(): Promise<Account[]> {
    const res = await api.get<{ accounts: Account[]; success: boolean }>('/accounts');
    return (res.data.accounts ?? []).filter((a) => a.isVisible);
  },
};
