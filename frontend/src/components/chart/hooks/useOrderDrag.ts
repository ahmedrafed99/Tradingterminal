import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { orderService } from '../../../services/orderService';
import { useStore } from '../../../store/useStore';
import { OrderType, OrderSide, PositionType } from '../../../types/enums';
import { pointsToPrice } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import { resolvePreviewConfig } from './resolvePreviewConfig';
import { computeOrderLineColor, BUY_COLOR, SELL_COLOR } from './labelUtils';
import type { ChartRefs } from './types';

// Custom white crosshair cursor (24x24 SVG, hotspot at center)
const CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cline x1='12' y1='0' x2='12' y2='24' stroke='%23ffffff' stroke-width='2'/%3E%3Cline x1='0' y1='12' x2='24' y2='12' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`;

/**
 * Handle drag interaction for live order lines.
 * Dragging modifies the order price via orderService.modifyOrder().
 * Also shifts bracket preview lines (QO pending + hidden entry) to follow.
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

    function snapPrice(price: number): number {
      const ts = contract!.tickSize;
      return Math.round(price / ts) * ts;
    }

    function onMouseMove(e: MouseEvent) {
      const drag = refs.orderDragState.current;
      if (!drag) return;

      // Don't stopPropagation — let LWC see the event so crosshair stays visible
      e.preventDefault();

      const rect = container!.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
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

      // Shift pending bracket SL/TP preview lines to follow the dragged entry
      if (drag.meta.kind === 'order' && drag.meta.order.type === OrderType.Limit) {
        const delta = snapped - drag.originalPrice;
        const st = useStore.getState();

        // Path 1: Quick-order pending preview (+ button)
        const qo = st.qoPendingPreview;
        if (qo) {
          refs.qoPreviewPrices.current.entry = snapped;
          const sl = refs.qoPreviewLines.current.sl;
          if (sl && qo.slPrice != null) {
            sl.setPrice(qo.slPrice + delta); sl.syncPosition();
            refs.qoPreviewPrices.current.sl = qo.slPrice + delta;
          }
          qo.tpPrices.forEach((origTp, i) => {
            const tpLine = refs.qoPreviewLines.current.tps[i];
            if (tpLine) {
              tpLine.setPrice(origTp + delta); tpLine.syncPosition();
              refs.qoPreviewPrices.current.tps[i] = origTp + delta;
            }
          });
        }

        // Path 2: Preview with hidden entry (Buy/Sell button flow)
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

      refs.updateOverlay.current();
    }

    function onMouseUp() {
      const drag = refs.orderDragState.current;
      if (!drag) return;

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
      // Derive direction from order side (stop-sell → protecting long, stop-buy → protecting short)
      if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
        const currentPrice = useStore.getState().lastPrice ?? refs.lastBar.current?.close ?? null;
        if (currentPrice != null) {
          const protectsLong = order.side === OrderSide.Sell;
          const invalid = protectsLong ? newPrice >= currentPrice : newPrice <= currentPrice;
          if (invalid) {
            showToast('warning', 'Invalid stop loss price',
              protectsLong ? 'Stop must be below current price for long positions'
                           : 'Stop must be above current price for short positions');
            const line = refs.orderLines.current[dragIdx];
            if (line) {
              line.setPrice(originalPrice);
              line.setLineColor(SELL_COLOR);
              line.syncPosition();
              refs.orderLinePrices.current[dragIdx] = originalPrice;
              refs.updateOverlay.current();
            }
            return;
          }
        }
      }

      const params: { accountId: number; orderId: number; stopPrice?: number; limitPrice?: number } = {
        accountId,
        orderId: order.id,
      };

      if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
        params.stopPrice = newPrice;
      } else if (order.type === OrderType.Limit) {
        params.limitPrice = newPrice;
      }

      // Optimistically commit bracket preview positions to store
      const prevQo = order.type === OrderType.Limit ? useStore.getState().qoPendingPreview : null;
      const wasHideEntry = order.type === OrderType.Limit && useStore.getState().previewHideEntry;
      if (prevQo) {
        const d = newPrice - originalPrice;
        useStore.getState().setQoPendingPreview({
          ...prevQo,
          entryPrice: prevQo.entryPrice + d,
          slPrice: prevQo.slPrice != null ? prevQo.slPrice + d : null,
          tpPrices: prevQo.tpPrices.map((p) => p + d),
        });
      }
      if (wasHideEntry) {
        useStore.getState().setLimitPrice(newPrice);
      }

      orderService.modifyOrder(params).catch((err) => {
        showToast('error', 'Order modification failed', errorMessage(err));
        // Revert line back to original price
        const line = refs.orderLines.current[dragIdx];
        if (line) {
          // Recompute correct color based on position
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
        if (prevQo) {
          useStore.getState().setQoPendingPreview(prevQo);
          refs.qoPreviewPrices.current.entry = prevQo.entryPrice;
          const sl = refs.qoPreviewLines.current.sl;
          if (sl && prevQo.slPrice != null) { sl.setPrice(prevQo.slPrice); sl.syncPosition(); refs.qoPreviewPrices.current.sl = prevQo.slPrice; }
          prevQo.tpPrices.forEach((tp, i) => {
            const l = refs.qoPreviewLines.current.tps[i];
            if (l) { l.setPrice(tp); l.syncPosition(); refs.qoPreviewPrices.current.tps[i] = tp; }
          });
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
