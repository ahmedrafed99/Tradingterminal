import type { KeyCombo } from '../../constants/shortcuts';

export interface ShortcutsSlice {
  customShortcuts: Record<string, KeyCombo[]>;
  setShortcut: (id: string, combos: KeyCombo[]) => void;
  resetShortcut: (id: string) => void;
  resetAllShortcuts: () => void;
}

type Set = {
  (partial: Partial<ShortcutsSlice>): void;
  (fn: (s: ShortcutsSlice) => Partial<ShortcutsSlice>): void;
};

export const createShortcutsSlice = (set: Set): ShortcutsSlice => ({
  customShortcuts: {},
  setShortcut: (id, combos) =>
    set((s) => ({
      customShortcuts: { ...s.customShortcuts, [id]: combos },
    })),
  resetShortcut: (id) =>
    set((s) => {
      const next = { ...s.customShortcuts };
      delete next[id];
      return { customShortcuts: next };
    }),
  resetAllShortcuts: () => set({ customShortcuts: {} }),
});
