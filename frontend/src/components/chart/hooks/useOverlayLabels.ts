import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import type { ChartRefs } from './types';
import { buildPositionLabel } from './buildPositionLabel';
import { buildOrderLabels } from './buildOrderLabels';
import { buildPreviewLabels } from './buildPreviewLabels';

/**
 * Configures canvas primitive labels, registers hit targets,
 * and subscribes to price ticks for P&L updates.
 *
 * Orchestrator — delegates label building to 3 builder functions:
 *  1. buildPositionLabel — position P&L label + close button
 *  2. buildOrderLabels — open order labels (including Suspended bracket legs)
 *  3. buildPreviewLabels — preview ghost labels (entry, SL, TP)
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
    pendingBracketInfo, pnlMode,
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
    pendingBracketInfo: s.pendingBracketInfo,
    pnlMode: s.pnlMode,
  })));

  // -- Label configuration + hit-target registration --
  useEffect(() => {
    if (!isOrderChart) return;
    const overlay = refs.overlay.current;
    const series = refs.series.current;
    if (!overlay || !series) return;

    // Clear previous hit targets
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
        pendingBracketInfo, previewHideEntry, previewSide,
      );
      pnlUpdaters.push(...result.pnlUpdaters);
      orderLabelsCleanup = result.cleanup;
    }

    // 3. Preview labels
    if (contract) {
      pnlUpdaters.push(...buildPreviewLabels(refs, contract));
    }

    // --- Sync function: update P&L cells ---
    function updatePositions() {
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
      refs.hitTargets.current = [];
      refs.updateOverlay.current = () => {};
    };
  }, [isOrderChart, openOrders, positions, contract, activeAccountId, previewEnabled, previewSide, previewHideEntry,
    bracketPresets, activePresetId, orderType, limitPrice, orderSize,
    draftSlPoints, draftTpPoints, adHocSlPoints, adHocTpLevels, pendingBracketInfo, pnlMode]);

  // -- Wire up scheduleOverlaySync for the lastPrice subscription in the label-config effect --
  useEffect(() => {
    let syncRafId = 0;
    function scheduleSync() {
      if (syncRafId) return;
      syncRafId = requestAnimationFrame(() => {
        syncRafId = 0;
        refs.updateOverlay.current();
      });
    }
    refs.scheduleOverlaySync.current = scheduleSync;
    return () => { cancelAnimationFrame(syncRafId); };
  }, []);
}
