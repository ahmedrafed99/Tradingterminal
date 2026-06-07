import type { UTCTimestamp, CandlestickData } from 'lightweight-charts';
import type { Bar } from '../../services/marketDataService';
import type { Timeframe } from '../../store/useStore';

/** Convert API Bar to Lightweight Charts CandlestickData */
export function barToCandle(bar: Bar): CandlestickData<UTCTimestamp> {
  return {
    time: Math.floor(new Date(bar.t).getTime() / 1000) as UTCTimestamp,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
  };
}

/** Sort bars ascending by time (API returns reverse chronological) */
export function sortBarsAscending(bars: Bar[]): Bar[] {
  return [...bars].sort(
    (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime(),
  );
}

/** Get the candle period duration in seconds for a given timeframe.
 *  Returns 0 for tick bars (unit=7) — bars close on tick count, not time. */
export function getCandlePeriodSeconds(tf: Timeframe): number {
  switch (tf.unit) {
    case 1: return tf.unitNumber;            // seconds
    case 2: return tf.unitNumber * 60;       // minutes
    case 3: return tf.unitNumber * 3600;     // hours
    case 4: return tf.unitNumber * 86400;    // days
    case 5: return tf.unitNumber * 604800;   // weeks
    case 6: return tf.unitNumber * 2592000;  // months (~30 days)
    case 7: return 0;                        // tick bars — no fixed time period
    default: return 300;
  }
}

/** Compute an appropriate startTime lookback for the given timeframe */
export function computeStartTime(tf: Timeframe): string {
  const MS_DAY = 86_400_000;
  // Tick bars: 3-day window is enough; countback=500 caps the actual bar count
  if (tf.unit === 7) return new Date(Date.now() - 3 * MS_DAY).toISOString();
  const periodSec = getCandlePeriodSeconds(tf);
  // ~500 candles of lookback, clamped between 14 days and 365 days
  // 14-day minimum ensures we always span two full trading weeks (covers weekends + recent holidays)
  const lookbackMs = Math.min(Math.max(periodSec * 500 * 1000, 14 * MS_DAY), 365 * MS_DAY);
  return new Date(Date.now() - lookbackMs).toISOString();
}

/** Generate whitespace data points (time-only, no OHLC) beyond the last candle
 *  so the crosshair time label remains visible when hovering past the latest bar.
 *  When `filter` is provided (e.g. isTimestampInCMETradingSession), candidate slots
 *  that don't pass are skipped so the time axis never stretches into closed periods. */
export function generateWhitespace(
  lastTime: number,
  periodSec: number,
  count = 50,
  filter?: (t: number) => boolean,
): { time: UTCTimestamp }[] {
  const result: { time: UTCTimestamp }[] = [];
  const limit = filter ? count * 6 : count; // extra headroom to skip closed slots
  for (let i = 1; i <= limit && result.length < count; i++) {
    const barTime = lastTime + periodSec * i;
    if (!filter || filter(barTime)) {
      result.push({ time: barTime as UTCTimestamp });
    }
  }
  return result;
}

/** Snap a price to the nearest tick size increment */
export function snapToTickSize(price: number, tickSize: number): number {
  const s = tickSize.toString();
  const dot = s.indexOf('.');
  const decimals = dot < 0 ? 0 : s.length - dot - 1;
  return parseFloat((Math.round(price / tickSize) * tickSize).toFixed(decimals));
}

/** Get the price scale width, falling back to 56px if the scale isn't available */
export function getPriceScaleWidth(chart: { priceScale(id: string): { width(): number } }): number {
  try { return chart.priceScale('right').width(); } catch { return 56; }
}

/** Floor a UTC timestamp to the start of its candle period */
export function floorToCandlePeriod(
  timestampSec: number,
  periodSec: number,
): UTCTimestamp {
  return (Math.floor(timestampSec / periodSec) * periodSec) as UTCTimestamp;
}

/** Aggregate ascending-sorted time-based bars into a coarser timeframe.
 *  Buckets align to clock boundaries (`floor(t / targetPeriodSec) * targetPeriodSec`).
 *  Returns `[]` if `targetPeriodSec` is not a positive integer multiple of `sourcePeriodSec`.
 *  Caller must restrict to uniform-period units (seconds/minutes/hours/days/weeks) — months
 *  and quarters are not safe to aggregate this way. */
export function aggregateBars(
  sourceBars: Bar[],
  sourcePeriodSec: number,
  targetPeriodSec: number,
): Bar[] {
  if (sourceBars.length === 0) return [];
  if (sourcePeriodSec <= 0 || targetPeriodSec <= 0) return [];
  if (targetPeriodSec <= sourcePeriodSec) return [];
  if (targetPeriodSec % sourcePeriodSec !== 0) return [];

  const result: Bar[] = [];
  let bucketStart = -1;
  let o = 0, h = -Infinity, l = Infinity, c = 0, v = 0;

  for (const bar of sourceBars) {
    const t = Math.floor(new Date(bar.t).getTime() / 1000);
    const periodStart = Math.floor(t / targetPeriodSec) * targetPeriodSec;
    if (periodStart !== bucketStart) {
      if (bucketStart !== -1) {
        result.push({ t: new Date(bucketStart * 1000).toISOString(), o, h, l, c, v });
      }
      bucketStart = periodStart;
      o = bar.o; h = bar.h; l = bar.l; c = bar.c; v = bar.v;
    } else {
      if (bar.h > h) h = bar.h;
      if (bar.l < l) l = bar.l;
      c = bar.c;
      v += bar.v;
    }
  }
  if (bucketStart !== -1) {
    result.push({ t: new Date(bucketStart * 1000).toISOString(), o, h, l, c, v });
  }
  return result;
}
