import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { orderService, type Order } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { OrderType, OrderSide, PositionType, OrderStatus } from '../../../types/enums';
import { calcPnl } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import type { ChartRefs } from './types';
import { darken, LABEL_TEXT, LABEL_BG, CLOSE_BG, computeOrderLineColor, BUY_COLOR, SELL_COLOR } from './labelUtils';
import { COLOR_SELL } from '../../../constants/colors';

interface Position {
  accountId: string;
  contractId: string;
  averagePrice: number;
  size: number;
  type: number;
}

/**
 * Build labels for open orders (SL/TP/limit).
 * Registers cancel-X, row-drag, and TP size +/- hit targets.
 * Returns P&L updaters and a cleanup function for the hover listener.
 */
export function buildOrderLabels(
  refs: ChartRefs,
  contract: Contract,
  openOrders: Order[],
  positions: Position[],
  activeAccountId: string | null,
  pendingBracketInfo: { entryPrice: number; slPrice: number | null; tpPrices: number[]; side: OrderSide; orderSize: number; tpSizes: number[] } | null,
  previewHideEntry: boolean,
  previewSide: OrderSide,
): { pnlUpdaters: (() => void)[]; cleanup: () => void } {
  const pnlUpdaters: (() => void)[] = [];
  let hoverCleanup: (() => void) | undefined;

  const pos = positions.find(
    (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
  );

  // TP size +/- button sub-element refs (keyed by orderId)
  const tpSizeButtons = new Map<string, {
    minusEl: HTMLDivElement; plusEl: HTMLDivElement;
    countEl: HTMLDivElement; sizeCell: HTMLDivElement;
    sizeBg: string;
  }>();

  // Redistribution handler
  async function handleRedistribute(
    clickedOrderId: number,
    clickedSize: number,
    delta: 1 | -1,
    allTps: Order[],
    isLong: boolean,
  ) {
    if (refs.tpRedistInFlight.current) return;
    refs.tpRedistInFlight.current = true;

    const acct = useStore.getState().activeAccountId;
    if (!acct) { refs.tpRedistInFlight.current = false; return; }

    const newClickedSize = clickedSize + delta;

    // Only steal/give to other TPs when there are no unallocated contracts
    const curPos = positions.find(
      (p) => p.accountId === acct && String(p.contractId) === String(contract.id) && p.size > 0,
    );
    const totalTpSize = allTps.reduce((sum, o) => sum + o.size, 0);
    const unallocated = (curPos?.size ?? 0) - totalTpSize;

    const otherTps = allTps
      .filter(o => o.id !== clickedOrderId)
      .sort((a, b) => {
        const aP = a.limitPrice ?? 0;
        const bP = b.limitPrice ?? 0;
        return isLong ? bP - aP : aP - bP;
      });

    // Block increase when all contracts are allocated
    if (delta === 1 && unallocated <= 0) {
      refs.tpRedistInFlight.current = false;
      return;
    }

    try {
      await orderService.modifyOrder({ accountId: acct, orderId: clickedOrderId, size: newClickedSize });
      bracketEngine.updateTPSize(clickedOrderId, newClickedSize);
    } catch (err) {
      showToast('error', 'Failed to modify TP size', errorMessage(err));
      refs.tpRedistInFlight.current = false;
      return;
    }

    refs.tpRedistInFlight.current = false;
  }

  for (const order of openOrders) {
    if (String(order.contractId) !== String(contract.id)) continue;
    let price: number | undefined;
    if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
      price = order.stopPrice;
    } else if (order.type === OrderType.Limit) {
      price = order.limitPrice;
    } else {
      continue;
    }
    if (price == null) continue;

    const orderId = order.id;
    const oSize = order.size;
    const oSide = order.side;
    const oType = order.type;
    const isSuspended = order.status === OrderStatus.Suspended;

    function profitColor(p: number): string {
      return computeOrderLineColor(order, p, pos);
    }
    const sizeBg = oSide === OrderSide.Sell ? SELL_COLOR : BUY_COLOR;

    function getOrderRefPrice(): number {
      for (let k = 0; k < refs.orderLineMeta.current.length; k++) {
        const m = refs.orderLineMeta.current[k];
        if (m.kind === 'order' && m.order.id === orderId) {
          return refs.orderLinePrices.current[k];
        }
      }
      return price!;
    }

    let initPnlText: string;
    let initPnlBg: string;
    let orderPnlCompute: (() => { text: string; bg: string; color?: string }) | null = null;

    const isSameSideEntry = pos && oType === OrderType.Limit && (
      (pos.type === PositionType.Long && oSide === OrderSide.Buy) ||
      (pos.type === PositionType.Short && oSide === OrderSide.Sell)
    );

    if (isSuspended && pendingBracketInfo) {
      // Suspended bracket leg — show P&L relative to entry price from pendingBracketInfo
      const ep = pendingBracketInfo.entryPrice;
      const isSl = oType === OrderType.Stop || oType === OrderType.TrailingStop;
      const diff = isSl
        ? (pendingBracketInfo.side === OrderSide.Buy ? ep - price : price - ep)
        : (pendingBracketInfo.side === OrderSide.Buy ? price - ep : ep - price);
      const pnl = calcPnl(diff, contract, oSize);
      initPnlText = `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`;
      initPnlBg = isSl ? SELL_COLOR : BUY_COLOR;

      orderPnlCompute = () => {
        const curPrice = getOrderRefPrice();
        const d = isSl
          ? (pendingBracketInfo.side === OrderSide.Buy ? ep - curPrice : curPrice - ep)
          : (pendingBracketInfo.side === OrderSide.Buy ? curPrice - ep : ep - curPrice);
        const p = calcPnl(d, contract, oSize);
        return { text: `${p >= 0 ? '+' : '-'}$${Math.abs(p).toFixed(2)}`, bg: isSl ? SELL_COLOR : BUY_COLOR, color: LABEL_TEXT };
      };
    } else if (pos && !isSameSideEntry) {
      const isLong = pos.type === PositionType.Long;
      const diff = isLong ? price - pos.averagePrice : pos.averagePrice - price;
      const projPnl = calcPnl(diff, contract, oSize);
      initPnlText = `${projPnl >= 0 ? '+' : ''}$${projPnl.toFixed(2)}`;
      initPnlBg = profitColor(price);

      orderPnlCompute = () => {
        const curPrice = getOrderRefPrice();
        const d = isLong ? curPrice - pos.averagePrice : pos.averagePrice - curPrice;
        const pnl = calcPnl(d, contract, oSize);
        const bg = profitColor(curPrice);
        return { text: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`, bg, color: LABEL_TEXT };
      };
    } else {
      // No position yet (pending entry with bracket orders, or standalone limit)
      if (oType === OrderType.Stop || oType === OrderType.TrailingStop) {
        // SL bracket on an unfilled entry — show label + cancel button so the user can remove it
        initPnlText = 'SL';
        initPnlBg = COLOR_SELL;
      } else {
        initPnlText = oSide === OrderSide.Buy ? 'Buy Limit' : 'Sell Limit';
        initPnlBg = LABEL_BG;
      }
    }

    let orderLineIdx = -1;
    for (let k = 0; k < refs.orderLineMeta.current.length; k++) {
      const m = refs.orderLineMeta.current[k];
      if (m.kind === 'order' && m.order.id === orderId) {
        orderLineIdx = k;
        break;
      }
    }
    const orderLine = orderLineIdx >= 0 ? refs.orderLines.current[orderLineIdx] : null;
    if (!orderLine) continue;

    const isEntryOrder = oType === OrderType.Limit && !isSuspended && (
      (pendingBracketInfo != null && oSide === pendingBracketInfo.side) ||
      (previewHideEntry && oSide === previewSide)
    );
    if (isEntryOrder) orderLine.setLabelLeft(0.65);

    orderLine.setLabel([
      { text: initPnlText, bg: initPnlBg, color: LABEL_TEXT },
      { text: String(oSize), bg: sizeBg, color: LABEL_TEXT },
      { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT },
    ]);

    const cells = orderLine.getCells();
    const labelEl = orderLine.getLabelEl();

    // TP size +/- buttons
    const isLiveTP = pos
      && pos.size > 1
      && oType === OrderType.Limit
      && oSide === (pos.type === PositionType.Long ? OrderSide.Sell : OrderSide.Buy);

    if (isLiveTP) {
      const oppSide = pos.type === PositionType.Long ? OrderSide.Sell : OrderSide.Buy;
      const allTps = openOrders.filter(o =>
        String(o.contractId) === String(contract.id)
        && o.type === OrderType.Limit
        && o.side === oppSide,
      );
      const totalTpSize = allTps.reduce((sum, o) => sum + o.size, 0);
      const unallocated = pos.size - totalTpSize;
      const minusDisabled = oSize <= 1;
      const plusDisabled = unallocated <= 0;
      const isLong = pos.type === PositionType.Long;

      const sizeCell = cells[1];
      sizeCell.style.display = 'flex';
      sizeCell.style.alignItems = 'center';
      sizeCell.style.padding = '0';
      sizeCell.style.transition = 'background var(--transition-fast)';
      sizeCell.textContent = '';
      sizeCell.dataset.screenshotText = String(oSize);

      const minusEl = document.createElement('div');
      minusEl.textContent = '\u2212';
      minusEl.style.cssText = `display:none;padding:0 3px;cursor:${minusDisabled ? 'default' : 'pointer'};opacity:${minusDisabled ? '0.5' : '1'};transition:opacity var(--transition-fast), transform var(--transition-fast);`;
      minusEl.addEventListener('mouseenter', () => { minusEl.style.transform = 'scale(1.4)'; });
      minusEl.addEventListener('mouseleave', () => { minusEl.style.transform = ''; });

      const countEl = document.createElement('div');
      countEl.textContent = String(oSize);
      countEl.style.cssText = 'padding:0 4px;';

      const plusEl = document.createElement('div');
      plusEl.textContent = '+';
      plusEl.style.cssText = `display:none;padding:0 3px;cursor:${plusDisabled ? 'default' : 'pointer'};opacity:${plusDisabled ? '0.5' : '1'};transition:opacity var(--transition-fast), transform var(--transition-fast);`;
      plusEl.addEventListener('mouseenter', () => { plusEl.style.transform = 'scale(1.4)'; });
      plusEl.addEventListener('mouseleave', () => { plusEl.style.transform = ''; });

      sizeCell.appendChild(minusEl);
      sizeCell.appendChild(countEl);
      sizeCell.appendChild(plusEl);

      tpSizeButtons.set(orderId, { minusEl, plusEl, countEl, sizeCell, sizeBg });

      if (refs.hoveredTpOrderId.current === orderId) {
        minusEl.style.display = '';
        plusEl.style.display = '';
        sizeCell.style.background = darken(sizeBg);
      }

      if (!minusDisabled) {
        refs.hitTargets.current.push({
          el: minusEl, priority: 0,
          handler: () => handleRedistribute(orderId, oSize, -1, allTps, isLong),
        });
      }
      if (!plusDisabled) {
        refs.hitTargets.current.push({
          el: plusEl, priority: 0,
          handler: () => handleRedistribute(orderId, oSize, 1, allTps, isLong),
        });
      }
    }

    // Cancel-X button (priority 0)
    const cancelOrder = order;
    refs.hitTargets.current.push({
      el: cells[2],
      priority: 0,
      handler: () => {
        const acct = useStore.getState().activeAccountId;
        if (!acct) return;

        // Optimistically remove from store
        useStore.getState().removeOrder(cancelOrder.id);
        orderService.cancelOrder(acct, cancelOrder.id).catch((err) => {
          useStore.getState().upsertOrder(cancelOrder);
          showToast('error', 'Failed to cancel order', errorMessage(err));
        });

        // For Suspended bracket legs, also update bracketEngine + pendingBracketInfo
        if (cancelOrder.status === OrderStatus.Suspended) {
          const st = useStore.getState();
          const bi = st.pendingBracketInfo;
          const isSl = cancelOrder.customTag?.endsWith('-SL') ?? (cancelOrder.type === OrderType.Stop || cancelOrder.type === OrderType.TrailingStop);
          if (isSl) {
            bracketEngine.updateArmedConfig((cfg) => ({ ...cfg, stopLoss: { ...cfg.stopLoss, points: 0 } }));
            if (bi) st.setPendingBracketInfo({ ...bi, slPrice: null });
          } else {
            const tpIdx = cancelOrder.customTag?.endsWith('-TP')
              ? 0
              : (bi?.tpPrices.findIndex((p) => Math.abs(p - (cancelOrder.limitPrice ?? 0)) < 0.001) ?? -1);
            if (tpIdx >= 0) {
              bracketEngine.updateArmedConfig((cfg) => ({ ...cfg, takeProfits: cfg.takeProfits.filter((_, i) => i !== tpIdx) }));
              if (bi) {
                st.setPendingBracketInfo({
                  ...bi,
                  tpPrices: bi.tpPrices.filter((_, i) => i !== tpIdx),
                  tpSizes: bi.tpSizes.filter((_, i) => i !== tpIdx),
                });
              }
            }
          }
        }
      },
    });

    // Row drag (priority 1)
    const dragOrder = order;
    if (labelEl) {
      refs.hitTargets.current.push({
        el: labelEl,
        priority: 1,
        handler: () => {
          let idx = -1;
          for (let k = 0; k < refs.orderLineMeta.current.length; k++) {
            const m = refs.orderLineMeta.current[k];
            if (m.kind === 'order' && m.order.id === dragOrder.id) { idx = k; break; }
          }
          if (idx === -1) return;
          refs.orderDragState.current = {
            meta: { kind: 'order', order: dragOrder },
            idx,
            originalPrice: refs.orderLinePrices.current[idx],
            draggedPrice: refs.orderLinePrices.current[idx],
          };
          refs.activeDragRow.current = labelEl;
          labelEl.style.cursor = 'grabbing';
          if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
          if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
        },
      });
    }

    // P&L updater
    if (orderPnlCompute) {
      const compute = orderPnlCompute;
      pnlUpdaters.push(() => {
        const result = compute();
        orderLine.updateSection(0, result.text, result.bg, result.color);
      });
    }
  }

  // Phantom bracket labels (lines rendered from pendingBracketInfo with no real order)
  for (let k = 0; k < refs.orderLineMeta.current.length; k++) {
    const meta = refs.orderLineMeta.current[k];
    if (meta.kind !== 'phantom-bracket') continue;

    const phantomLine = refs.orderLines.current[k];
    if (!phantomLine) continue;

    const bi = meta.bracketInfo;
    const phantomPrice = refs.orderLinePrices.current[k];
    const isSl = meta.bracketType === 'sl';
    const phantomSize = isSl ? bi.orderSize : (bi.tpSizes[meta.tpIndex ?? 0] ?? bi.orderSize);

    // P&L relative to entry price
    const diff = isSl
      ? (bi.side === OrderSide.Buy ? bi.entryPrice - phantomPrice : phantomPrice - bi.entryPrice)
      : (bi.side === OrderSide.Buy ? phantomPrice - bi.entryPrice : bi.entryPrice - phantomPrice);
    const pnl = calcPnl(diff, contract, phantomSize);
    const pnlText = `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`;
    const pnlBg = isSl ? SELL_COLOR : BUY_COLOR;

    phantomLine.setLabel([
      { text: pnlText, bg: pnlBg, color: LABEL_TEXT },
      { text: String(phantomSize), bg: pnlBg, color: LABEL_TEXT },
    ]);

    // P&L updater (tracks price if dragged)
    const capturedK = k;
    const capturedIsSl = isSl;
    const capturedSize = phantomSize;
    const capturedBi = bi;
    pnlUpdaters.push(() => {
      const curPrice = refs.orderLinePrices.current[capturedK];
      if (curPrice == null) return;
      const d = capturedIsSl
        ? (capturedBi.side === OrderSide.Buy ? capturedBi.entryPrice - curPrice : curPrice - capturedBi.entryPrice)
        : (capturedBi.side === OrderSide.Buy ? curPrice - capturedBi.entryPrice : capturedBi.entryPrice - curPrice);
      const p = calcPnl(d, contract, capturedSize);
      phantomLine.updateSection(0, `${p >= 0 ? '+' : '-'}$${Math.abs(p).toFixed(2)}`, pnlBg);
    });
  }

  // TP size hover detection (RAF-throttled to avoid per-move getBoundingClientRect)
  const hoverContainer = refs.container.current;
  if (hoverContainer && tpSizeButtons.size > 0) {
    let tpHoverRafPending = false;
    const onTpSizeHover = (e: MouseEvent) => {
      if (tpHoverRafPending) return;
      tpHoverRafPending = true;
      const mx = e.clientX;
      const my = e.clientY;

      requestAnimationFrame(() => {
        tpHoverRafPending = false;
        let foundId: string | null = null;

        for (const [oid, btns] of tpSizeButtons) {
          const rect = btns.sizeCell.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
            foundId = oid;
            break;
          }
        }

        if (foundId !== refs.hoveredTpOrderId.current) {
          if (refs.hoveredTpOrderId.current != null) {
            const prev = tpSizeButtons.get(refs.hoveredTpOrderId.current);
            if (prev) {
              prev.minusEl.style.display = 'none';
              prev.plusEl.style.display = 'none';
              prev.sizeCell.style.background = prev.sizeBg;
            }
          }
          if (foundId != null) {
            const cur = tpSizeButtons.get(foundId);
            if (cur) {
              cur.minusEl.style.display = '';
              cur.plusEl.style.display = '';
              cur.sizeCell.style.background = darken(cur.sizeBg);
            }
          }
          refs.hoveredTpOrderId.current = foundId;
        }
      });
    };

    hoverContainer.addEventListener('mousemove', onTpSizeHover);
    hoverCleanup = () => hoverContainer.removeEventListener('mousemove', onTpSizeHover);
  }

  return {
    pnlUpdaters,
    cleanup: hoverCleanup ?? (() => {}),
  };
}
