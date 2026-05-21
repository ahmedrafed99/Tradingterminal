import type { Response } from 'express';
import type { LiveStrategyConfig, LiveStrategyInfo } from '../strategies/ILiveStrategy';
import { MLNQStrategy } from '../strategies/mlNQStrategy';

const REGISTRY = [
  new MLNQStrategy(),
];

const sseClients = new Set<Response>();

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch {}
  }
}

// Wire broadcast callback for every strategy
for (const s of REGISTRY) {
  s.onBroadcast = (info) => broadcast('update', info);
}

export function addSSEClient(res: Response): void {
  sseClients.add(res);
  const cleanup = () => sseClients.delete(res);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

export function listStrategies(): LiveStrategyInfo[] {
  return REGISTRY.map((s) => s.getInfo());
}

export function getStrategy(id: string): LiveStrategyInfo | null {
  return REGISTRY.find((s) => s.id === id)?.getInfo() ?? null;
}

export async function startStrategy(id: string, config: LiveStrategyConfig): Promise<void> {
  const strategy = REGISTRY.find((s) => s.id === id);
  if (!strategy) throw new Error(`Unknown strategy: ${id}`);
  await strategy.start(config);
}

export async function stopStrategy(id: string): Promise<void> {
  const strategy = REGISTRY.find((s) => s.id === id);
  if (!strategy) throw new Error(`Unknown strategy: ${id}`);
  await strategy.stop();
}

export function init(): void {
  // strategies are started by user action; nothing to auto-start
}

export function shutdown(): void {
  for (const s of REGISTRY) {
    if (s.getInfo().state !== 'stopped') {
      s.stop().catch(() => {});
    }
  }
}
