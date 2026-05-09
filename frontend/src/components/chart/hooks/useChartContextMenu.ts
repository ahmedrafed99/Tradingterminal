import { useEffect, useState, useCallback } from 'react';
import type { ChartRefs } from './types';
import { getCandlePeriodSeconds } from '../barUtils';
import type { Timeframe } from '../../../store/useStore';

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

    function handleContextMenu(e: MouseEvent) {
      e.preventDefault();
      const chart = refs.chart.current;
      if (!chart) return;

      // Check if click is on the time scale (last tr in the chart table)
      const timeScaleRow = chart.chartElement().querySelector('table tr:last-child');
      if (timeScaleRow && e.clientY >= timeScaleRow.getBoundingClientRect().top) {
        setMenuState(null);
        setTimeScaleMenuState({ x: e.clientX, y: e.clientY });
        return;
      }

      const rect = container!.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const time = chart.timeScale().coordinateToTime(localX);
      if (time == null) return;

      const lastBar = refs.lastBar.current;
      if (lastBar && (time as number) > (lastBar.time as number)) return;

      setTimeScaleMenuState(null);
      setMenuState({
        x: e.clientX,
        y: e.clientY,
        candleTime: time as number,
        candleSeconds: getCandlePeriodSeconds(timeframe),
      });
    }

    container.addEventListener('contextmenu', handleContextMenu);
    return () => container.removeEventListener('contextmenu', handleContextMenu);
  }, [refs, timeframe]);

  return { menuState, closeMenu, timeScaleMenuState, closeTimeScaleMenu };
}
