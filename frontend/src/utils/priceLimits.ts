import type { Bar } from '../services/marketDataService';
import { getCurrentSessionStartSec } from './marketHours';

// CME equity index product codes (CON.F.US.<PRODUCT>.<EXPIRY>) that have fixed daily price limits.
// Energy and metals use rolling dynamic circuit breakers — no static line to draw.
const EQUITY_INDEX_PRODUCTS = new Set([
  'EP',   // /ES
  'ENQ',  // /NQ
  'MES',  // /MES
  'MNQ',  // /MNQ
  'ERY',  // /RTY  (Russell 2000 E-mini)
  'M2K',  // /M2K  (Russell 2000 Micro)
  'YM',   // /YM   (Dow E-mini)
  'MYM',  // /MYM  (Dow Micro)
]);

export const LIMIT_PCT = 7;
export const BUFFER_PCT = 2;

/** Returns limit config if the contract is an equity index product, null otherwise. */
export function getPriceLimitConfig(contractId: string): { limitPct: number; bufferPct: number } | null {
  const match = contractId.match(/^CON\.F\.US\.([^.]+)\./);
  if (!match) return null;
  if (!EQUITY_INDEX_PRODUCTS.has(match[1])) return null;
  return { limitPct: LIMIT_PCT, bufferPct: BUFFER_PCT };
}

/**
 * Derives settlement price = close of the last bar from the PREVIOUS session.
 * Uses getCurrentSessionStartSec() (18:00 ET) as the session boundary.
 * Returns null if bar history doesn't reach the previous session.
 */
export function deriveSettlementPrice(bars: Bar[]): number | null {
  const sessionStartMs = getCurrentSessionStartSec() * 1000;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (new Date(bars[i].t).getTime() < sessionStartMs) return bars[i].c;
  }
  return null;
}

export interface PriceLimitLevels {
  upperLimit: number;
  upperThreshold: number;
  lowerThreshold: number;
  lowerLimit: number;
}

/** Computes the 4 price level values from settlement + config. */
export function computeLimitLevels(
  settlement: number,
  limitPct: number,
  bufferPct: number,
): PriceLimitLevels {
  const limitFrac = limitPct / 100;
  const threshFrac = (limitPct - bufferPct) / 100;
  return {
    upperLimit:     settlement * (1 + limitFrac),
    upperThreshold: settlement * (1 + threshFrac),
    lowerThreshold: settlement * (1 - threshFrac),
    lowerLimit:     settlement * (1 - limitFrac),
  };
}

/** True when price has entered the 2% buffer zone (trading must be blocked). */
export function isPriceNearLimit(
  price: number,
  levels: PriceLimitLevels,
): boolean {
  return price >= levels.upperThreshold || price <= levels.lowerThreshold;
}
