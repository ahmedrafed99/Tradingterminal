export type StrategyState = 'stopped' | 'starting' | 'warming_up' | 'running' | 'error';

export interface LiveStrategyInfo {
  id: string;
  name: string;
  description: string;
  state: StrategyState;
  config?: {
    accountId: string;
    contractId: string;
    contractName?: string;
    tickSize: number;
  };
  startedAt?: string;
  error?: string;
  metadata?: {
    signal?: string;
    confidence?: number;
    barCount?: number;
    warmedUp?: boolean;
  };
}

export interface LiveStrategySlice {
  liveStrategies: LiveStrategyInfo[];
  setLiveStrategies: (strategies: LiveStrategyInfo[]) => void;
  updateLiveStrategy: (strategy: LiveStrategyInfo) => void;
}

type Set = (
  partial: Partial<LiveStrategySlice> | ((s: LiveStrategySlice) => Partial<LiveStrategySlice>),
) => void;

export const createLiveStrategySlice = (set: Set): LiveStrategySlice => ({
  liveStrategies: [],
  setLiveStrategies: (liveStrategies) => set({ liveStrategies }),
  updateLiveStrategy: (strategy) =>
    set((s) => ({
      liveStrategies: s.liveStrategies.some((x) => x.id === strategy.id)
        ? s.liveStrategies.map((x) => (x.id === strategy.id ? strategy : x))
        : [...s.liveStrategies, strategy],
    })),
});
