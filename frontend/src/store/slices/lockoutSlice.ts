export interface LockoutSlice {
  lockouts: Record<string, number>; // accountId → expiry ms timestamp
  setLockout: (accountId: string, expiryMs: number) => void;
  clearLockout: (accountId: string) => void;
  isLockedOut: (accountId: string | null | undefined) => boolean;
}

type Set = (partial: Partial<LockoutSlice> | ((s: LockoutSlice) => Partial<LockoutSlice>)) => void;

export function createLockoutSlice(set: Set, get: () => LockoutSlice): LockoutSlice {
  return {
    lockouts: {},

    setLockout: (accountId, expiryMs) => {
      set((s) => ({ lockouts: { ...s.lockouts, [accountId]: expiryMs } }));
    },

    clearLockout: (accountId) => {
      set((s) => {
        const next = { ...s.lockouts };
        delete next[accountId];
        return { lockouts: next };
      });
    },

    // Evaluated at call time so expired lockouts self-clear without a tick
    isLockedOut: (accountId) => {
      if (!accountId) return false;
      const expiry = get().lockouts[accountId];
      return expiry != null && Date.now() < expiry;
    },
  };
}
