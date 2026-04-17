import api from '../../services/api';

export interface BlacklistData {
  global: string[];
  accounts: Record<string, string[]>;
}

export interface BlacklistSlice {
  blacklist: BlacklistData;
  setBlacklistGlobal: (symbols: string[]) => void;
  setBlacklistAccount: (accountId: string, symbols: string[]) => void;
  removeSymbolFromAll: (sym: string) => void;
  clearBlacklist: () => void;
  isBlacklisted: (sym: string | null | undefined) => boolean;
}

type Set = {
  (partial: Partial<BlacklistSlice>): void;
  (fn: (s: BlacklistSlice) => Partial<BlacklistSlice>): void;
};

function syncToBackend(data: BlacklistData): void {
  api.post('/blacklist/sync', data).catch(() => {
    // Best-effort — backend may not be running yet
  });
}

export function createBlacklistSlice(
  set: Set,
  get: () => BlacklistSlice,
): BlacklistSlice {
  return {
    blacklist: { global: [], accounts: {} },

    setBlacklistGlobal: (symbols) => {
      set((s) => ({ blacklist: { ...s.blacklist, global: symbols } }));
      syncToBackend(get().blacklist);
    },

    setBlacklistAccount: (accountId, symbols) => {
      set((s) => ({
        blacklist: {
          ...s.blacklist,
          accounts: { ...s.blacklist.accounts, [accountId]: symbols },
        },
      }));
      syncToBackend(get().blacklist);
    },

    removeSymbolFromAll: (sym) => {
      set((s) => {
        const newAccounts: Record<string, string[]> = {};
        for (const [id, list] of Object.entries(s.blacklist.accounts)) {
          newAccounts[id] = list.filter((x) => x !== sym);
        }
        return {
          blacklist: {
            global: s.blacklist.global.filter((x) => x !== sym),
            accounts: newAccounts,
          },
        };
      });
      syncToBackend(get().blacklist);
    },

    clearBlacklist: () => {
      set({ blacklist: { global: [], accounts: {} } });
      syncToBackend({ global: [], accounts: {} });
    },

    isBlacklisted: (sym) => {
      if (!sym) return false;
      const state = get() as any;
      const { blacklist } = state;
      if (blacklist.global.includes(sym)) return true;
      const activeAccountId: string | null = state.activeAccountId ?? null;
      if (activeAccountId && blacklist.accounts[activeAccountId]?.includes(sym)) return true;
      return false;
    },
  };
}
