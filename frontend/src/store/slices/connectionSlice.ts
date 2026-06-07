import type { Account } from '../../services/accountService';

// ---------------------------------------------------------------------------
// Connection profiles — one per authenticated ProjectX user
// ---------------------------------------------------------------------------
export interface ConnectionProfile {
  id: string;            // username / connectionId
  userName: string;
  label?: string;
  baseUrl: string;
  status: 'connected' | 'connecting' | 'error';
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface AuthState {
  connected: boolean;
  baseUrl: string;
  rememberCredentials: boolean;
  connections: ConnectionProfile[];
  setConnected: (connected: boolean, baseUrl?: string) => void;
  setRememberCredentials: (on: boolean) => void;
  addConnection: (profile: ConnectionProfile) => void;
  removeConnection: (id: string) => void;
  updateConnection: (id: string, patch: Partial<ConnectionProfile>) => void;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export interface AccountsState {
  accounts: Account[];
  activeAccountId: string | null;
  setAccounts: (accounts: Account[]) => void;
  setActiveAccountId: (id: string) => void;
  updateAccount: (partial: { id: string } & Partial<Account>) => void;
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
  connections: [],

  setConnected: (connected, baseUrl) =>
    set((s) => ({ connected, baseUrl: baseUrl ?? s.baseUrl })),

  setRememberCredentials: (on) =>
    set({ rememberCredentials: on }),

  addConnection: (profile) =>
    set((s) => {
      const existing = s.connections.find((c) => c.id === profile.id);
      const connections = existing
        ? s.connections.map((c) => (c.id === profile.id ? profile : c))
        : [...s.connections, profile];
      return { connections, connected: connections.some((c) => c.status === 'connected') };
    }),

  removeConnection: (id) =>
    set((s) => {
      const connections = s.connections.filter((c) => c.id !== id);
      return { connections, connected: connections.some((c) => c.status === 'connected') };
    }),

  updateConnection: (id, patch) =>
    set((s) => {
      const connections = s.connections.map((c) => (c.id === id ? { ...c, ...patch } : c));
      return { connections, connected: connections.some((c) => c.status === 'connected') };
    }),

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
