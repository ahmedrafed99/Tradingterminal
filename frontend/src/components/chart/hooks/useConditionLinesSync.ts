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

    // Coalescing flag — ensures at most one sync() per frame across all triggers
    let syncRafId = 0;
    function scheduleSync() {
      if (syncRafId) return;
      syncRafId = requestAnimationFrame(() => {
        syncRafId = 0;
        sync();
      });
    }

    // visibleLogicalRangeChange fires synchronously during pan — defer to RAF
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleSync);
    const ro = new ResizeObserver(scheduleSync);
    ro.observe(container);
    container.addEventListener('wheel', scheduleSync, { passive: true });

    // lastPrice subscription — coalesced into the same RAF
    let prevLp = useStore.getState().lastPrice;
    const unsub = useStore.subscribe((state) => {
      if (state.lastPrice !== prevLp) {
        prevLp = state.lastPrice;
        scheduleSync();
      }
    });

    // During drag, schedule sync on mousemove (RAF-throttled via scheduleSync)
    // instead of a continuous RAF loop that runs even when nothing changes
    function onDragMove() { scheduleSync(); }
    function onPointerDown() {
      sync(); // immediate first sync
      window.addEventListener('mousemove', onDragMove);
    }
    function onPointerUp() {
      window.removeEventListener('mousemove', onDragMove);
      scheduleSync(); // final sync
    }
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleSync);
      ro.disconnect();
      container.removeEventListener('wheel', scheduleSync);
      unsub();
      cancelAnimationFrame(syncRafId);
      window.removeEventListener('mousemove', onDragMove);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [refs, linesRef, previewRef]);
}
