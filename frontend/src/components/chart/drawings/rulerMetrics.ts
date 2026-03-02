import type { Bar } from '../../../services/marketDataService';
import type { RulerMetrics } from '../../../types/drawing';

export function computeRulerMetrics(
  bars: Bar[],
  p1: { time: number; price: number },
  p2: { time: number; price: number },
): RulerMetrics {
  const priceChange = p2.price - p1.price;
  const pctChange = p1.price !== 0 ? (priceChange / p1.price) * 100 : 0;

  const tMin = Math.min(p1.time, p2.time);
  const tMax = Math.max(p1.time, p2.time);

  const barsInRange = bars.filter((b) => {
    const ts = new Date(b.t).getTime() / 1000;
    return ts >= tMin && ts <= tMax;
  });

  const barCount = barsInRange.length;
  const volumeSum = barsInRange.reduce((sum, b) => sum + b.v, 0);
  const timeSpanMs = Math.abs(p2.time - p1.time) * 1000;
  const timeSpan = formatDuration(timeSpanMs);

  return { priceChange, pctChange, barCount, timeSpan, timeSpanMs, volumeSum };
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${totalSec}s`);
  return parts.join(' ');
}

export function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toLocaleString();
}
