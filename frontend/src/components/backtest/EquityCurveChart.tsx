import { useEffect, useRef, memo } from 'react';
import { createChart, createSeriesMarkers, BaselineSeries, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, SingleValueData, UTCTimestamp, ISeriesMarkersPluginApi, SeriesMarker, Time } from 'lightweight-charts';
import type { EquityPoint } from '../../services/backtestService';
import { CHART_OPTIONS, nyTimeFormatterRaw } from '../chart/chartTheme';
import { FONT_FAMILY } from '../../constants/layout';
import { COLOR_BUY, COLOR_SELL, COLOR_TEXT_DIM, COLOR_BORDER } from '../../constants/colors';

interface Props {
  points: EquityPoint[];
  initialEquity: number;
  isEmpty?: boolean;
  emptyMessage?: string;
  /** Pixel height (number) or any CSS height value (e.g. '100%') to fill the parent. */
  height?: number | string;
  /** Draw a small circle marker at every point. Set max count to keep dots from cluttering dense series. */
  showMarkers?: boolean;
  markerThreshold?: number;
  /** Background color for the chart surface. Defaults to black to match the backtest panel. */
  background?: string;
}

function toRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function toPoint(p: EquityPoint, initial: number): SingleValueData<UTCTimestamp> {
  return {
    time: Math.floor(new Date(p.t).getTime() / 1000) as UTCTimestamp,
    value: p.equity - initial,
  };
}

// Lightweight Charts requires strictly ascending timestamps. When two trades
// close in the same second they get the same floored timestamp — keep only
// the last (highest equity) for each second so setData never throws.
function deduplicateByTime(data: SingleValueData<UTCTimestamp>[]): SingleValueData<UTCTimestamp>[] {
  if (data.length === 0) return data;
  const out: SingleValueData<UTCTimestamp>[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    if (data[i].time === out[out.length - 1].time) {
      out[out.length - 1] = data[i]; // replace with later value
    } else {
      out.push(data[i]);
    }
  }
  return out;
}

// Maximum number of data points sent to the LWC series. Dense backtests can
// produce 100k+ points (one per bar), which makes canvas redraws during
// price-scale drag extremely slow. We downsample to this limit while keeping
// the full array in pointsRef for accurate crosshair tooltip lookups.
const MAX_CHART_POINTS = 2_000;

/**
 * LTTB (Largest Triangle Three Buckets) downsampling.
 * Preserves peaks and troughs — better than uniform sampling for equity curves.
 */
function lttb(
  data: SingleValueData<UTCTimestamp>[],
  threshold: number,
): SingleValueData<UTCTimestamp>[] {
  const n = data.length;
  if (n <= threshold) return data;

  const out: SingleValueData<UTCTimestamp>[] = [data[0]];
  const bucketSize = (n - 2) / (threshold - 2);
  let a = 0;

  for (let i = 0; i < threshold - 2; i++) {
    // Centroid of the next bucket (look-ahead for triangle area calculation)
    const avgStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgEnd   = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    let avgX = 0, avgY = 0;
    for (let j = avgStart; j < avgEnd; j++) {
      avgX += data[j].time as number;
      avgY += data[j].value;
    }
    const avgLen = avgEnd - avgStart;
    avgX /= avgLen;
    avgY /= avgLen;

    // Pick the point in the current bucket that forms the largest triangle
    const currStart = Math.floor(i * bucketSize) + 1;
    const currEnd   = Math.min(Math.floor((i + 1) * bucketSize) + 1, n);
    let maxArea = -1, maxIdx = currStart;
    const ax = data[a].time as number;
    const ay = data[a].value;
    for (let j = currStart; j < currEnd; j++) {
      const area = Math.abs(
        (ax - avgX) * (data[j].value - ay) -
        (ax - (data[j].time as number)) * (avgY - ay),
      );
      if (area > maxArea) { maxArea = area; maxIdx = j; }
    }
    out.push(data[maxIdx]);
    a = maxIdx;
  }

  out.push(data[n - 1]);
  return out;
}


export const EquityCurveChart = memo(function EquityCurveChart({
  points,
  initialEquity,
  isEmpty,
  emptyMessage = 'Run a strategy to see the equity curve',
  height = 180,
  showMarkers = false,
  markerThreshold = 80,
  background = '#000000',
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const tooltipRef    = useRef<HTMLDivElement>(null);
  const tooltipSpan   = useRef<HTMLSpanElement | null>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const seriesRef     = useRef<ISeriesApi<'Baseline'> | null>(null);
  const markersRef    = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const disposedRef   = useRef(false);
  const pointsRef     = useRef<SingleValueData<UTCTimestamp>[]>([]);
  const rafRef        = useRef<number | null>(null);

  // Tracks what is currently rendered into the LWC series so the data-sync
  // effect can append incrementally (series.update) instead of rebuilding the
  // whole series (series.setData) on every streaming batch.
  const renderedCountRef        = useRef(0);
  const renderedInitialRef      = useRef<number | null>(null);
  const renderedShowMarkersRef  = useRef(false);
  const renderedThresholdRef    = useRef(0);

  // Mount / unmount chart
  useEffect(() => {
    if (!containerRef.current) return;
    disposedRef.current = false;

    const chart = createChart(containerRef.current, {
      ...CHART_OPTIONS,
      layout: {
        ...CHART_OPTIONS.layout,
        background: { type: ColorType.Solid, color: background },
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: COLOR_TEXT_DIM, labelBackgroundColor: COLOR_BORDER, labelVisible: true },
        horzLine: { color: COLOR_TEXT_DIM, labelBackgroundColor: COLOR_BORDER, labelVisible: true },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      localization: {
        priceFormatter: (v: number) => v.toFixed(2),
        timeFormatter: (t: number) => nyTimeFormatterRaw(t),
      },
    });

    const series = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: COLOR_BUY,
      topFillColor1: toRgba(COLOR_BUY, 0.25),
      topFillColor2: toRgba(COLOR_BUY, 0.02),
      bottomLineColor: COLOR_SELL,
      bottomFillColor1: toRgba(COLOR_SELL, 0.02),
      bottomFillColor2: toRgba(COLOR_SELL, 0.25),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      autoscaleInfoProvider: (original) => {
        const res = original();
        if (!res) return null;
        return {
          ...res,
          priceRange: {
            minValue: Math.min(res.priceRange.minValue, 0),
            maxValue: Math.max(res.priceRange.maxValue, 0),
          },
        };
      },
    });

    series.createPriceLine({
      price: 0,
      color: toRgba(COLOR_TEXT_DIM, 0.4),
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
    });

    chartRef.current  = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);

    // Reset render-tracking refs — the new series starts empty.
    renderedCountRef.current       = 0;
    renderedInitialRef.current     = null;
    renderedShowMarkersRef.current = false;
    renderedThresholdRef.current   = 0;
    pointsRef.current              = [];

    chart.subscribeCrosshairMove((param) => {
      if (rafRef.current !== null) return; // already queued
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const tooltip = tooltipRef.current;
        const span    = tooltipSpan.current;
        if (!tooltip || !span) return;

        if (!param.time || !param.point) {
          tooltip.style.opacity = '0';
          return;
        }

        const arr = pointsRef.current;
        const t = param.time as UTCTimestamp;
        let lo = 0, hi = arr.length - 1, best = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if ((arr[mid].time as number) <= (t as number)) { best = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        if (best < 0) { tooltip.style.opacity = '0'; return; }

        const value = arr[best].value;
        span.style.color = value >= 0 ? COLOR_BUY : COLOR_SELL;
        span.textContent = `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;
        tooltip.style.opacity = '1';
      });
    });

    return () => {
      disposedRef.current  = true;
      chartRef.current     = null;
      seriesRef.current    = null;
      markersRef.current   = null;
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      try { chart.remove(); } catch { /* disposed */ }
    };
  }, [background]);

  // Sync data and markers whenever points prop changes.
  // Streaming path: when the new array is the previously-rendered one with
  // more points appended, call series.update() per tail point instead of
  // rebuilding via setData() — turns O(N²) streaming into O(N).
  useEffect(() => {
    if (!seriesRef.current || disposedRef.current) return;
    const series = seriesRef.current;

    const newLen = points.length;
    const oldLen = renderedCountRef.current;
    const rendered = pointsRef.current;
    const lastIdx  = oldLen - 1;

    const canAppend =
      oldLen > 0 &&
      newLen >= oldLen &&
      renderedInitialRef.current     === initialEquity &&
      renderedShowMarkersRef.current === showMarkers &&
      renderedThresholdRef.current   === markerThreshold &&
      !!points[lastIdx] &&
      !!rendered[lastIdx] &&
      Math.floor(new Date(points[lastIdx].t).getTime() / 1000) === (rendered[lastIdx].time as number) &&
      (points[lastIdx].equity - initialEquity) === rendered[lastIdx].value;

    if (canAppend) {
      if (newLen === oldLen) return; // nothing new
      for (let i = oldLen; i < newLen; i++) {
        const p = toPoint(points[i], initialEquity);
        series.update(p); // LWC update() replaces bar if time matches last, or appends if greater
        if (rendered.length > 0 && rendered[rendered.length - 1].time === p.time) {
          rendered[rendered.length - 1] = p;
        } else {
          rendered.push(p);
        }
      }
      if (markersRef.current) {
        const showDots = showMarkers && newLen > 0 && (markerThreshold === 0 || newLen <= markerThreshold);
        const markers: SeriesMarker<Time>[] = showDots
          ? rendered.map((d) => ({
              time: d.time,
              position: 'inBar',
              shape: 'circle',
              color: d.value >= 0 ? COLOR_BUY : COLOR_SELL,
              size: 0.6,
            }))
          : [];
        markersRef.current.setMarkers(markers);
      }
      chartRef.current?.timeScale().fitContent();
      renderedCountRef.current = newLen;
      return;
    }

    // Full rebuild
    const data = deduplicateByTime(points.map((p) => toPoint(p, initialEquity)).sort((a, b) => (a.time as number) - (b.time as number)));
    // Keep the full-resolution array for tooltip binary search; pass a
    // downsampled copy to LWC so canvas redraws stay fast even with 100k+ bars.
    pointsRef.current = data;
    const chartData = lttb(data, MAX_CHART_POINTS);
    series.setData(chartData);
    if (markersRef.current) {
      const showDots = showMarkers && chartData.length > 0 && (markerThreshold === 0 || chartData.length <= markerThreshold);
      const markers: SeriesMarker<Time>[] = showDots
        ? chartData.map((d) => ({
            time: d.time,
            position: 'inBar',
            shape: 'circle',
            color: d.value >= 0 ? COLOR_BUY : COLOR_SELL,
            size: 0.6,
          }))
        : [];
      markersRef.current.setMarkers(markers);
    }
    if (chartData.length > 0) chartRef.current?.timeScale().fitContent();

    renderedCountRef.current       = data.length;
    renderedInitialRef.current     = initialEquity;
    renderedShowMarkersRef.current = showMarkers;
    renderedThresholdRef.current   = markerThreshold;
  }, [points, initialEquity, showMarkers, markerThreshold]);

  return (
    <div style={{ position: 'relative', height }}>
      <div ref={containerRef} className="w-full" style={{ height }} />
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          pointerEvents: 'none',
          fontSize: 12,
          fontFamily: FONT_FAMILY,
          opacity: 0,
          fontFeatureSettings: '"tnum"',
          whiteSpace: 'nowrap',
          padding: '3px 10px',
          borderRadius: 4,
          background: 'rgba(0,0,0,0.75)',
          zIndex: 10,
        }}
      >
        <span ref={tooltipSpan} style={{ fontWeight: 600 }} />
      </div>
      {isEmpty && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ color: 'var(--color-text-muted)', fontSize: 12, fontFamily: FONT_FAMILY }}
        >
          {emptyMessage}
        </div>
      )}
    </div>
  );
});
