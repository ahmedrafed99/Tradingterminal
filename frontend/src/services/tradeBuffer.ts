import type { MarketTick } from './realtimeService';

export interface TradeBuffer {
  ticks: MarketTick[];
  connectTimeMs: number;
}

// Maximum fills to keep in memory (~1M NQ fills ≈ 24MB, more than a full session)
const MAX_TICKS = 1_000_000;

const buffers = new Map<string, TradeBuffer>();

export function getOrCreateBuffer(contractId: string): TradeBuffer {
  let buf = buffers.get(contractId);
  if (!buf) {
    buf = { ticks: [], connectTimeMs: Date.now() };
    buffers.set(contractId, buf);
  }
  return buf;
}

export function addTicks(contractId: string, ticks: MarketTick[]): void {
  const buf = getOrCreateBuffer(contractId);
  for (const t of ticks) buf.ticks.push(t);
  if (buf.ticks.length > MAX_TICKS) {
    buf.ticks.splice(0, buf.ticks.length - MAX_TICKS);
  }
}

/** Clear buffer and reset connectTimeMs (call on reconnect or contract change). */
export function clearBuffer(contractId: string): void {
  buffers.delete(contractId);
}
