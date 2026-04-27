import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { orderService } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { useStore } from '../../../store/useStore';
import { OrderType, OrderSide, PositionType, OrderStatus } from '../../../types/enums';
import { pointsToPrice } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import { resolvePreviewConfig } from './resolvePreviewConfig';
import { classifyOrderLine, BUY_COLOR, SELL_COLOR } from './labelUtils';
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

    /** Find all entry indices for Suspended bracket legs of the current contract. */
    function findSuspendedBracketIndices(): number[] {
      return refs.orderEntries.current.reduce<number[]>((acc, e, k) => {
        if (e.meta.kind === 'order' && e.meta.order.status === OrderStatus.Suspended
            && String(e.meta.order.contractId) === String(contract!.id)) {
          acc.push(k);
        }
        return acc;
      }, []);
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
      const dragEntry = refs.orderEntries.current.find((e) => e.key === drag.key);
      if (dragEntry) {
        dragEntry.line.setPrice(snapped);
        if (pos) {
          const isL = pos.type === PositionType.Long;
          dragEntry.line.setLineColor((isL ? snapped >= pos.averagePrice : snapped <= pos.averagePrice) ? BUY_COLOR : SELL_COLOR);
        }
        dragEntry.line.syncPosition();
        dragEntry.price = snapped;
      }
      drag.draggedPrice = snapped;

      // Shift Suspended bracket legs to follow the dragged entry order
      if (drag.meta.kind === 'order' && drag.meta.order.type === OrderType.Limit
          && drag.meta.order.status !== OrderStatus.Suspended) {
        const delta = snapped - drag.originalPrice;
        const st = useStore.getState();

        // Shift Suspended bracket order lines
        if (st.pendingBracketInfo) {
          for (const idx of findSuspendedBracketIndices()) {
            const bracketEntry = refs.orderEntries.current[idx];
            if (!bracketEntry || bracketEntry.meta.kind !== 'order') continue;
            const origBracketPrice = bracketEntry.meta.order.stopPrice ?? bracketEntry.meta.order.limitPrice ?? 0;
            const newBracketPrice = origBracketPrice + delta;
            bracketEntry.line.setPrice(newBracketPrice);
            bracketEntry.line.syncPosition();
            bracketEntry.price = newBracketPrice;
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
      const { meta, key: dragKey, originalPrice, draggedPrice: newPrice } = drag;
      // NOTE: refs.orderDragState.current is cleared AFTER store updates below so the
      // reconciler triggered by those updates still has dragKey and won't snap the line back.
      if (refs.activeDragRow.current) {
        refs.activeDragRow.current.style.cursor = 'pointer';
        refs.activeDragRow.current = null;
      }
      if (refs.container.current) refs.container.current.style.cursor = CROSSHAIR_CURSOR;
      // Re-enable LWC scroll/scale after drag
      if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: true, handleScale: true });

      if (meta.kind !== 'order' || newPrice === originalPrice) {
        refs.orderDragState.current = null;
        return;
      }

      const { order } = meta;
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
            refs.orderDragState.current = null;
            const revertEntry = refs.orderEntries.current.find((e) => e.key === dragKey);
            if (revertEntry) {
              revertEntry.line.setPrice(originalPrice);
              revertEntry.line.setLineColor(SELL_COLOR);
              revertEntry.line.syncPosition();
              revertEntry.price = originalPrice;
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

      // For Suspended bracket legs, update bracketEngine + pendingBracketInfo.
      // Also optimistically upsert the order with the new price so coveredBracketPrices
      // stays consistent and the reconciler doesn't create a ghost phantom line.
      if (order.status === OrderStatus.Suspended) {
        const st = useStore.getState();
        const isSl = order.type === OrderType.Stop || order.type === OrderType.TrailingStop;
        st.upsertOrder(isSl ? { ...order, stopPrice: newPrice } : { ...order, limitPrice: newPrice });
        const bi = st.pendingBracketInfo;
        const cls = classifyOrderLine(order, {
          price: originalPrice,
          pos: positions.find((p) => p.accountId === activeAccountId && String(p.contractId) === String(contract!.id) && p.size > 0),
          pendingBracketInfo: bi,
          previewHideEntry: st.previewHideEntry,
          previewSide: st.previewSide,
        });
        bracketEngine.handleLegModify(newPrice, cls.isSl, cls.tpIndex, contract!);
      }

      // Clear drag state after all store updates so the reconciler triggered above
      // sees dragKey and preserves the dragged position instead of snapping back.
      refs.orderDragState.current = null;

      orderService.modifyOrder(params).catch((err) => {
        showToast('error', 'Order modification failed', errorMessage(err));
        // Revert line back to original price
        const revertEntry = refs.orderEntries.current.find((e) => e.key === dragKey);
        if (revertEntry) {
          const pos = positions.find(
            (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract!.id) && p.size > 0,
          );
          revertEntry.line.setPrice(originalPrice);
          revertEntry.line.setLineColor(classifyOrderLine(order, {
            price: originalPrice,
            pos: pos ?? undefined,
            pendingBracketInfo: useStore.getState().pendingBracketInfo,
            previewHideEntry: useStore.getState().previewHideEntry,
            previewSide: useStore.getState().previewSide,
          }).color);
          revertEntry.line.syncPosition();
          revertEntry.price = originalPrice;
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
