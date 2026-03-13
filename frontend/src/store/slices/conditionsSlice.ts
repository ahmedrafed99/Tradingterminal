import type { Condition } from '../../services/conditionService';

const DEFAULT_CONDITION_SERVER = 'http://localhost:3001';

/** Resolve the effective condition server URL (empty → localhost:3001). */
export function resolveConditionServerUrl(raw: string): string {
  return raw.trim() || DEFAULT_CONDITION_SERVER;
}

export interface ConditionsSlice {
  conditionServerUrl: string;
  conditions: Condition[];
  conditionModalOpen: boolean;
  editingConditionId: string | null;
  conditionPreview: boolean;
  setConditionServerUrl: (url: string) => void;
  setConditions: (conditions: Condition[]) => void;
  upsertCondition: (condition: Condition) => void;
  removeCondition: (id: string) => void;
  openConditionModal: (editId?: string) => void;
  closeConditionModal: () => void;
  setConditionPreview: (on: boolean) => void;
}

type Set = {
  (partial: Partial<ConditionsSlice>): void;
  (fn: (s: ConditionsSlice) => Partial<ConditionsSlice>): void;
};

export const createConditionsSlice = (set: Set): ConditionsSlice => ({
  conditionServerUrl: '',
  conditions: [] as Condition[],
  conditionModalOpen: false,
  editingConditionId: null,
  conditionPreview: false,
  setConditionServerUrl: (conditionServerUrl) => set({ conditionServerUrl }),
  setConditionPreview: (conditionPreview) => set({ conditionPreview }),
  openConditionModal: (editId) => set({ conditionModalOpen: true, editingConditionId: editId ?? null }),
  closeConditionModal: () => set({ conditionModalOpen: false, editingConditionId: null }),
  setConditions: (conditions) => set({ conditions }),
  upsertCondition: (condition) =>
    set((s) => {
      const idx = s.conditions.findIndex((c) => c.id === condition.id);
      if (idx === -1) return { conditions: [...s.conditions, condition] };
      const next = [...s.conditions];
      next[idx] = condition;
      return { conditions: next };
    }),
  removeCondition: (id) =>
    set((s) => ({ conditions: s.conditions.filter((c) => c.id !== id) })),
});
