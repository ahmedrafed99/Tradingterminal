import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import type { ChartRefs } from './types';
import { buildPositionLabel } from './buildPositionLabel';
import { buildOrderLabels } from './buildOrderLabels';
import { buildPreviewLabels } from './buildPreviewLabels';
import { buildQoPendingLabels } from './buildQoPendingLabels';

/**
 * Configures labels on PriceLevelLine instances, registers hit targets,
 * and runs the sync loop (scroll/zoom/resize/tick repositioning).
 *
 * Orchestrator — delegates label building to 4 builder functions:
 *  1. buildPositionLabel — position P&L label + close button
 *  2. buildOrderLabels — open order labels with TP size +/- buttons
 *  3. buildPreviewLabels — preview ghost labels (entry, SL, TP)
 *  4. buildQoPendingLabels — quick-order pending bracket labels
 */
export function useOverlayLabels(
  refs: ChartRefs,
  contract: Contract | null,
  isOrderChart: boolean,
): void {
  // Single shallow-compared selector — one subscription instead of 16
  const {
    openOrders, positions, activeAccountId,
    previewEnabled, previewSide, previewHideEntry,
    bracketPresets, activePresetId,
    orderType, limitPrice, orderSize,
    draftSlPoints, draftTpPoints, adHocSlPoints, adHocTpLevels,
    qoPendingPreview,
  } = useStore(useShallow((s) => ({
    openOrders: s.openOrders,
    positions: s.positions,
    activeAccountId: s.activeAccountId,
    previewEnabled: s.previewEnabled,
    previewSide: s.previewSide,
    previewHideEntry: s.previewHideEntry,
    bracketPresets: s.bracketPresets,
    activePresetId: s.activePresetId,
    orderType: s.orderType,
    limitPrice: s.limitPrice,
    orderSize: s.orderSize,
    draftSlPoints: s.draftSlPoints,
    draftTpPoints: s.draftTpPoints,
    adHocSlPoints: s.adHocSlPoints,
    adHocTpLevels: s.adHocTpLevels,
    qoPendingPreview: s.qoPendingPreview,
  })));

  // -- Label configuration + hit-target registration --
  useEffect(() => {
    if (!isOrderChart) return;
    const overlay = refs.overlay.current;
    const series = refs.series.current;
    if (!overlay || !series) return;

    // Clear previous labels + hit targets
    for (const line of refs.previewLines.current) line.setLabel(null);
    for (const line of refs.orderLines.current) line.setLabel(null);
    if (qoPendingPreview) {
      const qoPrev = refs.qoPreviewLines.current;
      if (qoPrev.sl) qoPrev.sl.setLabel(null);
      for (const tp of qoPrev.tps) if (tp) tp.setLabel(null);
    }
    refs.hitTargets.current = [];

    const pnlUpdaters: (() => void)[] = [];
    let orderLabelsCleanup: (() => void) | undefined;

    // 1. Position label
    if (contract) {
      pnlUpdaters.push(...buildPositionLabel(refs, contract, positions, activeAccountId));
    }

    // 2. Order labels
    if (contract) {
      const result = buildOrderLabels(
        refs, contract, openOrders, positions, activeAccountId,
        qoPendingPreview, previewHideEntry, previewSide,
      );
      pnlUpdaters.push(...result.pnlUpdaters);
      orderLabelsCleanup = result.cleanup;
    }

    // 3. Preview labels
    if (contract) {
      pnlUpdaters.push(...buildPreviewLabels(refs, contract));
    }

    // 4. Quick-order pending preview labels
    if (qoPendingPreview && contract) {
      pnlUpdaters.push(...buildQoPendingLabels(refs, contract, qoPendingPreview));
    }

    // --- Sync function (repositions all lines + updates P&L) ---
    function updatePositions() {
      for (const line of refs.previewLines.current) line.syncPosition();
      for (const line of refs.orderLines.current) line.syncPosition();
      const qoLines = refs.qoPreviewLines.current;
      if (qoLines.sl) qoLines.sl.syncPosition();
      for (const tp of qoLines.tps) if (tp) tp.syncPosition();
      if (refs.posDragLine.current) refs.posDragLine.current.syncPosition();

      if (refs.posDragLabel.current && refs.posDrag.current && refs.series.current) {
        const y = refs.series.current.priceToCoordinate(refs.posDrag.current.snappedPrice);
        if (y !== null) {
          refs.posDragLabel.current.style.top = `${y}px`;
          refs.posDragLabel.current.style.display = 'flex';
        } else {
          refs.posDragLabel.current.style.display = 'none';
        }
      }

      for (const updater of pnlUpdaters) updater();
    }

    updatePositions();
    refs.updateOverlay.current = updatePositions;

    // Subscribe to lastPrice changes — routes through scheduleOverlaySync ref
    // so it coalesces with scroll/drag/resize into a single RAF per frame
    let prevLp = useStore.getState().lastPrice;
    const unsub = useStore.subscribe((state) => {
      if (state.lastPrice !== prevLp) {
        prevLp = state.lastPrice;
        refs.scheduleOverlaySync.current();
      }
    });

    return () => {
      unsub();
      orderLabelsCleanup?.();
      for (const line of refs.previewLines.current) line.setLabel(null);
      for (const line of refs.orderLines.current) line.setLabel(null);
      if (qoPendingPreview) {
        const qoClean = refs.qoPreviewLines.current;
        if (qoClean.sl) qoClean.sl.setLabel(null);
        for (const tp of qoClean.tps) if (tp) tp.setLabel(null);
      }
      refs.hitTargets.current = [];
      refs.updateOverlay.current = () => {};
    };
  }, [isOrderChart, openOrders, positions, contract, activeAccountId, previewEnabled, previewSide, previewHideEntry,
    bracketPresets, activePresetId, orderType, limitPrice, orderSize,
    draftSlPoints, draftTpPoints, adHocSlPoints, adHocTpLevels, qoPendingPreview]);

  // -- Sync overlay positions on chart scroll/zoom/resize/price-scale-drag --
  useEffect(() => {
    const chart = refs.chart.current;
    const container = refs.container.current;
    if (!chart || !container) return;

    const handler = () => refs.updateOverlay.current();

    // Coalescing flag — all triggers (scroll, resize, wheel, drag, price tick)
    // funnel through scheduleSync so at most one handler() runs per frame.
    let syncRafId = 0;
    function scheduleSync() {
      if (syncRafId) return;
      syncRafId = requestAnimationFrame(() => {
        syncRafId = 0;
        handler();
      });
    }

    // Expose to the price-tick subscription in the label-config effect
    refs.scheduleOverlaySync.current = scheduleSync;

    // visibleLogicalRangeChange fires synchronously during pan — defer to RAF
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleSync);

    const ro = new ResizeObserver(scheduleSync);
    ro.observe(container);

    // During drag, schedule sync on mousemove (coalesced via scheduleSync)
    function onDragMove() { scheduleSync(); }
    function onPointerDown() {
      handler(); // immediate first sync
      window.addEventListener('mousemove', onDragMove);
    }
    function onPointerUp() {
      window.removeEventListener('mousemove', onDragMove);
      scheduleSync(); // final sync
    }
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    container.addEventListener('wheel', scheduleSync, { passive: true });

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleSync);
      ro.disconnect();
      cancelAnimationFrame(syncRafId);
      window.removeEventListener('mousemove', onDragMove);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('wheel', scheduleSync);
    };
  }, []);
}
