import api from '../../services/api';

export interface BlacklistSlice {
  blacklistedSymbols: string[];
  addToBlacklist: (id: string) => void;
  removeFromBlacklist: (id: string) => void;
  clearBlacklist: () => void;
  isBlacklisted: (id: string | null | undefined) => boolean;
}

type Set = {
  (partial: Partial<BlacklistSlice>): void;
  (fn: (s: BlacklistSlice) => Partial<BlacklistSlice>): void;
};

function syncToBackend(symbols: string[]): void {
  api.post('/blacklist/sync', { symbols }).catch(() => {
    // Best-effort — backend may not be running yet
  });
}

export function createBlacklistSlice(
  set: Set,
  get: () => BlacklistSlice,
): BlacklistSlice {
  return {
    blacklistedSymbols: [],

    addToBlacklist: (id) => {
      set((s) => ({
        blacklistedSymbols: s.blacklistedSymbols.includes(id)
          ? s.blacklistedSymbols
          : [...s.blacklistedSymbols, id],
      }));
      syncToBackend(get().blacklistedSymbols);
    },

    removeFromBlacklist: (id) => {
      set((s) => ({
        blacklistedSymbols: s.blacklistedSymbols.filter((sym) => sym !== id),
      }));
      syncToBackend(get().blacklistedSymbols);
    },

    clearBlacklist: () => {
      set({ blacklistedSymbols: [] });
      syncToBackend([]);
    },

    isBlacklisted: (id) => {
      if (!id) return false;
      return get().blacklistedSymbols.includes(id);
    },
  };
}
