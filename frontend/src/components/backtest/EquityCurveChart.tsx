import { useEffect, useRef, memo } from 'react';
import { createChart, createSeriesMarkers, BaselineSeries, ColorType, CrosshairMode } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, SingleValueData, UTCTimestamp, ISeriesMarkersPluginApi, SeriesMarker, Time } from 'lightweight-charts';
import type { EquityPoint } from '../../services/backtestService';
import { CHART_OPTIONS } from '../chart/chartTheme';
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

const fmtTimeShort = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
});

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
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef   = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<'Baseline'> | null>(null);
  const markersRef   = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const disposedRef  = useRef(false);
  const pointsRef    = useRef<SingleValueData<UTCTimestamp>[]>([]);

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
        horzLines: { visible: true, color: toRgba(COLOR_TEXT_DIM, 0.5) },
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
        priceFormatter: (v: number) =>
          `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`,
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
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 5,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
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
      const tooltip = tooltipRef.current;
      if (!tooltip) return;

      if (!param.time || !param.point) {
        tooltip.style.opacity = '0';
        return;
      }

      const arr = pointsRef.current;
      const t = param.time as UTCTimestamp;
      // binary search for closest index with time <= t
      let lo = 0, hi = arr.length - 1, best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((arr[mid].time as number) <= (t as number)) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (best < 0) { tooltip.style.opacity = '0'; return; }

      const value = arr[best].value;
      const timeMs = (arr[best].time as number) * 1000;
      const timeLabel = fmtTimeShort.format(new Date(timeMs));
      const tradeNum = best + 1;
      const sign = value >= 0 ? '+' : '-';

      tooltip.innerHTML =
        `<span style="color:var(--color-text-muted);font-weight:400;margin-right:6px">Trade #${tradeNum}</span>` +
        `<span style="color:var(--color-text-muted);font-weight:400;margin-right:6px">${timeLabel}</span>` +
        `<span style="color:${value >= 0 ? COLOR_BUY : COLOR_SELL};font-weight:600">${sign}$${Math.abs(value).toFixed(2)}</span>`;
      tooltip.style.opacity = '1';
    });

    return () => {
      disposedRef.current  = true;
      chartRef.current     = null;
      seriesRef.current    = null;
      markersRef.current   = null;
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
        series.update(p);
        rendered.push(p);
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
    const data = points.map((p) => toPoint(p, initialEquity));
    pointsRef.current = data;
    series.setData(data);
    if (markersRef.current) {
      const showDots = showMarkers && data.length > 0 && (markerThreshold === 0 || data.length <= markerThreshold);
      const markers: SeriesMarker<Time>[] = showDots
        ? data.map((d) => ({
            time: d.time,
            position: 'inBar',
            shape: 'circle',
            color: d.value >= 0 ? COLOR_BUY : COLOR_SELL,
            size: 0.6,
          }))
        : [];
      markersRef.current.setMarkers(markers);
    }
    if (data.length > 0) chartRef.current?.timeScale().fitContent();

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
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          fontSize: 12,
          fontFamily: FONT_FAMILY,
          opacity: 0,
          transition: 'opacity 0.1s',
          fontFeatureSettings: '"tnum"',
          whiteSpace: 'nowrap',
          padding: '3px 10px',
          borderRadius: 4,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(2px)',
          zIndex: 10,
        }}
      />
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
