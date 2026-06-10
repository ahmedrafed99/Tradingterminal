import { useEffect } from 'react';
import type { MouseEventParams } from 'lightweight-charts';
import type { ChartRefs } from './types';

export function useChartInteraction(refs: ChartRefs): void {
  // -- Candlestick double-click: open chart settings popover --
  useEffect(() => {
    const container = refs.container.current;
    const chart = refs.chart.current;
    if (!container || !chart) return;

    // Track last crosshair position so the dblclick handler knows if we're over a candle
    let lastCrosshairTime: number | null = null;
    let lastCrosshairY: number | null = null;
    const onCrosshairMove = (param: MouseEventParams) => {
      lastCrosshairTime = param.time != null ? (param.time as number) : null;
      lastCrosshairY    = param.point?.y ?? null;
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    function isOverCandle(utcSeconds: number, pointY: number): boolean {
      const bar = refs.bars.current.find(b => Math.floor(new Date(b.t).getTime() / 1000) === utcSeconds) ?? null;
      if (!bar) return false;
      const highY = refs.series.current?.priceToCoordinate(bar.h) ?? null;
      const lowY  = refs.series.current?.priceToCoordinate(bar.l) ?? null;
      if (highY == null || lowY == null) return false;
      return pointY >= highY && pointY <= lowY;
    }

    function onDblClick(e: MouseEvent) {
      // Only fire when the crosshair is over an actual candle body/wick
      if (lastCrosshairTime == null || lastCrosshairY == null) return;
      if (!isOverCandle(lastCrosshairTime, lastCrosshairY)) return;

      // If hovering a market depth bar, let that handler take priority
      const vp = refs.domPrimitive.current;
      if (vp && vp.isHoveringBar(e.offsetX, container.clientWidth)) return;

      window.dispatchEvent(new CustomEvent('open-chart-settings'));
    }

    container.addEventListener('dblclick', onDblClick);
    return () => {
      container.removeEventListener('dblclick', onDblClick);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
