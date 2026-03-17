import api from './api';
import { dedup } from '../utils/dedup';

export interface Account {
  id: string;
  name: string;
  balance: number;
  canTrade: boolean;
  isVisible: boolean;
}

export const accountService = {
  searchAccounts: dedup(async (): Promise<Account[]> => {
    const res = await api.get<{ accounts: Account[]; success: boolean }>('/accounts');
    return (res.data.accounts ?? [])
      .filter((a) => a.isVisible)
      .map((a) => ({ ...a, id: String(a.id) }));
  }),
};
