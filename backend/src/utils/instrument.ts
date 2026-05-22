import type { BracketContract } from '../types/bracket';

/**
 * Convert a tick count to a price offset.
 *   e.g. 10 ticks × $0.25/tick = $2.50 price offset
 */
export function ticksToPrice(ticks: number, contract: BracketContract): number {
  return ticks * contract.tickSize;
}

/**
 * Round a price to the nearest valid tick, eliminating IEEE-754 drift.
 */
export function roundToTick(price: number, tickSize: number): number {
  const decimals = (tickSize.toString().split('.')[1] ?? '').length;
  return parseFloat((Math.round(price / tickSize) * tickSize).toFixed(decimals));
}
