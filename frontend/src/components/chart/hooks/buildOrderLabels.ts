import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { orderService, type Order } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { OrderType, OrderSide, PositionType, OrderStatus } from '../../../types/enums';
import { calcPnl } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import type { ChartRefs } from './types';
import { darken, LABEL_TEXT, LABEL_BG, CLOSE_BG, BUY_COLOR, SELL_COLOR, classifyOrderLine } from './labelUtils';

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
    clickedOrderId: string,
    clickedSize: number,
    delta: 1 | -1,
    allTps: Order[],
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

    const cls = classifyOrderLine(order, { price, pos, pendingBracketInfo, previewHideEntry, previewSide });

    function profitColor(p: number): string {
      return classifyOrderLine(order, { price: p, pos, pendingBracketInfo, previewHideEntry, previewSide }).color;
    }
    const { sizeBg } = cls;

    function getOrderRefPrice(): number {
      const entry = refs.orderEntries.current.find(
        (e) => e.meta.kind === 'order' && e.meta.order.id === orderId,
      );
      return entry?.price ?? price!;
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
      const isSl = cls.isSl;
      const diff = isSl
        ? (pendingBracketInfo.side === OrderSide.Buy ? ep - price : price - ep)
        : (pendingBracketInfo.side === OrderSide.Buy ? price - ep : ep - price);
      const pnl = calcPnl(diff, contract, oSize);
      initPnlText = `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`;
      initPnlBg = isSl ? SELL_COLOR : BUY_COLOR;

      orderPnlCompute = () => {
        const curPrice = getOrderRefPrice();
        // Use live entry order price so P&L stays constant when entry is dragged
        const entryOrdEntry = refs.orderEntries.current.find(
          (e) => e.meta.kind === 'order'
            && e.meta.order.type === OrderType.Limit
            && e.meta.order.status !== OrderStatus.Suspended,
        );
        const currentEp = entryOrdEntry?.price ?? ep;
        const d = isSl
          ? (pendingBracketInfo.side === OrderSide.Buy ? currentEp - curPrice : curPrice - currentEp)
          : (pendingBracketInfo.side === OrderSide.Buy ? curPrice - currentEp : currentEp - curPrice);
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
        initPnlBg = SELL_COLOR;
      } else {
        initPnlText = oSide === OrderSide.Buy ? 'Buy Limit' : 'Sell Limit';
        initPnlBg = LABEL_BG;
      }
    }

    const orderLineIdx = refs.orderEntries.current.findIndex(
      (e) => e.meta.kind === 'order' && e.meta.order.id === orderId,
    );
    const orderLine = orderLineIdx >= 0 ? refs.orderEntries.current[orderLineIdx].line : null;
    if (!orderLine) continue;

    if (cls.isEntry) orderLine.setLabelLeft(0.65);

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
          handler: () => handleRedistribute(orderId, oSize, -1, allTps),
        });
      }
      if (!plusDisabled) {
        refs.hitTargets.current.push({
          el: plusEl, priority: 0,
          handler: () => handleRedistribute(orderId, oSize, 1, allTps),
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

        if (cancelOrder.status === OrderStatus.Suspended) {
          bracketEngine.handleLegCancel(cls.isSl, cls.tpIndex);
        } else if (cls.isEntry && useStore.getState().pendingBracketInfo) {
          const st = useStore.getState();
          const bracketLegs = st.openOrders.filter(
            (o) => o.status === OrderStatus.Suspended
              && String(o.contractId) === String(cancelOrder.contractId),
          );
          st.setPendingBracketInfo(null);
          bracketEngine.clearSession();
          for (const leg of bracketLegs) {
            st.removeOrder(leg.id);
            // Don't revert on failure — server cascade-cancels these when the entry
            // is cancelled, so an "order not found" error is expected and harmless.
            orderService.cancelOrder(acct, leg.id).catch(() => {});
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
          const dragKey = `o:${dragOrder.id}`;
          const entry = refs.orderEntries.current.find((e) => e.key === dragKey);
          if (!entry) return;
          refs.orderDragState.current = {
            meta: { kind: 'order', order: dragOrder },
            key: dragKey,
            originalPrice: entry.price,
            draggedPrice: entry.price,
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
  for (const entry of refs.orderEntries.current) {
    const meta = entry.meta;
    if (meta.kind !== 'phantom-bracket') continue;

    const phantomLine = entry.line;
    const bi = meta.bracketInfo;
    const phantomPrice = entry.price;
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
      { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT },
    ]);

    // Cancel-X for phantom (priority 0)
    const phantomCells = phantomLine.getCells();
    if (phantomCells[2]) {
      const phantomMeta = meta;
      refs.hitTargets.current.push({
        el: phantomCells[2],
        priority: 0,
        handler: () => {
          bracketEngine.handleLegCancel(phantomMeta.bracketType === 'sl', phantomMeta.tpIndex ?? null);
        },
      });
    }

    // Row drag for phantom lines (priority 1) — updates pendingBracketInfo on release
    const phantomLabelEl = phantomLine.getLabelEl();
    const phantomEntry = entry;
    if (phantomLabelEl) {
      refs.hitTargets.current.push({
        el: phantomLabelEl,
        priority: 1,
        handler: () => {
          refs.orderDragState.current = {
            meta: phantomEntry.meta,
            key: phantomEntry.key,
            originalPrice: phantomEntry.price,
            draggedPrice: phantomEntry.price,
          };
          refs.activeDragRow.current = phantomLabelEl;
          phantomLabelEl.style.cursor = 'grabbing';
          if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
          if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
        },
      });
    }

    // P&L updater — uses current entry line price so P&L stays constant when entry is dragged
    const capturedEntry = entry;
    const capturedIsSl = isSl;
    const capturedSize = phantomSize;
    const capturedBi = bi;
    pnlUpdaters.push(() => {
      const curPrice = capturedEntry.price;
      // Use live entry order price so dragging entry doesn't change phantom P&L
      const entryEntry = refs.orderEntries.current.find(
        (e) => e.meta.kind === 'order'
          && e.meta.order.type === OrderType.Limit
          && e.meta.order.status !== OrderStatus.Suspended,
      );
      const currentEntryPrice = entryEntry?.price ?? capturedBi.entryPrice;
      const d = capturedIsSl
        ? (capturedBi.side === OrderSide.Buy ? currentEntryPrice - curPrice : curPrice - currentEntryPrice)
        : (capturedBi.side === OrderSide.Buy ? curPrice - currentEntryPrice : currentEntryPrice - curPrice);
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
