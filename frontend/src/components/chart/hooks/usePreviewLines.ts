import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { OrderSide, OrderStatus, OrderType } from '../../../types/enums';
import { pointsToPrice, priceToPoints, getTicksPerPoint } from '../../../utils/instrument';
import { PriceLevelPrimitive } from '../primitives/PriceLevelPrimitive';
import { bracketEngine } from '../../../services/bracketEngine';
import { orderService } from '../../../services/orderService';
import { resolvePreviewConfig } from './resolvePreviewConfig';
import type { ChartRefs } from './types';
import { COLOR_TEXT_MUTED } from '../../../constants/colors';
import { BUY_COLOR, SELL_COLOR } from './labelUtils';

/**
 * Manage preview overlay lines (entry + SL + TP ghost lines).
 * Effect 1: Create/destroy PriceLevelPrimitive instances when structural config changes.
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
  // Structural shape for Effect 1 — only re-create lines when SL is added/removed
  // or TP count changes, NOT when values change during drag (which would kill mid-drag)
  const adHocSlExists = useStore((s) => s.adHocSlPoints != null);
  const adHocTpCount = useStore((s) => s.adHocTpLevels.length);

  // Create / destroy lines when the structural config changes
  useEffect(() => {
    if (!isOrderChart) return;
    const series = refs.series.current;
    const container = refs.container.current;
    if (!series || !container) return;

    refs.previewLines.current.forEach((l) => series.detachPrimitive(l));
    refs.previewLines.current = [];
    refs.previewRoles.current = [];
    refs.previewPrices.current = [];

    if ((!previewEnabled && !previewHideEntry) || !contract) return;

    const config = resolvePreviewConfig();
    const ts = contract.tickSize;
    const toPrice = (points: number) => pointsToPrice(points, contract);

    const snap = useStore.getState();
    const entry = snap.orderType === 'limit' ? snap.limitPrice : snap.lastPrice;
    const ep = entry ?? 0;
    const hideEntry = snap.previewHideEntry;

    // ── Entry line ────────────────────────────────────────────────────────────
    const entryPrimitive = new PriceLevelPrimitive({
      price: ep,
      cellOrder: [],
      cells: {},
      labelPosition: 'right',
      lineColor: hideEntry ? 'transparent' : COLOR_TEXT_MUTED,
      lineStyle: 'dashed',
      lineWidth: 1,
      priceLabel: { visible: !hideEntry, tickSize: ts },
      allowPriceMove: true,
      onDrag: (rawPrice: number) => {
        const snapped = Math.round(rawPrice / ts) * ts;
        entryPrimitive.setPrice(snapped);
        refs.previewPrices.current[0] = snapped;
        const st = useStore.getState();
        st.setOrderType('limit');
        st.setLimitPrice(snapped);
        // Move sibling SL/TP lines synchronously so P&L updates batch in one frame
        const cfg = resolvePreviewConfig();
        const side = st.previewSide;
        let idx = 1;
        if (cfg) {
          if (cfg.stopLoss.points > 0) {
            const slPrice = side === OrderSide.Buy
              ? snapped - toPrice(cfg.stopLoss.points)
              : snapped + toPrice(cfg.stopLoss.points);
            const slLine = refs.previewLines.current[idx];
            if (slLine) slLine.setPrice(slPrice);
            refs.previewPrices.current[idx] = slPrice;
            idx++;
          }
          cfg.takeProfits.forEach((tp) => {
            const tpPrice = side === OrderSide.Buy
              ? snapped + toPrice(tp.points)
              : snapped - toPrice(tp.points);
            const tpLine = refs.previewLines.current[idx];
            if (tpLine) tpLine.setPrice(tpPrice);
            refs.previewPrices.current[idx] = tpPrice;
            idx++;
          });
        }
        refs.updateOverlay.current();
      },
    });
    series.attachPrimitive(entryPrimitive);
    entryPrimitive.setChartElement(container);
    refs.previewLines.current.push(entryPrimitive);
    refs.previewRoles.current.push({ kind: 'entry' });
    refs.previewPrices.current.push(ep);

    if (config) {
      // ── SL line ─────────────────────────────────────────────────────────────
      if (config.stopLoss.points > 0) {
        const slPts = config.stopLoss.points;
        const slPrice = ep
          ? (snap.previewSide === OrderSide.Buy ? ep - toPrice(slPts) : ep + toPrice(slPts))
          : 0;
        const slIdx = refs.previewLines.current.length;
        const slPrimitive = new PriceLevelPrimitive({
          price: slPrice,
          cellOrder: [],
          cells: {},
          labelPosition: 'mid',
          lineColor: SELL_COLOR,
          lineStyle: 'dashed',
          lineWidth: 1,
          priceLabel: { visible: true, tickSize: ts },
          allowPriceMove: true,
          onDrag: (rawPrice: number) => {
            const snapped = Math.round(rawPrice / ts) * ts;
            slPrimitive.setPrice(snapped);
            refs.previewPrices.current[slIdx] = snapped;
            const st = useStore.getState();
            const entryPrice = st.orderType === 'limit' ? st.limitPrice : st.lastPrice;
            if (entryPrice) {
              const pts = priceToPoints(Math.abs(entryPrice - snapped), contract);
              const tpp = getTicksPerPoint(contract);
              const rounded = Math.max(1 / tpp, Math.round(pts * tpp) / tpp);
              const hasPreset = st.bracketPresets.some((p) => p.id === st.activePresetId);
              if (hasPreset) st.setDraftSlPoints(rounded);
              else st.setAdHocSlPoints(rounded);
            }
            refs.updateOverlay.current();
          },
          onDragEnd: (newPrice: number) => {
            const snapped = Math.round(newPrice / ts) * ts;
            const st = useStore.getState();
            if (!st.previewHideEntry) return;
            bracketEngine.updateArmedConfig((cfg) => ({
              ...cfg,
              stopLoss: st.draftSlPoints != null
                ? { ...cfg.stopLoss, points: st.draftSlPoints }
                : cfg.stopLoss,
            }));
            const bi = st.pendingBracketInfo;
            if (bi) {
              // Sync the matching Suspended SL order so it stays price-matched
              // after pendingBracketInfo updates, preventing a ghost at the old price.
              if (bi.slPrice != null) {
                const ts2 = contract.tickSize;
                const suspendedSl = st.openOrders.find(
                  (o) => o.status === OrderStatus.Suspended &&
                    String(o.contractId) === String(contract.id) &&
                    (o.type === OrderType.Stop || o.type === OrderType.TrailingStop) &&
                    Math.round((o.stopPrice ?? 0) / ts2) === Math.round(bi.slPrice! / ts2),
                );
                if (suspendedSl) {
                  st.upsertOrder({ ...suspendedSl, stopPrice: snapped });
                  const acct = st.activeAccountId;
                  if (acct) orderService.modifyOrder({ accountId: acct, orderId: suspendedSl.id, stopPrice: snapped }).catch(() => {});
                }
              }
              st.setPendingBracketInfo({ ...bi, slPrice: snapped });
            }
          },
        });
        series.attachPrimitive(slPrimitive);
        slPrimitive.setChartElement(container);
        refs.previewLines.current.push(slPrimitive);
        refs.previewRoles.current.push({ kind: 'sl' });
        refs.previewPrices.current.push(slPrice);
      }

      // ── TP lines ─────────────────────────────────────────────────────────────
      config.takeProfits.forEach((tp, i) => {
        const tpPts = tp.points;
        const tpPrice = ep
          ? (snap.previewSide === OrderSide.Buy ? ep + toPrice(tpPts) : ep - toPrice(tpPts))
          : 0;
        const tpIdx = refs.previewLines.current.length;
        const tpPrimitive = new PriceLevelPrimitive({
          price: tpPrice,
          cellOrder: [],
          cells: {},
          labelPosition: 'mid',
          lineColor: BUY_COLOR,
          lineStyle: 'dashed',
          lineWidth: 1,
          priceLabel: { visible: true, tickSize: ts },
          allowPriceMove: true,
          onDrag: (rawPrice: number) => {
            const snapped = Math.round(rawPrice / ts) * ts;
            tpPrimitive.setPrice(snapped);
            refs.previewPrices.current[tpIdx] = snapped;
            const st = useStore.getState();
            const entryPrice = st.orderType === 'limit' ? st.limitPrice : st.lastPrice;
            if (entryPrice) {
              const pts = priceToPoints(Math.abs(entryPrice - snapped), contract);
              const tpp = getTicksPerPoint(contract);
              const rounded = Math.max(1 / tpp, Math.round(pts * tpp) / tpp);
              const hasPreset = st.bracketPresets.some((p) => p.id === st.activePresetId);
              if (hasPreset) st.setDraftTpPoints(i, rounded);
              else st.updateAdHocTpPoints(i, rounded);
            }
            refs.updateOverlay.current();
          },
          onDragEnd: (newPrice: number) => {
            const snapped = Math.round(newPrice / ts) * ts;
            const st = useStore.getState();
            if (!st.previewHideEntry) return;
            bracketEngine.updateArmedConfig((cfg) => ({
              ...cfg,
              takeProfits: cfg.takeProfits.map((tpCfg, cfgIdx) => {
                const draft = st.draftTpPoints[cfgIdx];
                return draft != null ? { ...tpCfg, points: draft } : tpCfg;
              }),
            }));
            const bi = st.pendingBracketInfo;
            if (bi) {
              // Sync the matching Suspended TP order so it stays price-matched
              // after pendingBracketInfo updates, preventing a ghost at the old price.
              const oldTpPrice = bi.tpPrices[i];
              if (oldTpPrice != null) {
                const ts2 = contract.tickSize;
                const suspendedTp = st.openOrders.find(
                  (o) => o.status === OrderStatus.Suspended &&
                    String(o.contractId) === String(contract.id) &&
                    o.type === OrderType.Limit &&
                    Math.round((o.limitPrice ?? 0) / ts2) === Math.round(oldTpPrice / ts2),
                );
                if (suspendedTp) {
                  st.upsertOrder({ ...suspendedTp, limitPrice: snapped });
                  const acct = st.activeAccountId;
                  if (acct) orderService.modifyOrder({ accountId: acct, orderId: suspendedTp.id, limitPrice: snapped }).catch(() => {});
                }
              }
              const newTpPrices = [...bi.tpPrices];
              newTpPrices[i] = snapped;
              st.setPendingBracketInfo({ ...bi, tpPrices: newTpPrices });
            }
          },
        });
        series.attachPrimitive(tpPrimitive);
        tpPrimitive.setChartElement(container);
        refs.previewLines.current.push(tpPrimitive);
        refs.previewRoles.current.push({ kind: 'tp', index: i });
        refs.previewPrices.current.push(tpPrice);
      });
    }

    return () => {
      refs.previewLines.current.forEach((l) => series.detachPrimitive(l));
      refs.previewLines.current = [];
      refs.previewRoles.current = [];
      refs.previewPrices.current = [];
    };
  }, [isOrderChart, previewEnabled, previewSide, previewHideEntry, bracketPresets, activePresetId, contract, adHocSlExists, adHocTpCount, orderSize]);

  // Update line prices in-place (no teardown → no flicker)
  // Uses direct Zustand subscription for lastPrice to avoid re-rendering on every tick
  useEffect(() => {
    if (!isOrderChart) return;
    if ((!previewEnabled && !previewHideEntry) || !contract) return;
    if (refs.previewLines.current.length === 0) return;

    const toPrice = (points: number) => pointsToPrice(points, contract);

    function doUpdate() {
      // Skip while an order line is being dragged
      if (refs.isDragging.current) return;

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
          const slPrice = snap.previewSide === OrderSide.Buy
            ? entryPrice - toPrice(slPts)
            : entryPrice + toPrice(slPts);
          const slLine = refs.previewLines.current[idx];
          if (slLine) slLine.setPrice(slPrice);
          prices.push(slPrice);
          idx++;
        }

        // TPs
        cfg.takeProfits.forEach((tp) => {
          const tpPts = tp.points;
          const tpPrice = snap.previewSide === OrderSide.Buy
            ? entryPrice + toPrice(tpPts)
            : entryPrice - toPrice(tpPts);
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

    let prevLp = useStore.getState().lastPrice;
    const unsub = useStore.subscribe((state) => {
      if (state.lastPrice !== prevLp) {
        prevLp = state.lastPrice;
        doUpdate();
      }
    });

    return () => { unsub(); };
  }, [isOrderChart, previewEnabled, previewHideEntry, previewSide, bracketPresets, activePresetId, contract, orderType, limitPrice, draftSlPoints, draftTpPoints, adHocSlPoints, adHocTpLevels]);
}
