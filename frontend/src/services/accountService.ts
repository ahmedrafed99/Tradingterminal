import api from './api';
import { dedup } from '../utils/dedup';

export interface Account {
  id: string;
  name: string;
  balance: number;
  canTrade: boolean;
  isVisible: boolean;
  ineligible?: boolean;
}

export const accountService = {
  searchAccounts: dedup(async (): Promise<Account[]> => {
    const [accountsRes, eligibilityRes] = await Promise.allSettled([
      api.get<{ accounts: Account[]; success: boolean }>('/accounts'),
      api.get<{ accountId: string; ineligible: boolean }[]>('/accounts/eligibility'),
    ]);

    if (accountsRes.status === 'rejected') throw accountsRes.reason;

    const accounts = (accountsRes.value.data.accounts ?? [])
      .filter((a) => a.isVisible)
      .map((a) => ({ ...a, id: String(a.id) }));

    if (eligibilityRes.status === 'fulfilled') {
      const eligMap = new Map(eligibilityRes.value.data.map((e) => [e.accountId, e.ineligible]));
      return accounts.map((a) => ({ ...a, ineligible: eligMap.get(a.id) ?? false }));
    }

    return accounts;
  }),
};
