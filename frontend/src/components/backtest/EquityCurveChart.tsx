import { useEffect, useRef, useImperativeHandle, forwardRef, memo } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, LineData, UTCTimestamp } from 'lightweight-charts';
import type { EquityPoint } from '../../services/backtestService';
import { CHART_OPTIONS } from '../chart/chartTheme';
import { FONT_FAMILY } from '../../constants/layout';

export interface EquityCurveHandle {
  /** Append a single point without triggering a React re-render. */
  addPoint: (point: EquityPoint) => void;
  /** Replace the full dataset. */
  setData: (points: EquityPoint[]) => void;
  /** Clear the chart. */
  clear: () => void;
}

interface Props {
  initialEquity: number;
  isEmpty?: boolean;
}

function toLinePoint(p: EquityPoint): LineData<UTCTimestamp> {
  return {
    time: Math.floor(new Date(p.t).getTime() / 1000) as UTCTimestamp,
    value: p.equity,
  };
}

export const EquityCurveChart = memo(forwardRef<EquityCurveHandle, Props>(
  function EquityCurveChart({ initialEquity, isEmpty }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef     = useRef<IChartApi | null>(null);
    const seriesRef    = useRef<ISeriesApi<'Line'> | null>(null);
    const bufRef       = useRef<LineData<UTCTimestamp>[]>([]);
    const disposedRef  = useRef(false);

    useImperativeHandle(ref, () => ({
      addPoint(point) {
        if (!seriesRef.current || disposedRef.current) return;
        const lp = toLinePoint(point);
        bufRef.current.push(lp);
        seriesRef.current.update(lp);
        chartRef.current?.timeScale().fitContent();
        const color = lp.value >= initialEquity ? '#22c55e' : '#ef4444';
        seriesRef.current.applyOptions({ color });
      },
      setData(points) {
        if (!seriesRef.current || disposedRef.current) return;
        const data = points.map(toLinePoint);
        bufRef.current = data;
        seriesRef.current.setData(data);
        if (data.length > 0) {
          const last = data[data.length - 1].value as number;
          seriesRef.current.applyOptions({ color: last >= initialEquity ? '#22c55e' : '#ef4444' });
        }
        chartRef.current?.timeScale().fitContent();
      },
      clear() {
        if (!seriesRef.current || disposedRef.current) return;
        bufRef.current = [];
        seriesRef.current.setData([]);
        seriesRef.current.applyOptions({ color: '#22c55e' });
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;
      disposedRef.current = false;

      const chart = createChart(containerRef.current, {
        ...CHART_OPTIONS,
        height: 180,
        crosshair: {
          ...CHART_OPTIONS.crosshair,
          horzLine: { ...CHART_OPTIONS.crosshair?.horzLine, labelVisible: true },
        },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
        localization: { priceFormatter: (v: number) => `$${v.toFixed(2)}` },
      });

      const series = chart.addSeries(LineSeries, {
        color: '#22c55e',
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: false,
        crosshairMarkerVisible: true,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });

      chartRef.current = chart;
      seriesRef.current = series;

      // Restore buffered data on remount
      if (bufRef.current.length > 0) {
        series.setData(bufRef.current);
        chart.timeScale().fitContent();
      }

      return () => {
        disposedRef.current = true;
        chartRef.current = null;
        seriesRef.current = null;
        try { chart.remove(); } catch { /* already disposed */ }
      };
    }, []);

    return (
      // Always render the container so the chart can attach — overlay the empty state on top
      <div style={{ position: 'relative', height: 180 }}>
        <div ref={containerRef} className="w-full" style={{ height: 180 }} />
        {isEmpty && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ color: 'var(--color-text-muted)', fontSize: 12, fontFamily: FONT_FAMILY }}
          >
            Run a strategy to see the equity curve
          </div>
        )}
      </div>
    );
  }
));
