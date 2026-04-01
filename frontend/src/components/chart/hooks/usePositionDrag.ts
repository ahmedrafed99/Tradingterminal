import { useEffect } from 'react';
import { FONT_FAMILY } from '../../../constants/layout';
import type { Contract } from '../../../services/marketDataService';
import { orderService } from '../../../services/orderService';
import { useStore } from '../../../store/useStore';
import { OrderType, OrderSide } from '../../../types/enums';
import { calcPnl } from '../../../utils/instrument';
import { snapToTickSize } from '../barUtils';
import { showToast, errorMessage } from '../../../utils/toast';
import { PriceLevelLine } from '../PriceLevelLine';
import type { ChartRefs } from './types';
import { BUY_COLOR, LABEL_TEXT, CLOSE_BG } from './labelUtils';

// Custom white crosshair cursor (24x24 SVG, hotspot at center)
const CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cline x1='12' y1='0' x2='12' y2='24' stroke='%23ffffff' stroke-width='2'/%3E%3Cline x1='0' y1='12' x2='24' y2='12' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`;

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
    const overlay = refs.overlay.current;
    const chart = refs.chart.current;
    if (!container || !overlay || !chart || !contract) return;

    const tickSize = contract.tickSize;

    function snapPrice(price: number): number {
      return snapToTickSize(price, tickSize);
    }

    /** Idempotent cleanup — safe to call multiple times. */
    function abortDrag() {
      refs.posDrag.current = null;
      if (refs.activeDragRow.current) {
        refs.activeDragRow.current.style.cursor = 'pointer';
        refs.activeDragRow.current = null;
      }
      if (refs.container.current) refs.container.current.style.cursor = CROSSHAIR_CURSOR;
      if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: true, handleScale: true });
      if (refs.posDragLine.current) {
        refs.posDragLine.current.destroy();
        refs.posDragLine.current = null;
      }
      if (refs.posDragLabel.current) {
        refs.posDragLabel.current.remove();
        refs.posDragLabel.current = null;
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

      const rect = container!.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
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

      // Create or update temporary preview line
      const color = direction === 'sl' ? '#ff4444' : BUY_COLOR;
      if (!refs.posDragLine.current) {
        refs.posDragLine.current = new PriceLevelLine({
          price: snapped,
          series: series!, overlay: overlay!, chartApi: chart!,
          lineColor: color, lineStyle: 'dashed', lineWidth: 2,
          axisLabelVisible: true, tickSize,
        });
      } else {
        refs.posDragLine.current.setPrice(snapped);
        refs.posDragLine.current.setLineColor(color);
        refs.posDragLine.current.syncPosition();
      }

      // Compute projected P&L for the label
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

      // Create or update temporary overlay label
      if (!refs.posDragLabel.current && overlay) {
        const row = document.createElement('div');
        row.style.cssText = `position:absolute;left:50%;display:flex;height:20px;font-size:11px;font-weight:bold;font-family:${FONT_FAMILY};line-height:20px;transform:translate(-50%,-50%);white-space:nowrap;border-radius:3px;overflow:hidden;pointer-events:none;`;
        // P&L cell
        const pnlCell = document.createElement('div');
        pnlCell.style.cssText = `background:${color};color:${textColor};padding:0 6px;`;
        pnlCell.textContent = pnlText;
        pnlCell.dataset.role = 'pnl';
        row.appendChild(pnlCell);
        // Size cell
        const sizeCell = document.createElement('div');
        sizeCell.style.cssText = `background:${color};color:${textColor};padding:0 6px;`;
        sizeCell.textContent = String(orderSz);
        sizeCell.dataset.role = 'size';
        row.appendChild(sizeCell);
        // Label cell
        const lblCell = document.createElement('div');
        lblCell.style.cssText = `background:${CLOSE_BG};color:${LABEL_TEXT};padding:0 6px;`;
        lblCell.textContent = labelText;
        lblCell.dataset.role = 'lbl';
        row.appendChild(lblCell);
        overlay.appendChild(row);
        refs.posDragLabel.current = row;
      }
      if (refs.posDragLabel.current) {
        // Update cell contents
        const cells = refs.posDragLabel.current.children;
        const pnlCell = cells[0] as HTMLDivElement;
        const sizeCell = cells[1] as HTMLDivElement;
        const lblCell = cells[2] as HTMLDivElement;
        pnlCell.textContent = pnlText;
        pnlCell.style.background = color;
        pnlCell.style.color = textColor;
        sizeCell.textContent = String(orderSz);
        sizeCell.style.background = color;
        sizeCell.style.color = textColor;
        lblCell.textContent = labelText;
        // Position at Y coordinate of the snapped price
        const y = series.priceToCoordinate(snapped);
        if (y !== null) {
          refs.posDragLabel.current.style.top = `${y}px`;
          refs.posDragLabel.current.style.display = 'flex';
        }
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
        orderService.placeOrder({
          accountId: st.activeAccountId,
          contractId: contract!.id,
          type: OrderType.Stop,
          side: oppositeSide,
          size: drag.posSize,
          stopPrice: drag.snappedPrice,
        }).catch((err) => {
          showToast('error', 'Stop Loss placement failed', errorMessage(err));
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
          accountId: st.activeAccountId,
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
