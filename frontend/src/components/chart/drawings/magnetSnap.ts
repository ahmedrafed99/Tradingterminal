import type { IChartApi } from 'lightweight-charts';
import type { Bar } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';

/** Returns true if magnet mode is active (persistent toggle OR Ctrl held). */
export function isMagnetActive(e: MouseEvent | null): boolean {
  return useStore.getState().magnetEnabled || (e?.altKey ?? false);
}

/** Binary search bars (sorted by time asc) for the bar matching targetTime (unix seconds). */
function findBarIndex(bars: Bar[], targetTime: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    // Date.parse avoids object allocation vs new Date().getTime()
    const t = Date.parse(bars[mid].t) / 1000 | 0;
    if (t === targetTime) return mid;
    if (t < targetTime) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Snaps mousePrice to the nearest OHLC level of the bar with the given time.
 * Used when the bar time is already known (e.g. from param.time in MagnetOHLC mode),
 * avoiding the coordinateToTime(rawMouseX) → exact-match failure path.
 */
export function snapPriceToOHLCByTime(
  mousePrice: number,
  barTime: number,
  bars: Bar[],
): number {
  if (bars.length === 0) return mousePrice;

  const centerIdx = findBarIndex(bars, barTime);
  if (centerIdx === -1) return mousePrice;

  let bestPrice = mousePrice;
  let bestDist = Infinity;

  const b = bars[centerIdx];
  for (const level of [b.o, b.h, b.l, b.c]) {
    const dist = Math.abs(level - mousePrice);
    if (dist < bestDist) {
      bestDist = dist;
      bestPrice = level;
    }
  }

  return bestPrice;
}

/**
 * Snaps mousePrice to the nearest candle OHLC level of the bar at mouseX.
 * Always snaps to the closest of O/H/L/C regardless of distance.
 * Checks the bar and its ±1 immediate neighbors for edge accuracy.
 */
export function snapPriceToOHLC(
  mousePrice: number,
  mouseX: number,
  chart: IChartApi,
  bars: Bar[],
): number {
  if (bars.length === 0) return mousePrice;

  const barTime = chart.timeScale().coordinateToTime(mouseX) as number | null;
  if (!barTime) return mousePrice;

  const centerIdx = findBarIndex(bars, barTime);
  if (centerIdx === -1) return mousePrice;

  let bestPrice = mousePrice;
  let bestDist = Infinity;

  for (let di = -1; di <= 1; di++) {
    const idx = centerIdx + di;
    if (idx < 0 || idx >= bars.length) continue;
    const b = bars[idx];
    for (const level of [b.o, b.h, b.l, b.c]) {
      const dist = Math.abs(level - mousePrice);
      if (dist < bestDist) {
        bestDist = dist;
        bestPrice = level;
      }
    }
  }

  return bestPrice;
}

/**
 * Convenience wrapper: snaps price when magnet is active, returns it unchanged otherwise.
 * Replaces the repetitive `isMagnetActive(e) ? snapPriceToOHLC(...) : price` pattern.
 */
export function maybeSnap(
  e: MouseEvent,
  price: number,
  mouseX: number,
  chart: IChartApi,
  bars: Bar[],
): number {
  return isMagnetActive(e) ? snapPriceToOHLC(price, mouseX, chart, bars) : price;
}
