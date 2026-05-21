import { useEffect, useState, useCallback } from 'react';
import type { ChartRefs } from './types';
import type { Bar } from '../../../services/marketDataService';
import { getCandlePeriodSeconds } from '../barUtils';
import { useStore, type Timeframe } from '../../../store/useStore';

export interface ContextMenuState {
  x: number;
  y: number;
  candleTime: number;
  candleSeconds: number;
}

export interface TimeScaleMenuState {
  x: number;
  y: number;
}

/** Binary-search bars (sorted by time) for the one whose open time matches utcSeconds. */
function findBarByTime(bars: Bar[], utcSeconds: number): Bar | null {
  let lo = 0, hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = Math.floor(new Date(bars[mid].t).getTime() / 1000);
    if (t === utcSeconds) return bars[mid];
    if (t < utcSeconds) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

export function useChartContextMenu(
  refs: ChartRefs,
  timeframe: Timeframe,
): {
  menuState: ContextMenuState | null;
  closeMenu: () => void;
  timeScaleMenuState: TimeScaleMenuState | null;
  closeTimeScaleMenu: () => void;
} {
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);
  const [timeScaleMenuState, setTimeScaleMenuState] = useState<TimeScaleMenuState | null>(null);

  const closeMenu = useCallback(() => setMenuState(null), []);
  const closeTimeScaleMenu = useCallback(() => setTimeScaleMenuState(null), []);

  useEffect(() => {
    const container = refs.container.current;
    if (!container) return;

    function setCursorOnCanvases(cursor: string) {
      container!.querySelectorAll('canvas').forEach((c) => { c.style.cursor = cursor; });
    }

    /** Returns true if pointY (pane-local px) is within the candle's high–low range. */
    function isOverCandle(utcSeconds: number, pointY: number): boolean {
      const bar = findBarByTime(refs.bars.current, utcSeconds);
      if (!bar) return false;
      const series = refs.series.current;
      const highY = series?.priceToCoordinate(bar.h) ?? null;
      const lowY  = series?.priceToCoordinate(bar.l) ?? null;
      if (highY == null || lowY == null) return false;
      return pointY >= highY && pointY <= lowY;
    }

    function handleContextMenu(e: MouseEvent) {
      e.preventDefault();
      // Suppress chart menu while any drawing tool is active
      if (useStore.getState().activeTool !== 'select') return;
      const chart = refs.chart.current;
      if (!chart) return;

      // Check if click is on the time scale (last tr in the chart table)
      const timeScaleRow = chart.chartElement().querySelector('table tr:last-child');
      if (timeScaleRow && e.clientY >= timeScaleRow.getBoundingClientRect().top) {
        setMenuState(null);
        setTimeScaleMenuState({ x: e.clientX, y: timeScaleRow.getBoundingClientRect().top });
        return;
      }

      // Check if click is on the price scale (right column — last td when 2+ tds exist)
      const firstRow = chart.chartElement().querySelector('table tr:first-child');
      if (firstRow) {
        const cells = firstRow.querySelectorAll('td');
        if (cells.length >= 2) {
          const priceScaleCell = cells[cells.length - 1];
          if (e.clientX >= priceScaleCell.getBoundingClientRect().left) return;
        }
      }

      const rect = container!.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      // priceToCoordinate returns pane-relative Y; find the pane canvas top to match.
      // Falls back to container top if the canvas isn't found (single-pane charts always have it).
      const paneCanvas = chart.chartElement().querySelector('tr:first-child td:first-child canvas') as HTMLCanvasElement | null;
      const localY = e.clientY - (paneCanvas?.getBoundingClientRect().top ?? rect.top);
      const time = chart.timeScale().coordinateToTime(localX);
      if (time == null) return;

      const lastBar = refs.lastBar.current;
      if (lastBar && (time as number) > (lastBar.time as number)) return;

      // Only show menu when clicking directly on a candle (within high–low range)
      if (!isOverCandle(time as number, localY)) return;

      setTimeScaleMenuState(null);
      setMenuState({
        x: e.clientX,
        y: e.clientY,
        candleTime: time as number,
        candleSeconds: getCandlePeriodSeconds(timeframe),
      });
    }

    // Cursor hint via subscribeCrosshairMove (fires for every mouse move over the chart)
    const chart = refs.chart.current;
    let unsubCrosshair: (() => void) | null = null;
    if (chart) {
      const handler = (param: { time?: unknown; point?: { x: number; y: number } }) => {
        if (!param.time || !param.point) { setCursorOnCanvases(''); return; }
        setCursorOnCanvases(isOverCandle(param.time as number, param.point.y) ? 'pointer' : '');
      };
      chart.subscribeCrosshairMove(handler);
      unsubCrosshair = () => chart.unsubscribeCrosshairMove(handler);
    }

    container.addEventListener('contextmenu', handleContextMenu);
    return () => {
      container.removeEventListener('contextmenu', handleContextMenu);
      unsubCrosshair?.();
      setCursorOnCanvases('');
    };
  }, [refs, timeframe]);

  return { menuState, closeMenu, timeScaleMenuState, closeTimeScaleMenu };
}
