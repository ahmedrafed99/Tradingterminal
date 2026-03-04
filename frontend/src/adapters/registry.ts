import type { RealtimeAdapter } from './types';

let currentAdapter: RealtimeAdapter | null = null;

export function getRealtimeAdapter(): RealtimeAdapter {
  if (!currentAdapter) {
    throw new Error('No realtime adapter initialized.');
  }
  return currentAdapter;
}

export function setRealtimeAdapter(adapter: RealtimeAdapter): void {
  currentAdapter = adapter;
}

export function clearRealtimeAdapter(): void {
  currentAdapter = null;
}
