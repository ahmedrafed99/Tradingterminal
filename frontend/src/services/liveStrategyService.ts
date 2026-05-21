import type { LiveStrategyInfo } from '../store/slices/liveStrategySlice';

export async function listStrategies(serverUrl: string): Promise<LiveStrategyInfo[]> {
  const res = await fetch(`${serverUrl}/strategies`);
  if (!res.ok) throw new Error('Failed to fetch strategies');
  return res.json() as Promise<LiveStrategyInfo[]>;
}

export async function startStrategy(
  serverUrl: string,
  strategyId: string,
  config: { accountId: string; contractId: string; contractName?: string; tickSize?: number },
): Promise<LiveStrategyInfo> {
  const res = await fetch(`${serverUrl}/strategies/${strategyId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Failed to start strategy');
  }
  return res.json() as Promise<LiveStrategyInfo>;
}

export async function stopStrategy(
  serverUrl: string,
  strategyId: string,
): Promise<LiveStrategyInfo> {
  const res = await fetch(`${serverUrl}/strategies/${strategyId}/stop`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Failed to stop strategy');
  }
  return res.json() as Promise<LiveStrategyInfo>;
}

export interface StrategySSEHandlers {
  onSnapshot: (strategies: LiveStrategyInfo[]) => void;
  onUpdate: (strategy: LiveStrategyInfo) => void;
}

export function subscribeStrategies(serverUrl: string, handlers: StrategySSEHandlers): EventSource {
  const es = new EventSource(`${serverUrl}/strategies/events`);
  es.addEventListener('snapshot', (e: Event) => {
    handlers.onSnapshot(JSON.parse((e as MessageEvent<string>).data) as LiveStrategyInfo[]);
  });
  es.addEventListener('update', (e: Event) => {
    handlers.onUpdate(JSON.parse((e as MessageEvent<string>).data) as LiveStrategyInfo);
  });
  return es;
}
