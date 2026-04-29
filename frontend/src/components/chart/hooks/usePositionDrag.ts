import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { orderService } from '../../../services/orderService';
import { useStore } from '../../../store/useStore';
import { OrderType, OrderSide } from '../../../types/enums';
import { calcPnl } from '../../../utils/instrument';
import { snapToTickSize } from '../barUtils';
import { showToast, errorMessage } from '../../../utils/toast';
import { PriceLevelPrimitive } from '../primitives/PriceLevelPrimitive';
import type { ChartRefs } from './types';
import { BUY_COLOR, LABEL_TEXT, CLOSE_BG } from './labelUtils';
import { CROSSHAIR_CURSOR } from './drawingInteraction';

/**
 * Handle position drag-to-create SL/TP.
 * Dragging from the position label creates a temporary preview line,
 * and on mouseup places a new SL or TP order via orderService.placeOrder().
 */
export function usePositionDrag(
  refs: ChartRefs,
  contract: Contract | null,
  isOrderChart: boolean,
): void {
  const positions = useStore((s) => s.positions);
  const openOrders = useStore((s) => s.openOrders);
  const activeAccountId = useStore((s) => s.activeAccountId);

  useEffect(() => {
    if (!isOrderChart) return;
    const container = refs.container.current;
    const chart = refs.chart.current;
    if (!container || !chart || !contract) return;

    const tickSize = contract.tickSize;

    function snapPrice(price: number): number {
      return snapToTickSize(price, tickSize);
    }

    let cachedRect: DOMRect | null = null;

    /** Idempotent cleanup — safe to call multiple times. */
    function abortDrag() {
      cachedRect = null;
      refs.posDrag.current = null;
      if (refs.container.current) refs.container.current.style.cursor = CROSSHAIR_CURSOR;
      if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: true, handleScale: true });
      if (refs.posDragLine.current && refs.series.current) {
        refs.series.current.detachPrimitive(refs.posDragLine.current);
        refs.posDragLine.current = null;
      }
    }

    /** Check whether the position backing this drag is still open. */
    function isPositionAlive(): boolean {
      const st = useStore.getState();
      if (!st.activeAccountId || !contract) return false;
      const pos = st.positions.find(
        (p) => p.accountId === st.activeAccountId && String(p.contractId) === String(contract!.id),
      );
      return pos != null && pos.size !== 0;
    }

    function onMouseMove(e: MouseEvent) {
      const drag = refs.posDrag.current;
      if (!drag) return;

      // Abort immediately if the position closed (e.g. SL filled mid-drag)
      if (!isPositionAlive()) {
        abortDrag();
        return;
      }

      // Don't stopPropagation — let the event reach LWC so the crosshair stays visible
      e.preventDefault();

      if (!cachedRect) cachedRect = container!.getBoundingClientRect();
      const mouseY = e.clientY - cachedRect.top;
      const series = refs.series.current;
      if (!series) return;
      const rawPrice = series.coordinateToPrice(mouseY);
      if (rawPrice === null) return;
      const snapped = snapPrice(rawPrice as number);

      // Determine direction based on price relative to position
      let direction: 'sl' | 'tp';
      if (drag.isLong) {
        direction = snapped < drag.avgPrice ? 'sl' : 'tp';
      } else {
        direction = snapped > drag.avgPrice ? 'sl' : 'tp';
      }
      drag.direction = direction;
      drag.snappedPrice = snapped;

      // Compute all display values up front so the primitive gets correct cells from frame 1
      const color = direction === 'sl' ? '#ff4444' : BUY_COLOR;
      const diff = drag.isLong
        ? (direction === 'tp' ? snapped - drag.avgPrice : drag.avgPrice - snapped)
        : (direction === 'tp' ? drag.avgPrice - snapped : snapped - drag.avgPrice);
      const orderSz = direction === 'sl' ? drag.posSize : 1;
      const pnl = calcPnl(diff, contract!, orderSz);
      const pnlText = direction === 'sl'
        ? `-$${Math.abs(pnl).toFixed(2)}`
        : `+$${Math.abs(pnl).toFixed(2)}`;
      const labelText = direction === 'sl' ? 'SL' : 'TP';
      const textColor = color === BUY_COLOR ? LABEL_TEXT : '#fff';

      // Create or update canvas primitive ghost line
      if (!refs.posDragLine.current) {
        const primitive = new PriceLevelPrimitive({
          price: snapped,
          lineColor: color,
          lineStyle: 'dashed',
          lineWidth: 2,
          cellOrder: ['pnl', 'size', 'lbl'],
          cells: {
            pnl: { text: pnlText, bg: color, color: textColor },
            size: { text: String(orderSz), bg: color, color: textColor },
            lbl: { text: labelText, bg: CLOSE_BG, color: LABEL_TEXT },
          },
          priceLabel: { visible: true, tickSize },
          allowPriceMove: false,
        });
        series.attachPrimitive(primitive);
        refs.posDragLine.current = primitive;
      } else {
        refs.posDragLine.current.setPrice(snapped);
        refs.posDragLine.current.setLineColor(color);
        refs.posDragLine.current.setCell('pnl', { text: pnlText, bg: color, color: textColor });
        refs.posDragLine.current.setCell('size', { text: String(orderSz), bg: color, color: textColor });
        refs.posDragLine.current.setCell('lbl', { text: labelText });
      }
    }

    function onMouseUp() {
      const drag = refs.posDrag.current;
      if (!drag) return;

      abortDrag();

      if (!drag.direction) return;

      // Don't place order if position closed mid-drag (e.g. SL filled)
      if (!isPositionAlive()) return;

      const st = useStore.getState();
      if (!st.activeAccountId || !contract) return;
      const accountId = st.activeAccountId;

      const oppositeSide = drag.isLong ? OrderSide.Sell : OrderSide.Buy;

      if (drag.direction === 'sl') {
        // Validate: no existing stop order for this contract + side
        const existingSL = st.openOrders.some(
          (o) => String(o.contractId) === String(contract!.id)
            && (o.type === OrderType.Stop || o.type === OrderType.TrailingStop)
            && o.side === oppositeSide,
        );
        if (existingSL) {
          showToast('warning', 'SL already exists for this position');
          return;
        }

        // If the stop would be at or above current market price (long) or at or below (short),
        // the exchange will reject it. Auto-close the position with a market order instead.
        const currentPrice = st.lastPrice;
        const isStopInvalid = currentPrice !== null && (
          drag.isLong ? drag.snappedPrice >= currentPrice : drag.snappedPrice <= currentPrice
        );
        if (isStopInvalid) {
          showToast('info', 'Stop above market — closing position');
          orderService.placeOrder({
            accountId,
            contractId: contract!.id,
            type: OrderType.Market,
            side: oppositeSide,
            size: drag.posSize,
          }).catch((err) => {
            showToast('error', 'Close position failed', errorMessage(err));
          });
          return;
        }

        orderService.placeOrder({
          accountId,
          contractId: contract!.id,
          type: OrderType.Stop,
          side: oppositeSide,
          size: drag.posSize,
          stopPrice: drag.snappedPrice,
        }).catch((err) => {
          const msg = errorMessage(err).toLowerCase();
          if (msg.includes('stop') && (msg.includes('above') || msg.includes('below'))) {
            showToast('info', 'Stop at market — closing position');
            orderService.placeOrder({
              accountId,
              contractId: contract!.id,
              type: OrderType.Market,
              side: oppositeSide,
              size: drag.posSize,
            }).catch((closeErr) => {
              showToast('error', 'Close position failed', errorMessage(closeErr));
            });
          } else {
            showToast('error', 'Stop Loss placement failed', errorMessage(err));
          }
        });
      } else {
        // TP: validate remaining contracts
        const existingTpSize = st.openOrders
          .filter(
            (o) => String(o.contractId) === String(contract!.id)
              && o.type === OrderType.Limit
              && o.side === oppositeSide,
          )
          .reduce((sum, o) => sum + o.size, 0);
        const remaining = drag.posSize - existingTpSize;
        if (remaining <= 0) {
          showToast('warning', 'No remaining contracts for TP');
          return;
        }
        orderService.placeOrder({
          accountId,
          contractId: contract!.id,
          type: OrderType.Limit,
          side: oppositeSide,
          size: Math.min(1, remaining),
          limitPrice: drag.snappedPrice,
        }).catch((err) => {
          showToast('error', 'Take Profit placement failed', errorMessage(err));
        });
      }
    }

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);

    // Abort drag immediately if position closes (e.g. SL filled while mouse is still)
    const unsubPositions = useStore.subscribe(
      (state, prevState) => {
        if (!refs.posDrag.current) return;
        if (state.positions === prevState.positions) return;
        if (!isPositionAlive()) abortDrag();
      },
    );

    return () => {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      unsubPositions();
      abortDrag();
    };
  }, [isOrderChart, contract, positions, openOrders, activeAccountId]);
}
