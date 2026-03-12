import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { bracketEngine } from '../../../services/bracketEngine';
import { useStore } from '../../../store/useStore';
import { orderService } from '../../../services/orderService';
import { OrderSide, OrderType, OrderStatus } from '../../../types/enums';
import { priceToPoints } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import type { ChartRefs } from './types';

// Custom white crosshair cursor (24x24 SVG, hotspot at center)
const CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cline x1='12' y1='0' x2='12' y2='24' stroke='%23ffffff' stroke-width='2'/%3E%3Cline x1='0' y1='12' x2='24' y2='12' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`;

/**
 * Handle drag interaction for preview lines (entry, SL, TP) and QO pending preview lines.
 * Initiated from overlay labels via previewDragState ref.
 */
export function usePreviewDrag(
  refs: ChartRefs,
  contract: Contract | null,
  isOrderChart: boolean,
): void {
  const previewEnabled = useStore((s) => s.previewEnabled);
  const qoPendingPreview = useStore((s) => s.qoPendingPreview);

  useEffect(() => {
    if (!isOrderChart) return;
    const container = refs.container.current;
    if (!container || (!previewEnabled && !qoPendingPreview) || !contract) return;

    function snap(price: number): number {
      const ts = contract!.tickSize;
      return Math.round(price / ts) * ts;
    }

    function onMouseMove(e: MouseEvent) {
      const drag = refs.previewDragState.current;
      if (!drag) return;

      // Don't stopPropagation — let LWC see the event so crosshair stays visible
      e.preventDefault();

      const rect = container!.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const series = refs.series.current;
      if (!series) return;
      const rawPrice = series.coordinateToPrice(mouseY);
      if (rawPrice === null) return;
      const snapped = snap(rawPrice as number);

      // Quick-order pending preview drag
      if (drag.role.kind === 'qo-sl') {
        const line = refs.qoPreviewLines.current.sl;
        if (line) { line.setPrice(snapped); line.syncPosition(); }
        refs.qoPreviewPrices.current.sl = snapped;
        refs.updateOverlay.current();
        return;
      }
      if (drag.role.kind === 'qo-tp') {
        const tpIdx = drag.role.index;
        const line = refs.qoPreviewLines.current.tps[tpIdx];
        if (line) { line.setPrice(snapped); line.syncPosition(); }
        refs.qoPreviewPrices.current.tps[tpIdx] = snapped;
        refs.updateOverlay.current();
        return;
      }

      // Regular order panel preview drag
      const pvLine = refs.previewLines.current[drag.lineIdx];
      if (pvLine) { pvLine.setPrice(snapped); pvLine.syncPosition(); }
      refs.previewPrices.current[drag.lineIdx] = snapped;
      refs.updateOverlay.current();

      const st = useStore.getState();

      if (drag.role.kind === 'entry') {
        st.setOrderType('limit');
        st.setLimitPrice(snapped);
      } else {
        const entryPrice = st.orderType === 'limit' ? st.limitPrice : st.lastPrice;
        if (entryPrice) {
          const pts = priceToPoints(Math.abs(entryPrice - snapped), contract!);
          const rounded = Math.max(1, Math.round(pts));
          const hasPreset = st.bracketPresets.some((p) => p.id === st.activePresetId);
          if (drag.role.kind === 'sl') {
            if (hasPreset) st.setDraftSlPoints(rounded);
            else st.setAdHocSlPoints(rounded);
          } else if (drag.role.kind === 'tp') {
            if (hasPreset) st.setDraftTpPoints(drag.role.index, rounded);
            else st.updateAdHocTpPoints(drag.role.index, rounded);
          }
        }
      }
    }

    function onMouseUp(e: MouseEvent) {
      const drag = refs.previewDragState.current;
      if (drag) {
        // Entry label click-vs-drag: if movement < 4px, treat as click (submit order)
        const click = refs.entryClick.current;
        if (click) {
          const dx = Math.abs(e.clientX - click.downX);
          const dy = Math.abs(e.clientY - click.downY);
          if (dx < 4 && dy < 4) click.exec();
          refs.entryClick.current = null;
        }

        // Commit quick-order pending preview drag to store + bracketEngine
        if (drag.role.kind === 'qo-sl' || drag.role.kind === 'qo-tp') {
          const st = useStore.getState();
          const cur = st.qoPendingPreview;
          if (cur) {
            if (drag.role.kind === 'qo-sl' && refs.qoPreviewPrices.current.sl != null) {
              const newSlPrice = refs.qoPreviewPrices.current.sl;
              st.setQoPendingPreview({ ...cur, slPrice: newSlPrice });
              const slDiff = Math.abs(cur.entryPrice - newSlPrice);
              const slPoints = Math.round(priceToPoints(slDiff, contract!));
              bracketEngine.updateArmedConfig((cfg) => ({
                ...cfg,
                stopLoss: { ...cfg.stopLoss, points: Math.max(1, slPoints) },
              }));

              // Modify the actual Suspended SL order in the gateway
              if (st.activeAccountId && contract) {
                const oppSide = cur.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;
                const slOrder = st.openOrders.find((o) =>
                  String(o.contractId) === String(contract.id) &&
                  o.status === OrderStatus.Suspended &&
                  (o.customTag?.endsWith('-SL') ?? (
                    o.side === oppSide &&
                    (o.type === OrderType.Stop || o.type === OrderType.TrailingStop) &&
                    o.size === cur.orderSize
                  )),
                );
                if (slOrder) {
                  const prevPrice = slOrder.stopPrice;
                  st.upsertOrder({ ...slOrder, stopPrice: newSlPrice });
                  orderService.modifyOrder({ accountId: st.activeAccountId, orderId: slOrder.id, stopPrice: newSlPrice }).catch((err) => {
                    st.upsertOrder({ ...slOrder, stopPrice: prevPrice });
                    showToast('error', 'SL modify failed', errorMessage(err));
                  });
                }
              }
            } else if (drag.role.kind === 'qo-tp') {
              const tpIdx = drag.role.index;
              const newTpPrice = refs.qoPreviewPrices.current.tps[tpIdx];
              if (newTpPrice != null) {
                const newTpPrices = [...cur.tpPrices];
                newTpPrices[tpIdx] = newTpPrice;
                st.setQoPendingPreview({ ...cur, tpPrices: newTpPrices });
                const tpDiff = Math.abs(newTpPrice - cur.entryPrice);
                const tpPoints = Math.round(priceToPoints(tpDiff, contract!));
                bracketEngine.updateArmedConfig((cfg) => ({
                  ...cfg,
                  takeProfits: cfg.takeProfits.map((tp, i) =>
                    i === tpIdx ? { ...tp, points: Math.max(1, tpPoints) } : tp),
                }));

                // Modify the actual Suspended TP order in the gateway
                if (st.activeAccountId && contract) {
                  const oppSide = cur.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;
                  const suspendedTps = st.openOrders.filter((o) =>
                    String(o.contractId) === String(contract.id) &&
                    o.status === OrderStatus.Suspended &&
                    (o.customTag?.endsWith('-TP') ?? (
                      o.side === oppSide &&
                      o.type === OrderType.Limit &&
                      o.size === cur.orderSize
                    )),
                  );
                  const tpOrder = suspendedTps[tpIdx];
                  if (tpOrder) {
                    const prevPrice = tpOrder.limitPrice;
                    st.upsertOrder({ ...tpOrder, limitPrice: newTpPrice });
                    orderService.modifyOrder({ accountId: st.activeAccountId, orderId: tpOrder.id, limitPrice: newTpPrice }).catch((err) => {
                      st.upsertOrder({ ...tpOrder, limitPrice: prevPrice });
                      showToast('error', 'TP modify failed', errorMessage(err));
                    });
                  }
                }
              }
            }
          }
        }

        refs.previewDragState.current = null;
        if (refs.activeDragRow.current) {
          refs.activeDragRow.current.style.cursor = 'pointer';
          refs.activeDragRow.current = null;
        }
        if (refs.container.current) refs.container.current.style.cursor = CROSSHAIR_CURSOR;
        // Re-enable LWC scroll/scale after drag
        if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: true, handleScale: true });
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isOrderChart, previewEnabled, qoPendingPreview, contract]);
}
