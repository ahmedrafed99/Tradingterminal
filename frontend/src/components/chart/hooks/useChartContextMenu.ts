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

export function useChartContextMenu(
  refs: ChartRefs,
  timeframe: Timeframe,
): { menuState: ContextMenuState | null; closeMenu: () => void } {
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);

  const closeMenu = useCallback(() => setMenuState(null), []);

  useEffect(() => {
    const container = refs.container.current;
    if (!container) return;

    function handleContextMenu(e: MouseEvent) {
      e.preventDefault();
      const chart = refs.chart.current;
      if (!chart) return;

      const rect = container!.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const time = chart.timeScale().coordinateToTime(localX);
      if (time == null) return;

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

  return { menuState, closeMenu };
}
