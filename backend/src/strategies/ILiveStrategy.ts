import type { Response } from 'express';

export type StrategyState = 'stopped' | 'starting' | 'warming_up' | 'running' | 'error';

export interface LiveStrategyConfig {
  accountId: string;
  contractId: string;
  contractName?: string;
  tickSize: number;
  [key: string]: unknown;
}

export interface LiveStrategyInfo {
  id: string;
  name: string;
  description: string;
  state: StrategyState;
  config?: LiveStrategyConfig;
  startedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ILiveStrategy {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  onBroadcast: ((info: LiveStrategyInfo) => void) | undefined;
  start(config: LiveStrategyConfig): Promise<void>;
  stop(): Promise<void>;
  getInfo(): LiveStrategyInfo;
}
