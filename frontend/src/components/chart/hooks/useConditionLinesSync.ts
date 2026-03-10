import { useEffect } from 'react';
import type { PriceLevelLine } from '../PriceLevelLine';
import type { ChartRefs } from './types';
import { useStore } from '../../../store/useStore';
import type { PreviewState } from './conditionLineTypes';

/**
 * Effect 5: Keeps all condition lines (armed + preview) in sync with
 * scroll, zoom, resize, and last-price changes.
 */
export function useConditionLinesSync(
  refs: ChartRefs,
  linesRef: React.MutableRefObject<PriceLevelLine[]>,
  previewRef: React.MutableRefObject<PreviewState | null>,
): void {
  useEffect(() => {
    const chart = refs.chart.current;
    const container = refs.container.current;
    if (!chart || !container) return;

    function sync() {
      for (const line of linesRef.current) line.syncPosition();
      const p = previewRef.current;
      if (p) {
        p.condLine?.syncPosition();
        p.orderLine?.syncPosition();
        p.slLine?.syncPosition();
        for (const tp of p.tpLines) tp.line.syncPosition();
      }
    }

    chart.timeScale().subscribeVisibleLogicalRangeChange(sync);
    const ro = new ResizeObserver(sync);
    ro.observe(container);
    container.addEventListener('wheel', sync, { passive: true });

    let prevLp = useStore.getState().lastPrice;
    const unsub = useStore.subscribe((state) => {
      if (state.lastPrice !== prevLp) {
        prevLp = state.lastPrice;
        sync();
      }
    });

    let rafId = 0;
    function rafLoop() { sync(); rafId = requestAnimationFrame(rafLoop); }
    function onPointerDown() { cancelAnimationFrame(rafId); rafLoop(); }
    function onPointerUp() { cancelAnimationFrame(rafId); rafId = 0; }
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(sync);
      ro.disconnect();
      container.removeEventListener('wheel', sync);
      unsub();
      cancelAnimationFrame(rafId);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [refs, linesRef, previewRef]);
}
