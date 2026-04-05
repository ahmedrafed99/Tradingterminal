import type { ExchangeAdapter } from './types';
import { createProjectXAdapter } from './projectx';
import { createHyperliquidAdapter } from './hyperliquid';

const factories: Record<string, () => ExchangeAdapter> = {
  projectx: createProjectXAdapter,
  hyperliquid: createHyperliquidAdapter,
};

export function createAdapter(exchange: string): ExchangeAdapter {
  const factory = factories[exchange];
  if (!factory) {
    const known = Object.keys(factories).join(', ');
    throw new Error(`Unknown exchange "${exchange}". Known exchanges: ${known}`);
  }
  return factory();
}

export function listExchanges(): string[] {
  return Object.keys(factories);
}
