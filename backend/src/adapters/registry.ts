import type { ExchangeAdapter } from './types';

let currentAdapter: ExchangeAdapter | null = null;

export function getAdapter(): ExchangeAdapter {
  if (!currentAdapter) {
    throw new Error('No exchange adapter initialized. Call connect first.');
  }
  return currentAdapter;
}

export function setAdapter(adapter: ExchangeAdapter): void {
  currentAdapter = adapter;
}

export function clearAdapter(): void {
  currentAdapter = null;
}

export function isConnected(): boolean {
  return currentAdapter?.auth.isConnected() ?? false;
}
