import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { orderService, type Order } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { OrderType, OrderSide, PositionType, OrderStatus } from '../../../types/enums';
import { calcPnl, roundToTick } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import type { ChartRefs } from './types';
import { LABEL_TEXT, LABEL_BG, CLOSE_BG, BUY_COLOR, SELL_COLOR, SELL_TEXT, BUY_TEXT, contrastText, classifyOrderLine } from './labelUtils';
import { isBracketLegPrice } from '../../../utils/bracketUtils';

// Guard against double-clicks firing two place calls before the optimistic remove re-renders.
const _trailTogglingIds = new Set<string>();

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

  // diff is always-positive magnitude (SL/TP bracket legs)
  function fmtMagPnl(diff: number, pnl: number): string {
    if (useStore.getState().pnlMode === 'points') {
      return `+${roundToTick(diff, contract.tickSize).toFixed(2)} pts`;
    }
    return `+$${Math.abs(pnl).toFixed(2)}`;
  }

  // diff is naturally signed (live TP/SL relative to position avg)
  function fmtSignedPnl(diff: number, pnl: number): string {
    if (useStore.getState().pnlMode === 'points') {
      const pts = roundToTick(diff, contract.tickSize);
      return `${pts >= 0 ? '+' : ''}${pts.toFixed(2)} pts`;
    }
    return `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
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
      const ts2 = contract.tickSize;

      // Determine if this Suspended leg belongs to the CURRENT bracket (matched by price).
      // Legs from older brackets are shown with static SL/TP labels — we can't compute
      // their PnL correctly because pendingBracketInfo only tracks the latest bracket's entry.
      const isCurrentBracketLeg = isBracketLegPrice(price, ts2, pendingBracketInfo);

      if (isCurrentBracketLeg) {
        const diff = isSl
          ? (pendingBracketInfo.side === OrderSide.Buy ? ep - price : price - ep)
          : (pendingBracketInfo.side === OrderSide.Buy ? price - ep : ep - price);
        const pnl = calcPnl(diff, contract, oSize);
        initPnlText = fmtMagPnl(diff, pnl);
        initPnlBg = isSl ? SELL_COLOR : BUY_COLOR;

        orderPnlCompute = () => {
          const curPrice = getOrderRefPrice();
          // Use the specific pending entry order (not just any non-Suspended limit)
          // so dragging other bracket entries doesn't skew this PnL.
          const pendingId = useStore.getState().pendingEntryOrderId;
          const entryOrdEntry = refs.orderEntries.current.find(
            (e) => e.meta.kind === 'order' && e.meta.order.id === pendingId,
          );
          const currentEp = entryOrdEntry?.price ?? ep;
          const d = isSl
            ? (pendingBracketInfo.side === OrderSide.Buy ? currentEp - curPrice : curPrice - currentEp)
            : (pendingBracketInfo.side === OrderSide.Buy ? curPrice - currentEp : currentEp - curPrice);
          const p = calcPnl(d, contract, oSize);
          return {
            text: fmtMagPnl(d, p),
            bg: isSl ? SELL_COLOR : BUY_COLOR,
          };
        };
      } else {
        // Other-bracket leg: find its sibling entry order and compute PnL from it.
        // SL/TP are on the opposite side from their entry (Buy bracket → Sell SL/TP).
        const isEntryBuy = oSide === OrderSide.Sell;
        const entrySide = isEntryBuy ? OrderSide.Buy : OrderSide.Sell;
        const pendingId = useStore.getState().pendingEntryOrderId;
        const siblingEntry = openOrders.find(
          (o) => String(o.contractId) === String(contract.id) &&
            o.type === OrderType.Limit &&
            o.status !== OrderStatus.Suspended &&
            o.side === entrySide &&
            o.id !== pendingId,
        );
        if (siblingEntry?.limitPrice != null) {
          const ep = siblingEntry.limitPrice;
          const diff = isSl
            ? (isEntryBuy ? ep - price : price - ep)
            : (isEntryBuy ? price - ep : ep - price);
          const pnl = calcPnl(diff, contract, oSize);
          initPnlText = fmtMagPnl(diff, pnl);
          initPnlBg = isSl ? SELL_COLOR : BUY_COLOR;
          orderPnlCompute = () => {
            const curPrice = getOrderRefPrice();
            const curPendingId = useStore.getState().pendingEntryOrderId;
            const siblingEntry2 = refs.orderEntries.current.find(
              (e) => e.meta.kind === 'order' &&
                e.meta.order.type === OrderType.Limit &&
                e.meta.order.status !== OrderStatus.Suspended &&
                e.meta.order.side === entrySide &&
                e.meta.order.id !== curPendingId,
            );
            const currentEp = siblingEntry2?.price ?? ep;
            const d = isSl
              ? (isEntryBuy ? currentEp - curPrice : curPrice - currentEp)
              : (isEntryBuy ? curPrice - currentEp : currentEp - curPrice);
            const p = calcPnl(d, contract, oSize);
            return {
              text: fmtMagPnl(d, p),
              bg: isSl ? SELL_COLOR : BUY_COLOR,
            };
          };
        } else {
          initPnlText = isSl ? 'SL' : 'TP';
          initPnlBg = isSl ? SELL_COLOR : BUY_COLOR;
        }
      }
    } else if (pos && !isSameSideEntry) {
      const isLong = pos.type === PositionType.Long;
      const diff = isLong ? price - pos.averagePrice : pos.averagePrice - price;
      const projPnl = calcPnl(diff, contract, oSize);
      initPnlText = fmtSignedPnl(diff, projPnl);
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
        return { text: fmtSignedPnl(d, pnl), bg };
      };
    } else if (isSuspended) {
      // Suspended leg with no pendingBracketInfo (e.g. after cancelling the current bracket's entry).
      // Find the sibling entry order by side and compute PnL from it.
      const isEntryBuy = oSide === OrderSide.Sell;
      const entrySide = isEntryBuy ? OrderSide.Buy : OrderSide.Sell;
      const isSl2 = oType === OrderType.Stop || oType === OrderType.TrailingStop;
      const siblingEntry = openOrders.find(
        (o) => String(o.contractId) === String(contract.id) &&
          o.type === OrderType.Limit &&
          o.status !== OrderStatus.Suspended &&
          o.side === entrySide,
      );
      if (siblingEntry?.limitPrice != null) {
        const ep2 = siblingEntry.limitPrice;
        const diff = isSl2
          ? (isEntryBuy ? ep2 - price : price - ep2)
          : (isEntryBuy ? price - ep2 : ep2 - price);
        const pnl = calcPnl(diff, contract, oSize);
        initPnlText = fmtMagPnl(diff, pnl);
        initPnlBg = isSl2 ? SELL_COLOR : BUY_COLOR;
        orderPnlCompute = () => {
          const curPrice = getOrderRefPrice();
          const siblingEntry2 = refs.orderEntries.current.find(
            (e) => e.meta.kind === 'order' &&
              e.meta.order.type === OrderType.Limit &&
              e.meta.order.status !== OrderStatus.Suspended &&
              e.meta.order.side === entrySide,
          );
          const currentEp = siblingEntry2?.price ?? ep2;
          const d = isSl2
            ? (isEntryBuy ? currentEp - curPrice : curPrice - currentEp)
            : (isEntryBuy ? curPrice - currentEp : currentEp - curPrice);
          const p = calcPnl(d, contract, oSize);
          return {
            text: fmtMagPnl(d, p),
            bg: isSl2 ? SELL_COLOR : BUY_COLOR,
          };
        };
      } else {
        initPnlText = isSl2 ? 'SL' : 'TP';
        initPnlBg = isSl2 ? SELL_COLOR : BUY_COLOR;
      }
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
      } else if (cls.isEntry) {
        const st = useStore.getState();
        const bi = st.pendingBracketInfo;
        const ts2 = contract.tickSize;
        const isCancellingCurrentEntry = cancelOrder.id === st.pendingEntryOrderId;

        function legMatchesBi(o: typeof openOrders[0]): boolean {
          if (!bi) return false;
          const isSl2 = o.type === OrderType.Stop || o.type === OrderType.TrailingStop;
          const p = isSl2 ? (o.stopPrice ?? 0) : (o.limitPrice ?? 0);
          return isBracketLegPrice(p, ts2, bi);
        }

        if (isCancellingCurrentEntry && bi) {
          // Cancel current bracket's legs and clear state
          const bracketLegs = st.openOrders.filter(
            (o) => o.status === OrderStatus.Suspended &&
              String(o.contractId) === String(cancelOrder.contractId) &&
              legMatchesBi(o),
          );
          st.setPendingBracketInfo(null);
          st.setPendingEntryOrderId(null);
          useStore.setState({ previewEnabled: false, previewHideEntry: false, draftSlPoints: null, draftTpPoints: [] });
          bracketEngine.clearSession();
          for (const leg of bracketLegs) {
            st.removeOrder(leg.id);
            orderService.cancelOrder(acct, leg.id).catch(() => {});
          }
        } else if (!isCancellingCurrentEntry) {
          // Cancel only the other bracket's legs (those not matching pendingBracketInfo)
          const bracketLegs = st.openOrders.filter(
            (o) => o.status === OrderStatus.Suspended &&
              String(o.contractId) === String(cancelOrder.contractId) &&
              !legMatchesBi(o),
          );
          for (const leg of bracketLegs) {
            st.removeOrder(leg.id);
            orderService.cancelOrder(acct, leg.id).catch(() => {});
          }
        }
      }
    }

    // ── Trail toggle (working Stop ↔ TrailingStop only) ───────────────────

    const isWorkingSl = !isSuspended && (oType === OrderType.Stop || oType === OrderType.TrailingStop);

    function handleTrailToggle(): void {
      if (_trailTogglingIds.has(orderId)) return;
      const acct = useStore.getState().activeAccountId;
      if (!acct) return;
      _trailTogglingIds.add(orderId);
      const targetType = oType === OrderType.Stop ? OrderType.TrailingStop : OrderType.Stop;
      useStore.getState().removeOrder(orderId);
      const offsetAtToggle = Math.abs((refs.lastBar.current?.close ?? 0) - price!);
      orderService.trailToggle({
        accountId: acct,
        orderId,
        contractId: String(order.contractId),
        side: oSide,
        size: oSize,
        stopPrice: price!,
        trailPrice: targetType === OrderType.TrailingStop ? price! : undefined,
        targetType,
      }).then(({ orderId: newId }) => {
        if (targetType === OrderType.TrailingStop) {
          useStore.getState().setTrailOffset(newId, offsetAtToggle);
        }
      }).catch((err) => {
        useStore.getState().upsertOrder(order);
        showToast('error', 'Failed to toggle trail', errorMessage(err));
      }).finally(() => {
        _trailTogglingIds.delete(orderId);
      });
    }

    // ── TP size redistribution cells ──────────────────────────────────────

    const isLiveTP =
      pos &&
      pos.size > 1 &&
      oType === OrderType.Limit &&
      oSide === (pos.type === PositionType.Long ? OrderSide.Sell : OrderSide.Buy);

    primitive.setCell('pnl', { text: initPnlText, bg: initPnlBg, color: contrastText(initPnlBg) });
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
      // Only reserve zone space when at least one button is active — both-or-none
      // keeps the digit centred; when both are invisible the cell stays compact
      const showZones = !minusDisabled || !plusDisabled;

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

      const sizeTextColor = contrastText(cls.sizeBg);
      primitive.setCell('size', {
        text: String(oSize),
        bg: cls.sizeBg,
        color: sizeTextColor,
        leftText: showZones ? '−' : undefined,
        leftColor: minusDisabled ? 'transparent' : sizeTextColor,
        leftClick: minusDisabled ? undefined : () => handleRedistribute(-1),
        rightText: showZones ? '+' : undefined,
        rightColor: plusDisabled ? 'transparent' : sizeTextColor,
        rightClick: plusDisabled ? undefined : () => handleRedistribute(1),
      });
    } else {
      primitive.setCell('size', {
        text: String(oSize),
        bg: cls.sizeBg,
        color: contrastText(cls.sizeBg),
        leftText: undefined,
        leftColor: undefined,
        leftClick: undefined,
        rightText: undefined,
        rightColor: undefined,
        rightClick: undefined,
      });
    }

    const trailArrow = oSide === OrderSide.Sell ? '▲' : '▼';
    function getTrailText(): string {
      const offset = useStore.getState().trailOffsets[orderId] ?? 0;
      return `${trailArrow} ${offset.toFixed(2)}`;
    }

    if (isWorkingSl) {
      const isTrail = oType === OrderType.TrailingStop;
      if (isTrail) {
        // Seed the store once for orders that were already trailing at session start
        if (useStore.getState().trailOffsets[orderId] === undefined) {
          const fallback = roundToTick(Math.abs((refs.lastBar.current?.close ?? 0) - getOrderRefPrice()), contract.tickSize);
          useStore.getState().setTrailOffset(orderId, fallback);
        }
        // Compact always-visible arrow + live offset — clicking converts back to regular Stop
        primitive.setCell('trail', {
          text: getTrailText(),
          bg: initPnlBg,
          color: contrastText(initPnlBg),
          hoverText: 'Untrail',
          onClick: handleTrailToggle,
        });
        primitive.setCellOrder(['trail', 'pnl', 'size', 'close']);
        primitive.setHoverPrefixOrder([]);
      } else {
        // "Trail" button hidden at rest, revealed to the left on label hover
        primitive.setCell('trail', {
          text: 'Trail',
          bg: SELL_COLOR,
          color: SELL_TEXT,
          onClick: handleTrailToggle,
        });
        primitive.setCellOrder(['pnl', 'size', 'close']);
        primitive.setHoverPrefixOrder(['trail']);
      }
    } else {
      primitive.setCellOrder(['pnl', 'size', 'close']);
      primitive.setHoverPrefixOrder([]);
    }

    // ── P&L updater ───────────────────────────────────────────────────────

    if (orderPnlCompute) {
      const compute = orderPnlCompute;
      const capturedPrimitive = primitive;
      const isTrailOrder = oType === OrderType.TrailingStop;
      pnlUpdaters.push(() => {
        const result = compute();
        capturedPrimitive.setCell('pnl', { text: result.text, bg: result.bg, color: contrastText(result.bg) });
        if (isTrailOrder) {
          const isDraggingThis = refs.draggingKey.current === `o:${orderId}`;
          capturedPrimitive.setCell('trail', {
            ...(isDraggingThis ? {} : { text: getTrailText() }),
            bg: result.bg,
            color: contrastText(result.bg),
          });
        }
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
    const pnlText = fmtMagPnl(diff, pnl);
    const pnlBg = isSl ? SELL_COLOR : BUY_COLOR;

    const phantomMeta = meta;
    const pnlTextColor = isSl ? SELL_TEXT : BUY_TEXT;
    primitive.setCell('pnl', { text: pnlText, bg: pnlBg, color: pnlTextColor });
    primitive.setCell('size', { text: String(phantomSize), bg: pnlBg, color: pnlTextColor });
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
        text: fmtMagPnl(d, p),
        bg: capturedIsSl ? SELL_COLOR : BUY_COLOR,
        color: capturedIsSl ? SELL_TEXT : BUY_TEXT,
      });
    });
  }

  return { pnlUpdaters, cleanup: () => {} };
}
