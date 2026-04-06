import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { orderService } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { useStore } from '../../../store/useStore';
import { OrderType, OrderSide, PositionType, OrderStatus } from '../../../types/enums';
import { pointsToPrice, priceToPoints, getTicksPerPoint } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import { resolvePreviewConfig } from './resolvePreviewConfig';
import { computeOrderLineColor, BUY_COLOR, SELL_COLOR } from './labelUtils';
import type { ChartRefs } from './types';
import { CROSSHAIR_CURSOR } from './drawingInteraction';

/**
 * Handle drag interaction for live order lines.
 * Dragging modifies the order price via orderService.modifyOrder().
 * Also shifts Suspended bracket legs and hidden-entry preview lines to follow.
 */
export function useOrderDrag(
  refs: ChartRefs,
  contract: Contract | null,
  isOrderChart: boolean,
): void {
  const positions = useStore((s) => s.positions);
  const activeAccountId = useStore((s) => s.activeAccountId);

  useEffect(() => {
    if (!isOrderChart) return;
    const container = refs.container.current;
    if (!container || !contract) return;

    let cachedRect: DOMRect | null = null;

    function snapPrice(price: number): number {
      const ts = contract!.tickSize;
      return Math.round(price / ts) * ts;
    }

    /** Find all order line indices for Suspended bracket legs of the current contract. */
    function findSuspendedBracketIndices(): number[] {
      const indices: number[] = [];
      for (let k = 0; k < refs.orderLineMeta.current.length; k++) {
        const m = refs.orderLineMeta.current[k];
        if (m.kind === 'order' && m.order.status === OrderStatus.Suspended
            && String(m.order.contractId) === String(contract!.id)) {
          indices.push(k);
        }
      }
      return indices;
    }

    function onMouseMove(e: MouseEvent) {
      const drag = refs.orderDragState.current;
      if (!drag) return;

      // Don't stopPropagation — let LWC see the event so crosshair stays visible
      e.preventDefault();

      if (!cachedRect) cachedRect = container!.getBoundingClientRect();
      const mouseY = e.clientY - cachedRect.top;
      const series = refs.series.current;
      if (!series) return;
      const rawPrice = series.coordinateToPrice(mouseY);
      if (rawPrice === null) return;
      const snapped = snapPrice(rawPrice as number);

      // Update line price + color based on profit/loss relative to position
      const pos = positions.find(
        (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract!.id) && p.size > 0,
      );
      const line = refs.orderLines.current[drag.idx];
      if (line) {
        line.setPrice(snapped);
        if (pos) {
          const isL = pos.type === PositionType.Long;
          line.setLineColor((isL ? snapped >= pos.averagePrice : snapped <= pos.averagePrice) ? BUY_COLOR : SELL_COLOR);
        }
        line.syncPosition();
      }
      refs.orderLinePrices.current[drag.idx] = snapped;
      drag.draggedPrice = snapped;

      // Shift Suspended bracket legs to follow the dragged entry order
      if (drag.meta.kind === 'order' && drag.meta.order.type === OrderType.Limit
          && drag.meta.order.status !== OrderStatus.Suspended) {
        const delta = snapped - drag.originalPrice;
        const st = useStore.getState();

        // Shift Suspended bracket order lines
        const bi = st.pendingBracketInfo;
        if (bi) {
          const bracketIndices = findSuspendedBracketIndices();
          for (const idx of bracketIndices) {
            const origPrice = refs.orderLinePrices.current[idx];
            // Compute delta from the original entry price to maintain relative offsets
            const bracketLine = refs.orderLines.current[idx];
            if (bracketLine) {
              const m = refs.orderLineMeta.current[idx];
              if (m.kind !== 'order') continue;
              const origBracketPrice = m.order.stopPrice ?? m.order.limitPrice ?? 0;
              const newBracketPrice = origBracketPrice + delta;
              bracketLine.setPrice(newBracketPrice);
              bracketLine.syncPosition();
              refs.orderLinePrices.current[idx] = newBracketPrice;
            }
          }
        }

        // Shift preview lines with hidden entry (Buy/Sell button flow)
        if (st.previewHideEntry) {
          refs.previewPrices.current[0] = snapped;
          const toP = (points: number) => pointsToPrice(points, contract!);
          const cfg = resolvePreviewConfig();
          const pvSide = st.previewSide;
          let idx = 1; // skip entry line (index 0)
          if (cfg) {
            if (cfg.stopLoss.points > 0) {
              const slPrice = pvSide === OrderSide.Buy ? snapped - toP(cfg.stopLoss.points) : snapped + toP(cfg.stopLoss.points);
              const slLine = refs.previewLines.current[idx];
              if (slLine) { slLine.setPrice(slPrice); slLine.syncPosition(); }
              refs.previewPrices.current[idx] = slPrice;
              idx++;
            }
            cfg.takeProfits.forEach((tp) => {
              const tpPrice = pvSide === OrderSide.Buy ? snapped + toP(tp.points) : snapped - toP(tp.points);
              const tpLine = refs.previewLines.current[idx];
              if (tpLine) { tpLine.setPrice(tpPrice); tpLine.syncPosition(); }
              refs.previewPrices.current[idx] = tpPrice;
              idx++;
            });
          }
        }
      }

      refs.scheduleOverlaySync.current();
    }

    function onMouseUp() {
      const drag = refs.orderDragState.current;
      if (!drag) return;

      cachedRect = null;
      const { meta, originalPrice, draggedPrice: newPrice } = drag;
      refs.orderDragState.current = null;
      if (refs.activeDragRow.current) {
        refs.activeDragRow.current.style.cursor = 'pointer';
        refs.activeDragRow.current = null;
      }
      if (refs.container.current) refs.container.current.style.cursor = CROSSHAIR_CURSOR;
      // Re-enable LWC scroll/scale after drag
      if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: true, handleScale: true });

      if (meta.kind !== 'order' || newPrice === originalPrice) return;

      const { order } = meta;
      const dragIdx = drag.idx;
      const accountId = useStore.getState().activeAccountId;
      if (!accountId) return;

      // Front-end validation: SL must stay on the correct side of current price
      if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
        const currentPrice = useStore.getState().lastPrice ?? refs.lastBar.current?.close ?? null;
        if (currentPrice != null) {
          const protectsLong = order.side === OrderSide.Sell;
          const invalid = protectsLong ? newPrice >= currentPrice : newPrice <= currentPrice;
          if (invalid) {
            // Stop dragged past market — close the position instead
            showToast('info', 'Stop above market — closing position');
            const line = refs.orderLines.current[dragIdx];
            if (line) {
              line.setPrice(originalPrice);
              line.setLineColor(SELL_COLOR);
              line.syncPosition();
              refs.orderLinePrices.current[dragIdx] = originalPrice;
              refs.updateOverlay.current();
            }
            const posToClose = useStore.getState().positions.find(
              (p) => p.accountId === accountId && String(p.contractId) === String(contract!.id) && p.size > 0,
            );
            if (posToClose) {
              orderService.placeOrder({
                accountId,
                contractId: contract!.id,
                type: OrderType.Market,
                side: protectsLong ? OrderSide.Sell : OrderSide.Buy,
                size: posToClose.size,
              }).catch((err) => {
                showToast('error', 'Close position failed', errorMessage(err));
              });
            }
            return;
          }
        }
      }

      const params: { accountId: string; orderId: string; stopPrice?: number; limitPrice?: number } = {
        accountId,
        orderId: order.id,
      };

      if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
        params.stopPrice = newPrice;
      } else if (order.type === OrderType.Limit) {
        params.limitPrice = newPrice;
      }

      // Optimistically commit bracket preview positions to store.
      // When previewHideEntry is active, skip setPendingBracketInfo — preview lines
      // handle the visual via setLimitPrice, and calling setPendingBracketInfo would
      // trigger useOrderLines to rebuild all lines from openOrders (stale server
      // prices), causing the entry line to briefly snap back to its original price.
      const isEntry = order.type === OrderType.Limit && order.status !== OrderStatus.Suspended;
      const wasHideEntry = isEntry && useStore.getState().previewHideEntry;
      const prevBi = isEntry && !wasHideEntry
        ? useStore.getState().pendingBracketInfo : null;
      if (prevBi) {
        const d = newPrice - originalPrice;
        useStore.getState().setPendingBracketInfo({
          ...prevBi,
          entryPrice: prevBi.entryPrice + d,
          slPrice: prevBi.slPrice != null ? prevBi.slPrice + d : null,
          tpPrices: prevBi.tpPrices.map((p) => p + d),
        });
      }
      if (wasHideEntry) {
        useStore.getState().setLimitPrice(newPrice);
      }

      // For Suspended bracket legs, also update bracketEngine + pendingBracketInfo
      if (order.status === OrderStatus.Suspended) {
        const st = useStore.getState();
        const bi = st.pendingBracketInfo;
        if (bi) {
          const isSl = order.customTag?.endsWith('-SL') ?? (order.type === OrderType.Stop || order.type === OrderType.TrailingStop);
          if (isSl) {
            st.setPendingBracketInfo({ ...bi, slPrice: newPrice });
            const slDiff = Math.abs(bi.entryPrice - newPrice);
            const tpp = getTicksPerPoint(contract!);
            const slPoints = Math.round(priceToPoints(slDiff, contract!) * tpp) / tpp;
            bracketEngine.updateArmedConfig((cfg) => ({
              ...cfg,
              stopLoss: { ...cfg.stopLoss, points: Math.max(1 / tpp, slPoints) },
            }));
          } else {
            // Find which TP index this order corresponds to
            const tpIdx = order.customTag?.endsWith('-TP')
              ? 0
              : (bi.tpPrices.findIndex((p) => Math.abs(p - originalPrice) < 0.001));
            if (tpIdx >= 0) {
              const newTpPrices = [...bi.tpPrices];
              newTpPrices[tpIdx] = newPrice;
              st.setPendingBracketInfo({ ...bi, tpPrices: newTpPrices });
              const tpDiff = Math.abs(newPrice - bi.entryPrice);
              const tpp2 = getTicksPerPoint(contract!);
              const tpPoints = Math.round(priceToPoints(tpDiff, contract!) * tpp2) / tpp2;
              bracketEngine.updateArmedConfig((cfg) => ({
                ...cfg,
                takeProfits: cfg.takeProfits.map((tp, i) =>
                  i === tpIdx ? { ...tp, points: Math.max(1 / tpp2, tpPoints) } : tp),
              }));
            }
          }
        }
      }

      orderService.modifyOrder(params).catch((err) => {
        showToast('error', 'Order modification failed', errorMessage(err));
        // Revert line back to original price
        const line = refs.orderLines.current[dragIdx];
        if (line) {
          const pos = positions.find(
            (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract!.id) && p.size > 0,
          );
          line.setPrice(originalPrice);
          line.setLineColor(computeOrderLineColor(order, originalPrice, pos ?? undefined));
          line.syncPosition();
          refs.orderLinePrices.current[dragIdx] = originalPrice;
          refs.updateOverlay.current();
        }
        // Revert bracket preview positions
        if (prevBi) {
          useStore.getState().setPendingBracketInfo(prevBi);
        }
        if (wasHideEntry) {
          refs.previewPrices.current[0] = originalPrice;
          useStore.getState().setLimitPrice(originalPrice);
        }
      });
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isOrderChart, contract]);
}
