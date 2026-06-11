export interface RiskGuardSlice {
  riskGuardEnabled: boolean;
  riskGuardMaxLoss: number;
  setRiskGuardEnabled: (v: boolean) => void;
  setRiskGuardMaxLoss: (v: number) => void;
}

type Set = {
  (partial: Partial<RiskGuardSlice>): void;
  (fn: (s: RiskGuardSlice) => Partial<RiskGuardSlice>): void;
};

export const createRiskGuardSlice = (set: Set): RiskGuardSlice => ({
  riskGuardEnabled: false,
  riskGuardMaxLoss: 100,
  setRiskGuardEnabled: (v) => set({ riskGuardEnabled: v }),
  setRiskGuardMaxLoss: (v) => set({ riskGuardMaxLoss: v }),
});
