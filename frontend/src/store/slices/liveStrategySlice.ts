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
    /** Cached trade config from the last ML poll — used for signal preview. */
    tradeConfig?: {
      sl_pts: number;
      tp_pts?: number;
      targets: Array<{ tp_pts: number; contracts: number }> | null;
      total_contracts: number;
      trailing_stop: boolean;
      trailing_dist_pts: number;
    };
    /** ISO timestamp of the last completed poll. */
    lastPollAt?: string;
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
