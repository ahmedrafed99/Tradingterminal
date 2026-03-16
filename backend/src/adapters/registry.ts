import type { ExchangeAdapter } from './types';

const adapters = new Map<string, ExchangeAdapter>();

/** Default exchange used when no exchangeId is specified. */
let defaultExchangeId: string | null = null;

export function getAdapter(exchangeId?: string): ExchangeAdapter {
  const id = exchangeId ?? defaultExchangeId;
  if (!id) {
    throw new Error('No exchange adapter initialized. Call connect first.');
  }
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(`Exchange adapter "${id}" not found. Connected: [${listConnected().join(', ')}]`);
  }
  return adapter;
}

export function setAdapter(exchangeId: string, adapter: ExchangeAdapter): void {
  adapters.set(exchangeId, adapter);
  // First connected exchange becomes the default
  if (!defaultExchangeId) {
    defaultExchangeId = exchangeId;
  }
}

export function removeAdapter(exchangeId: string): void {
  adapters.delete(exchangeId);
  if (defaultExchangeId === exchangeId) {
    // Promote next available, or null
    const next = adapters.keys().next();
    defaultExchangeId = next.done ? null : next.value;
  }
}

export function clearAdapter(): void {
  adapters.clear();
  defaultExchangeId = null;
}

export function isConnected(exchangeId?: string): boolean {
  if (exchangeId) {
    return adapters.get(exchangeId)?.auth.isConnected() ?? false;
  }
  // Any connected adapter counts
  for (const adapter of adapters.values()) {
    if (adapter.auth.isConnected()) return true;
  }
  return false;
}

export function listConnected(): string[] {
  return [...adapters.keys()].filter((id) => adapters.get(id)!.auth.isConnected());
}

export function getDefaultExchangeId(): string | null {
  return defaultExchangeId;
}

export function setDefaultExchangeId(id: string): void {
  if (!adapters.has(id)) {
    throw new Error(`Cannot set default: exchange "${id}" is not connected.`);
  }
  defaultExchangeId = id;
}
