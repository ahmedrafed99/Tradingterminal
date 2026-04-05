import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';

export interface SessionBarMap {
  compressedBars: CandlestickData<UTCTimestamp>[];
  /** compressed fake timestamp → real UTC seconds */
  compressedToReal: Map<number, number>;
  /** real UTC seconds → compressed fake timestamp */
  realToCompressed: Map<number, number>;
  periodSec: number;
  /** next fake timestamp to assign when a new bar opens */
  nextCompressedTime: number;
}

// Non-zero origin avoids potential edge cases in lightweight-charts internals
const BASE_EPOCH = 1_000_000;

/**
 * Build a SessionBarMap from a sorted-ascending array of candles.
 * Each candle is assigned a sequential fake timestamp starting at BASE_EPOCH,
 * spaced exactly periodSec apart — so all bars render contiguously with no gaps.
 */
export function buildSessionBarMap(
  candles: CandlestickData<UTCTimestamp>[],
  periodSec: number,
): SessionBarMap {
  const compressedToReal = new Map<number, number>();
  const realToCompressed = new Map<number, number>();
  const compressedBars: CandlestickData<UTCTimestamp>[] = [];

  for (let i = 0; i < candles.length; i++) {
    const compTime = (BASE_EPOCH + i * periodSec) as UTCTimestamp;
    const realTime = candles[i].time as number;
    compressedToReal.set(compTime, realTime);
    realToCompressed.set(realTime, compTime);
    compressedBars.push({ ...candles[i], time: compTime });
  }

  return {
    compressedBars,
    compressedToReal,
    realToCompressed,
    periodSec,
    nextCompressedTime: BASE_EPOCH + candles.length * periodSec,
  };
}

/**
 * Look up the compressed time for a given real UTC seconds value.
 * If the mapping doesn't exist yet (new bar), assign nextCompressedTime and advance it.
 * Mutates the map in place when isNew === true.
 */
export function getOrAssignCompressedTime(
  realTimeSec: number,
  map: SessionBarMap,
): { compressedTime: number; isNew: boolean } {
  const existing = map.realToCompressed.get(realTimeSec);
  if (existing !== undefined) {
    return { compressedTime: existing, isNew: false };
  }
  const compTime = map.nextCompressedTime;
  map.compressedToReal.set(compTime, realTimeSec);
  map.realToCompressed.set(realTimeSec, compTime);
  map.nextCompressedTime = compTime + map.periodSec;
  return { compressedTime: compTime, isNew: true };
}

/**
 * Generate future whitespace entries continuing from the map's next available slot.
 * Used to keep the time axis extended beyond the last real candle.
 */
export function generateSessionWhitespace(
  map: SessionBarMap,
  count: number,
): { time: UTCTimestamp }[] {
  const result: { time: UTCTimestamp }[] = [];
  for (let i = 0; i < count; i++) {
    result.push({ time: (map.nextCompressedTime + i * map.periodSec) as UTCTimestamp });
  }
  return result;
}
