import type { Contract } from '../services/marketDataService';

/**
 * Get ticks-per-point for an instrument.
 * Futures: Math.round(1 / tickSize) → 4 for tickSize=0.25.
 * Crypto: 1 (a "point" equals one tick).
 */
export function getTicksPerPoint(contract: Contract): number {
  return contract.ticksPerPoint ?? Math.round(1 / contract.tickSize);
}

/**
 * Convert a "points" offset to an absolute price offset.
 * Futures: 10 points * 0.25 * 4 = 10.00
 */
export function pointsToPrice(points: number, contract: Contract): number {
  return points * contract.tickSize * getTicksPerPoint(contract);
}

/**
 * Convert an absolute price offset back to points.
 */
export function priceToPoints(priceOffset: number, contract: Contract): number {
  return priceOffset / (contract.tickSize * getTicksPerPoint(contract));
}

/**
 * Convert points to ticks (gateway bracket API expects ticks).
 */
export function pointsToTicks(points: number, contract: Contract): number {
  return points * getTicksPerPoint(contract);
}

/**
 * Calculate P&L for a price difference, instrument, and position size.
 * The formula (priceDiff / tickSize) * tickValue * size is universal:
 *   Futures: (10 / 0.25) * 0.50 * 2 = $40
 *   Crypto:  tickValue === tickSize → reduces to priceDiff * size
 */
export function calcPnl(priceDiff: number, contract: Contract, size: number): number {
  return (priceDiff / contract.tickSize) * contract.tickValue * size;
}
