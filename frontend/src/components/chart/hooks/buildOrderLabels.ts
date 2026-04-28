import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { orderService, type Order } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { OrderType, OrderSide, PositionType, OrderStatus } from '../../../types/enums';
import { calcPnl } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import type { ChartRefs } from './types';
import { LABEL_TEXT, LABEL_BG, CLOSE_BG, BUY_COLOR, SELL_COLOR, classifyOrderLine } from './labelUtils';

interface Position {
  accountId: string;
  contractId: string;
  averagePrice: number;
  size: number;
  type: number;
}

/**
 * Configure cell content + onClick handlers on order/phantom PriceLevelPrimitive instances.
 * Returns P&L updater closures (called on lastPrice tick) and a no-op cleanup.
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

  const pos = positions.find(
    (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
  );

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

    const orderEntry = refs.orderEntries.current.find(
      (e) => e.meta.kind === 'order' && e.meta.order.id === orderId,
    );
    if (!orderEntry) continue;
    const primitive = orderEntry.line;

    function getOrderRefPrice(): number {
      const entry = refs.orderEntries.current.find(
        (e) => e.meta.kind === 'order' && e.meta.order.id === orderId,
      );
      return entry?.price ?? price!;
    }

    // ── Determine initial P&L text + bg ──────────────────────────────────

    let initPnlText: string;
    let initPnlBg: string;
    let orderPnlCompute: (() => { text: string; bg: string }) | null = null;

    const isSameSideEntry =
      pos &&
      oType === OrderType.Limit &&
      (
        (pos.type === PositionType.Long && oSide === OrderSide.Buy) ||
        (pos.type === PositionType.Short && oSide === OrderSide.Sell)
      );

    if (isSuspended && pendingBracketInfo) {
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
        const entryOrdEntry = refs.orderEntries.current.find(
          (e) =>
            e.meta.kind === 'order' &&
            e.meta.order.type === OrderType.Limit &&
            e.meta.order.status !== OrderStatus.Suspended,
        );
        const currentEp = entryOrdEntry?.price ?? ep;
        const d = isSl
          ? (pendingBracketInfo.side === OrderSide.Buy ? currentEp - curPrice : curPrice - currentEp)
          : (pendingBracketInfo.side === OrderSide.Buy ? curPrice - currentEp : currentEp - curPrice);
        const p = calcPnl(d, contract, oSize);
        return {
          text: `${p >= 0 ? '+' : '-'}$${Math.abs(p).toFixed(2)}`,
          bg: isSl ? SELL_COLOR : BUY_COLOR,
        };
      };
    } else if (pos && !isSameSideEntry) {
      const isLong = pos.type === PositionType.Long;
      const diff = isLong ? price - pos.averagePrice : pos.averagePrice - price;
      const projPnl = calcPnl(diff, contract, oSize);
      initPnlText = `${projPnl >= 0 ? '+' : ''}$${projPnl.toFixed(2)}`;
      initPnlBg = cls.color;

      orderPnlCompute = () => {
        const curPrice = getOrderRefPrice();
        const d = isLong ? curPrice - pos.averagePrice : pos.averagePrice - curPrice;
        const pnl = calcPnl(d, contract, oSize);
        const bg = classifyOrderLine(order, {
          price: curPrice,
          pos,
          pendingBracketInfo,
          previewHideEntry,
          previewSide,
        }).color;
        return { text: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`, bg };
      };
    } else {
      if (oType === OrderType.Stop || oType === OrderType.TrailingStop) {
        initPnlText = 'SL';
        initPnlBg = SELL_COLOR;
      } else {
        initPnlText = oSide === OrderSide.Buy ? 'Buy Limit' : 'Sell Limit';
        initPnlBg = LABEL_BG;
      }
    }

    // ── Cancel onClick ────────────────────────────────────────────────────

    const cancelOrder = order;
    function handleCancel(): void {
      const acct = useStore.getState().activeAccountId;
      if (!acct) return;
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
          (o) =>
            o.status === OrderStatus.Suspended &&
            String(o.contractId) === String(cancelOrder.contractId),
        );
        st.setPendingBracketInfo(null);
        bracketEngine.clearSession();
        for (const leg of bracketLegs) {
          st.removeOrder(leg.id);
          orderService.cancelOrder(acct, leg.id).catch(() => {});
        }
      }
    }

    // ── TP size redistribution cells ──────────────────────────────────────

    const isLiveTP =
      pos &&
      pos.size > 1 &&
      oType === OrderType.Limit &&
      oSide === (pos.type === PositionType.Long ? OrderSide.Sell : OrderSide.Buy);

    primitive.setCell('pnl', { text: initPnlText, bg: initPnlBg, color: LABEL_TEXT });
    primitive.setCell('close', { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT, onClick: handleCancel });

    if (isLiveTP) {
      const oppSide = pos.type === PositionType.Long ? OrderSide.Sell : OrderSide.Buy;
      const allTps = openOrders.filter(
        (o) =>
          String(o.contractId) === String(contract.id) &&
          o.type === OrderType.Limit &&
          o.side === oppSide,
      );
      const totalTpSize = allTps.reduce((sum, o) => sum + o.size, 0);
      const unallocated = pos.size - totalTpSize;
      const minusDisabled = oSize <= 1;
      const plusDisabled = unallocated <= 0;

      async function handleRedistribute(delta: 1 | -1): Promise<void> {
        if (refs.tpRedistInFlight.current) return;
        refs.tpRedistInFlight.current = true;
        const acct = useStore.getState().activeAccountId;
        if (!acct) { refs.tpRedistInFlight.current = false; return; }
        try {
          await orderService.modifyOrder({ accountId: acct, orderId, size: oSize + delta });
          bracketEngine.updateTPSize(orderId, oSize + delta);
        } catch (err) {
          showToast('error', 'Failed to modify TP size', errorMessage(err));
        }
        refs.tpRedistInFlight.current = false;
      }

      primitive.setCell('size', {
        text: String(oSize),
        bg: cls.sizeBg,
        color: LABEL_TEXT,
        leftText: '−',
        leftColor: minusDisabled ? 'transparent' : LABEL_TEXT,
        leftClick: minusDisabled ? undefined : () => handleRedistribute(-1),
        rightText: '+',
        rightColor: plusDisabled ? 'transparent' : LABEL_TEXT,
        rightClick: plusDisabled ? undefined : () => handleRedistribute(1),
      });
    } else {
      primitive.setCell('size', {
        text: String(oSize),
        bg: cls.sizeBg,
        color: LABEL_TEXT,
        leftText: undefined,
        leftColor: undefined,
        leftClick: undefined,
        rightText: undefined,
        rightColor: undefined,
        rightClick: undefined,
      });
    }
    primitive.setCellOrder(['pnl', 'size', 'close']);

    // ── P&L updater ───────────────────────────────────────────────────────

    if (orderPnlCompute) {
      const compute = orderPnlCompute;
      const capturedPrimitive = primitive;
      pnlUpdaters.push(() => {
        const result = compute();
        capturedPrimitive.setCell('pnl', { text: result.text, bg: result.bg, color: LABEL_TEXT });
      });
    }
  }

  // ── Phantom bracket lines ─────────────────────────────────────────────────

  for (const entry of refs.orderEntries.current) {
    const meta = entry.meta;
    if (meta.kind !== 'phantom-bracket') continue;

    const primitive = entry.line;
    const bi = meta.bracketInfo;
    const phantomPrice = entry.price;
    const isSl = meta.bracketType === 'sl';
    const phantomSize = isSl ? bi.orderSize : (bi.tpSizes[meta.tpIndex ?? 0] ?? bi.orderSize);

    const diff = isSl
      ? (bi.side === OrderSide.Buy ? bi.entryPrice - phantomPrice : phantomPrice - bi.entryPrice)
      : (bi.side === OrderSide.Buy ? phantomPrice - bi.entryPrice : bi.entryPrice - phantomPrice);
    const pnl = calcPnl(diff, contract, phantomSize);
    const pnlText = `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`;
    const pnlBg = isSl ? SELL_COLOR : BUY_COLOR;

    const phantomMeta = meta;
    primitive.setCell('pnl', { text: pnlText, bg: pnlBg, color: LABEL_TEXT });
    primitive.setCell('size', { text: String(phantomSize), bg: pnlBg, color: LABEL_TEXT });
    primitive.setCell('close', {
      text: '✕',
      bg: CLOSE_BG,
      color: LABEL_TEXT,
      onClick: () => {
        bracketEngine.handleLegCancel(
          phantomMeta.bracketType === 'sl',
          phantomMeta.tpIndex ?? null,
        );
      },
    });
    primitive.setCellOrder(['pnl', 'size', 'close']);

    const capturedEntry = entry;
    const capturedIsSl = isSl;
    const capturedSize = phantomSize;
    const capturedBi = bi;
    pnlUpdaters.push(() => {
      const curPrice = capturedEntry.price;
      const entryOrdEntry = refs.orderEntries.current.find(
        (e) =>
          e.meta.kind === 'order' &&
          e.meta.order.type === OrderType.Limit &&
          e.meta.order.status !== OrderStatus.Suspended,
      );
      const currentEntryPrice = entryOrdEntry?.price ?? capturedBi.entryPrice;
      const d = capturedIsSl
        ? (capturedBi.side === OrderSide.Buy
          ? currentEntryPrice - curPrice
          : curPrice - currentEntryPrice)
        : (capturedBi.side === OrderSide.Buy
          ? curPrice - currentEntryPrice
          : currentEntryPrice - curPrice);
      const p = calcPnl(d, contract, capturedSize);
      primitive.setCell('pnl', {
        text: `${p >= 0 ? '+' : '-'}$${Math.abs(p).toFixed(2)}`,
        bg: capturedIsSl ? SELL_COLOR : BUY_COLOR,
        color: LABEL_TEXT,
      });
    });
  }

  return { pnlUpdaters, cleanup: () => {} };
}
