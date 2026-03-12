import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { OrderSide } from '../../../types/enums';
import { pointsToPrice } from '../../../utils/instrument';
import { PriceLevelLine } from '../PriceLevelLine';
import { resolvePreviewConfig } from './resolvePreviewConfig';
import type { ChartRefs } from './types';
import { COLOR_TEXT_MUTED } from '../../../constants/colors';
import { BUY_COLOR, SELL_COLOR } from './labelUtils';

/**
 * Manage preview overlay lines (entry + SL + TP ghost lines).
 * Effect 1: Create/destroy PriceLevelLine instances when structural config changes.
 * Effect 2: Update prices in-place via direct Zustand subscription (no React re-render).
 */
export function usePreviewLines(
  refs: ChartRefs,
  contract: Contract | null,
  isOrderChart: boolean,
): void {
  const previewEnabled = useStore((s) => s.previewEnabled);
  const previewSide = useStore((s) => s.previewSide);
  const previewHideEntry = useStore((s) => s.previewHideEntry);
  const orderType = useStore((s) => s.orderType);
  const limitPrice = useStore((s) => s.limitPrice);
  const bracketPresets = useStore((s) => s.bracketPresets);
  const activePresetId = useStore((s) => s.activePresetId);
  const draftSlPoints = useStore((s) => s.draftSlPoints);
  const draftTpPoints = useStore((s) => s.draftTpPoints);
  const orderSize = useStore((s) => s.orderSize);
  const adHocSlPoints = useStore((s) => s.adHocSlPoints);
  const adHocTpLevels = useStore((s) => s.adHocTpLevels);

  // Create / destroy lines when the structural config changes
  useEffect(() => {
    if (!isOrderChart) return;
    const series = refs.series.current;
    const overlay = refs.overlay.current;
    const chart = refs.chart.current;
    if (!series || !overlay || !chart) return;

    refs.previewLines.current.forEach((l) => l.destroy());
    refs.previewLines.current = [];
    refs.previewRoles.current = [];
    refs.previewPrices.current = [];

    if (!previewEnabled || !contract) return;

    const config = resolvePreviewConfig();
    const tickSize = contract.tickSize;
    const toPrice = (points: number) => pointsToPrice(points, contract);

    const snap = useStore.getState();
    const entry = snap.orderType === 'limit' ? snap.limitPrice : snap.lastPrice;
    const ep = entry ?? 0;

    // Entry line (always created — hidden when limit order already placed)
    const hideEntry = snap.previewHideEntry;
    refs.previewLines.current.push(new PriceLevelLine({
      price: ep,
      series, overlay, chartApi: chart,
      lineColor: hideEntry ? 'transparent' : COLOR_TEXT_MUTED,
      lineStyle: 'dashed', lineWidth: 1,
      axisLabelVisible: !hideEntry,
      tickSize,
    }));
    refs.previewRoles.current.push({ kind: 'entry' });
    refs.previewPrices.current.push(ep);

    if (config) {
      // SL line
      if (config.stopLoss.points > 0) {
        const slPts = config.stopLoss.points;
        const slPrice = ep ? (snap.previewSide === OrderSide.Buy ? ep - toPrice(slPts) : ep + toPrice(slPts)) : 0;
        refs.previewLines.current.push(new PriceLevelLine({
          price: slPrice,
          series, overlay, chartApi: chart,
          lineColor: SELL_COLOR, lineStyle: 'dashed', lineWidth: 1,
          axisLabelVisible: true, tickSize,
        }));
        refs.previewRoles.current.push({ kind: 'sl' });
        refs.previewPrices.current.push(slPrice);
      }

      // TP lines
      config.takeProfits.forEach((tp, i) => {
        const tpPts = tp.points;
        const tpPrice = ep ? (snap.previewSide === OrderSide.Buy ? ep + toPrice(tpPts) : ep - toPrice(tpPts)) : 0;
        refs.previewLines.current.push(new PriceLevelLine({
          price: tpPrice,
          series, overlay, chartApi: chart,
          lineColor: BUY_COLOR, lineStyle: 'dashed', lineWidth: 1,
          axisLabelVisible: true, tickSize,
        }));
        refs.previewRoles.current.push({ kind: 'tp', index: i });
        refs.previewPrices.current.push(tpPrice);
      });
    }

    return () => {
      refs.previewLines.current.forEach((l) => l.destroy());
      refs.previewLines.current = [];
      refs.previewRoles.current = [];
      refs.previewPrices.current = [];
    };
  }, [isOrderChart, previewEnabled, previewSide, previewHideEntry, bracketPresets, activePresetId, contract, adHocSlPoints, adHocTpLevels, orderSize]);

  // Update line prices in-place (no teardown → no flicker)
  // Uses direct Zustand subscription for lastPrice to avoid re-rendering on every tick
  useEffect(() => {
    if (!isOrderChart) return;
    if (!previewEnabled || !contract) return;
    if (refs.previewLines.current.length === 0) return;

    const toPrice = (points: number) => pointsToPrice(points, contract);

    function doUpdate() {
      // Skip while dragging a live order line — the drag handler manages
      // preview positions itself, and store.limitPrice is stale until mouseUp.
      if (refs.orderDragState.current) return;

      const snap = useStore.getState();
      const entryPrice = snap.orderType === 'limit' ? snap.limitPrice : snap.lastPrice;
      if (!entryPrice) return;

      const cfg = resolvePreviewConfig();
      const prices: number[] = [];
      let idx = 0;

      // Entry
      const entryLine = refs.previewLines.current[idx];
      if (entryLine) entryLine.setPrice(entryPrice);
      prices.push(entryPrice);
      idx++;

      if (cfg) {
        // SL
        if (cfg.stopLoss.points > 0) {
          const slPts = cfg.stopLoss.points;
          const slPrice = snap.previewSide === OrderSide.Buy ? entryPrice - toPrice(slPts) : entryPrice + toPrice(slPts);
          const slLine = refs.previewLines.current[idx];
          if (slLine) slLine.setPrice(slPrice);
          prices.push(slPrice);
          idx++;
        }

        // TPs
        cfg.takeProfits.forEach((tp) => {
          const tpPts = tp.points;
          const tpPrice = snap.previewSide === OrderSide.Buy ? entryPrice + toPrice(tpPts) : entryPrice - toPrice(tpPts);
          const tpLine = refs.previewLines.current[idx];
          if (tpLine) tpLine.setPrice(tpPrice);
          prices.push(tpPrice);
          idx++;
        });
      }

      refs.previewPrices.current = prices;
      refs.updateOverlay.current();
    }

    doUpdate();

    // Subscribe to lastPrice changes directly (bypasses React render cycle)
    let prevLp = useStore.getState().lastPrice;
    const unsub = useStore.subscribe((state) => {
      if (state.lastPrice !== prevLp) {
        prevLp = state.lastPrice;
        doUpdate();
      }
    });

    return () => { unsub(); };
  }, [isOrderChart, previewEnabled, previewSide, bracketPresets, activePresetId, contract, orderType, limitPrice, draftSlPoints, draftTpPoints, adHocSlPoints, adHocTpLevels]);
}
