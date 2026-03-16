import type { Account } from '../../services/accountService';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface AuthState {
  connected: boolean;
  baseUrl: string;
  rememberCredentials: boolean;
  savedUserName: string;
  savedApiKey: string;
  setConnected: (connected: boolean, baseUrl?: string) => void;
  setRememberCredentials: (on: boolean) => void;
  setSavedCredentials: (userName: string, apiKey: string) => void;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export interface AccountsState {
  accounts: Account[];
  activeAccountId: number | null;
  setAccounts: (accounts: Account[]) => void;
  setActiveAccountId: (id: number) => void;
  updateAccount: (partial: { id: number } & Partial<Account>) => void;
}

export type ConnectionSlice = AuthState & AccountsState;

type Set = {
  (partial: Partial<ConnectionSlice>): void;
  (fn: (s: ConnectionSlice) => Partial<ConnectionSlice>): void;
};

export const createConnectionSlice = (set: Set): ConnectionSlice => ({
  // Auth
  connected: false,
  baseUrl: 'https://api.topstepx.com',
  rememberCredentials: false,
  savedUserName: '',
  savedApiKey: '',
  setConnected: (connected, baseUrl) =>
    set((s) => ({ connected, baseUrl: baseUrl ?? s.baseUrl })),
  setRememberCredentials: (on) =>
    set(on ? { rememberCredentials: true } : { rememberCredentials: false, savedUserName: '', savedApiKey: '' }),
  setSavedCredentials: (userName, apiKey) =>
    set({ savedUserName: userName, savedApiKey: apiKey }),

  // Accounts
  accounts: [],
  activeAccountId: null,
  setAccounts: (accounts) => set({ accounts }),
  setActiveAccountId: (id) => set({ activeAccountId: id }),
  updateAccount: (partial) =>
    set((s) => ({
      accounts: s.accounts.map((a) =>
        a.id === partial.id ? { ...a, ...partial } : a,
      ),
    })),
});
