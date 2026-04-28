import { useEffect } from 'react';
import type { ISeriesApi } from 'lightweight-charts';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { OrderType, OrderSide, OrderStatus, PositionType } from '../../../types/enums';
import { PriceLevelPrimitive } from '../primitives/PriceLevelPrimitive';
import type { PriceLevelCell } from '../primitives/PriceLevelPrimitive';
import { calcPnl, pointsToPrice } from '../../../utils/instrument';
import { COLOR_LABEL_BG, COLOR_TEXT_MUTED } from '../../../constants/colors';
import { classifyOrderLine, BUY_COLOR, SELL_COLOR, LABEL_TEXT, LABEL_BG, CLOSE_BG } from './labelUtils';
import { resolvePreviewConfig } from './resolvePreviewConfig';
import { orderService } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { showToast, errorMessage } from '../../../utils/toast';
import { debugLog } from '../../../utils/debugLog';
import { usePreviewLines } from './usePreviewLines';
import { usePreviewDrag } from './usePreviewDrag';
import { usePositionDrag } from './usePositionDrag';
import type { ChartRefs, OrderLineEntry, OrderLineMeta } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

type DesiredEntry = {
  key: string;
  meta: OrderLineMeta;
  price: number;
  color: string;
  lineStyle: 'solid' | 'dashed';
  labelPos: 'mid' | 'right';
  initialCells: Record<string, PriceLevelCell>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function snapPrice(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

function detachPositionDependentLines(
  refs: ChartRefs,
  series: ISeriesApi<'Candlestick'>,
): void {
  const keep: OrderLineEntry[] = [];
  for (const e of refs.orderEntries.current) {
    const isPositionRelatedLimit =
      e.meta.kind === 'order' &&
      e.meta.order.type === OrderType.Limit &&
      refs.labelPosCache.current.get(e.meta.order.id) === 'mid';

    const remove =
      e.meta.kind === 'position' ||
      e.meta.kind === 'phantom-bracket' ||
      isPositionRelatedLimit ||
      (e.meta.kind === 'order' && (
        e.meta.order.status === OrderStatus.Suspended ||
        e.meta.order.type === OrderType.Stop ||
        e.meta.order.type === OrderType.TrailingStop
      ));
    if (remove) {
      series.detachPrimitive(e.line);
    } else {
      keep.push(e);
    }
  }
  refs.orderEntries.current = keep;
}

// ── Drag callbacks ────────────────────────────────────────────────────────────

function buildDragCallbacks(
  key: string,
  meta: OrderLineMeta,
  contract: Contract,
  refs: ChartRefs,
): {
  onDragStart: (originalPrice: number) => void;
  onDrag: (price: number) => void;
  onDragEnd: (newPrice: number) => void;
} {
  const ts = contract.tickSize;
  const dragState = { originalPrice: 0 };

  function onDragStart(originalPrice: number): void {
    refs.isDragging.current = true;
    refs.draggingKey.current = key;
    dragState.originalPrice = originalPrice;

    if (meta.kind === 'position') {
      const st = useStore.getState();
      const pos = st.positions.find(
        (p) => p.accountId === st.activeAccountId
          && String(p.contractId) === String(contract.id) && p.size > 0,
      );
      if (pos) {
        refs.posDrag.current = {
          isLong: pos.type === PositionType.Long,
          posSize: pos.size,
          avgPrice: pos.averagePrice,
          direction: null,
          snappedPrice: pos.averagePrice,
        };
      }
    }
  }

  function onDrag(rawPrice: number): void {
    if (meta.kind === 'position') return; // usePositionDrag handles position drag

    const snapped = snapPrice(rawPrice, ts);
    const entry = refs.orderEntries.current.find((e) => e.key === key);
    if (!entry) return;
    entry.line.setPrice(snapped);
    entry.price = snapped;

    const st = useStore.getState();
    const pos = st.positions.find(
      (p) => p.accountId === st.activeAccountId
        && String(p.contractId) === String(contract.id) && p.size > 0,
    );

    // Update color relative to position
    if (pos && meta.kind === 'order') {
      const isL = pos.type === PositionType.Long;
      entry.line.setLineColor(
        (isL ? snapped >= pos.averagePrice : snapped <= pos.averagePrice) ? BUY_COLOR : SELL_COLOR,
      );
    }

    // Sibling-follow: always shift all Suspended bracket legs (no pendingBracketInfo gate)
    if (
      meta.kind === 'order' &&
      meta.order.type === OrderType.Limit &&
      meta.order.status !== OrderStatus.Suspended
    ) {
      const delta = snapped - dragState.originalPrice;
      for (const bracketEntry of refs.orderEntries.current) {
        if (bracketEntry.key === key) continue;
        if (bracketEntry.meta.kind === 'order') {
          if (bracketEntry.meta.order.status !== OrderStatus.Suspended) continue;
          if (String(bracketEntry.meta.order.contractId) !== String(contract.id)) continue;
          const origPrice = bracketEntry.meta.order.stopPrice ?? bracketEntry.meta.order.limitPrice ?? 0;
          bracketEntry.line.setPrice(origPrice + delta);
          bracketEntry.price = origPrice + delta;
        } else if (bracketEntry.meta.kind === 'phantom-bracket') {
          const origPrice = bracketEntry.meta.bracketType === 'sl'
            ? (bracketEntry.meta.bracketInfo.slPrice ?? 0)
            : (bracketEntry.meta.bracketInfo.tpPrices[bracketEntry.meta.tpIndex ?? 0] ?? 0);
          bracketEntry.line.setPrice(origPrice + delta);
          bracketEntry.price = origPrice + delta;
        }
      }
    }

    // Shift preview lines when entry is dragged with hidden-entry active
    if (
      meta.kind === 'order' &&
      meta.order.type === OrderType.Limit &&
      meta.order.status !== OrderStatus.Suspended &&
      st.previewHideEntry
    ) {
      refs.previewPrices.current[0] = snapped;
      const toP = (points: number) => pointsToPrice(points, contract);
      const cfg = resolvePreviewConfig();
      const pvSide = st.previewSide;
      let idx = 1;
      if (cfg) {
        if (cfg.stopLoss.points > 0) {
          const slPrice = pvSide === OrderSide.Buy
            ? snapped - toP(cfg.stopLoss.points)
            : snapped + toP(cfg.stopLoss.points);
          const slLine = refs.previewLines.current[idx];
          if (slLine) { slLine.setPrice(slPrice); slLine.syncPosition(); }
          refs.previewPrices.current[idx] = slPrice;
          idx++;
        }
        cfg.takeProfits.forEach((tp) => {
          const tpPrice = pvSide === OrderSide.Buy
            ? snapped + toP(tp.points)
            : snapped - toP(tp.points);
          const tpLine = refs.previewLines.current[idx];
          if (tpLine) { tpLine.setPrice(tpPrice); tpLine.syncPosition(); }
          refs.previewPrices.current[idx] = tpPrice;
          idx++;
        });
      }
    }

    refs.scheduleOverlaySync.current();
  }

  function onDragEnd(rawNewPrice: number): void {
    if (meta.kind === 'position') {
      refs.isDragging.current = false;
      refs.draggingKey.current = null;
      return; // usePositionDrag handles placement
    }

    const snapped = snapPrice(rawNewPrice, ts);
    const originalPrice = dragState.originalPrice;

    debugLog.log('drag:mouseup-raw', {
      key,
      originalPrice,
      newPrice: snapped,
      metaKind: meta.kind,
      status: meta.kind === 'order' ? meta.order.status : null,
      samePrice: snapped === originalPrice,
    });

    if (snapped === originalPrice) {
      refs.isDragging.current = false;
      refs.draggingKey.current = null;
      return;
    }

    // Phantom bracket — delegate to bracketEngine
    if (meta.kind === 'phantom-bracket') {
      bracketEngine.handleLegModify(snapped, meta.bracketType === 'sl', meta.tpIndex ?? null, contract);
      refs.isDragging.current = false;
      refs.draggingKey.current = null;
      return;
    }

    if (meta.kind !== 'order') {
      refs.isDragging.current = false;
      refs.draggingKey.current = null;
      return;
    }

    const { order } = meta;
    const accountId = useStore.getState().activeAccountId;
    if (!accountId) {
      refs.isDragging.current = false;
      refs.draggingKey.current = null;
      return;
    }

    // Stop above market — close position instead
    if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
      const currentPrice = useStore.getState().lastPrice ?? refs.lastBar.current?.close ?? null;
      if (currentPrice != null) {
        const protectsLong = order.side === OrderSide.Sell;
        const invalid = protectsLong ? snapped >= currentPrice : snapped <= currentPrice;
        if (invalid) {
          showToast('info', 'Stop above market — closing position');
          refs.isDragging.current = false;
          refs.draggingKey.current = null;
          const revertEntry = refs.orderEntries.current.find((e) => e.key === key);
          if (revertEntry) {
            revertEntry.line.setPrice(originalPrice);
            revertEntry.line.setLineColor(SELL_COLOR);
            revertEntry.price = originalPrice;
            refs.updateOverlay.current();
          }
          const posToClose = useStore.getState().positions.find(
            (p) => p.accountId === accountId && String(p.contractId) === String(contract.id) && p.size > 0,
          );
          if (posToClose) {
            orderService.placeOrder({
              accountId,
              contractId: contract.id,
              type: OrderType.Market,
              side: protectsLong ? OrderSide.Sell : OrderSide.Buy,
              size: posToClose.size,
            }).catch((err) => showToast('error', 'Close position failed', errorMessage(err)));
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
      params.stopPrice = snapped;
    } else if (order.type === OrderType.Limit) {
      params.limitPrice = snapped;
    }

    const isEntry = order.type === OrderType.Limit && order.status !== OrderStatus.Suspended;
    const wasHideEntry = isEntry && useStore.getState().previewHideEntry;
    const prevBi = isEntry && !wasHideEntry ? useStore.getState().pendingBracketInfo : null;

    // Optimistically update bracket info and entry price
    if (prevBi) {
      const d = snapped - originalPrice;
      useStore.getState().setPendingBracketInfo({
        ...prevBi,
        entryPrice: prevBi.entryPrice + d,
        slPrice: prevBi.slPrice != null ? prevBi.slPrice + d : null,
        tpPrices: prevBi.tpPrices.map((p) => p + d),
      });
      const st = useStore.getState();
      st.upsertOrder({ ...order, limitPrice: snapped });
      for (const leg of st.openOrders) {
        if (leg.status !== OrderStatus.Suspended || String(leg.contractId) !== String(contract.id)) continue;
        const isSl = leg.type === OrderType.Stop || leg.type === OrderType.TrailingStop;
        st.upsertOrder(
          isSl
            ? { ...leg, stopPrice: (leg.stopPrice ?? 0) + d }
            : { ...leg, limitPrice: (leg.limitPrice ?? 0) + d },
        );
      }
    }
    if (wasHideEntry) {
      useStore.getState().setLimitPrice(snapped);
    }

    // Suspended bracket leg — update bracketEngine
    if (order.status === OrderStatus.Suspended) {
      const st = useStore.getState();
      const isSl = order.type === OrderType.Stop || order.type === OrderType.TrailingStop;
      st.upsertOrder(isSl ? { ...order, stopPrice: snapped } : { ...order, limitPrice: snapped });
      const bi = st.pendingBracketInfo;
      const cls = classifyOrderLine(order, {
        price: originalPrice,
        pos: st.positions.find(
          (p) => p.accountId === st.activeAccountId
            && String(p.contractId) === String(contract.id) && p.size > 0,
        ),
        pendingBracketInfo: bi,
        previewHideEntry: st.previewHideEntry,
        previewSide: st.previewSide,
      });
      bracketEngine.handleLegModify(snapped, cls.isSl, cls.tpIndex, contract);
    }

    debugLog.log('drag:complete', {
      key,
      finalPrice: snapped,
      bi: useStore.getState().pendingBracketInfo,
      storeOrder: useStore.getState().openOrders.find(
        (o) => meta.kind === 'order' && o.id === meta.order.id,
      ),
    });

    refs.isDragging.current = false;
    refs.draggingKey.current = null;

    orderService.modifyOrder(params).catch((err) => {
      showToast('error', 'Order modification failed', errorMessage(err));
      const revertEntry = refs.orderEntries.current.find((e) => e.key === key);
      if (revertEntry) {
        const st = useStore.getState();
        const pos = st.positions.find(
          (p) => p.accountId === accountId
            && String(p.contractId) === String(contract.id) && p.size > 0,
        );
        revertEntry.line.setPrice(originalPrice);
        revertEntry.line.setLineColor(
          classifyOrderLine(order, {
            price: originalPrice,
            pos: pos ?? undefined,
            pendingBracketInfo: st.pendingBracketInfo,
            previewHideEntry: st.previewHideEntry,
            previewSide: st.previewSide,
          }).color,
        );
        revertEntry.price = originalPrice;
        refs.updateOverlay.current();
      }
      if (prevBi) {
        useStore.getState().setPendingBracketInfo(prevBi);
        useStore.getState().upsertOrder({ ...order, limitPrice: originalPrice });
      }
      if (wasHideEntry) {
        refs.previewPrices.current[0] = originalPrice;
        useStore.getState().setLimitPrice(originalPrice);
      }
    });
  }

  return { onDragStart, onDrag, onDragEnd };
}

// ── Attach / detach helpers ───────────────────────────────────────────────────

function attachPrimitive(
  p: PriceLevelPrimitive,
  series: ISeriesApi<'Candlestick'>,
  refs: ChartRefs,
): void {
  series.attachPrimitive(p);
  const el = refs.container.current;
  if (el) p.setChartElement(el);
}

// ── Compute desired order/phantom entries (no position entry) ─────────────────

function computeOrderDesired(
  contract: Contract,
  openOrders: ReturnType<typeof useStore.getState>['openOrders'],
  pos: ReturnType<typeof useStore.getState>['positions'][0] | undefined,
  pendingBracketInfo: ReturnType<typeof useStore.getState>['pendingBracketInfo'],
  previewHideEntry: boolean,
  previewSide: number,
  labelPosCache: Map<string, 'right' | 'mid'>,
): DesiredEntry[] {
  const desired: DesiredEntry[] = [];
  const tickSize = contract.tickSize;
  const coveredBracketPrices = new Set<number>();
  const hideBracketSide = previewHideEntry
    ? (previewSide === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy)
    : null;

  for (const order of openOrders) {
    if (order.contractId !== contract.id) continue;
    if (hideBracketSide != null && order.side === hideBracketSide) continue;

    let price: number | undefined;
    if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
      price = order.stopPrice;
    } else if (order.type === OrderType.Limit) {
      price = order.limitPrice;
    } else {
      continue;
    }
    if (price == null) continue;

    if (order.status === OrderStatus.Suspended) {
      coveredBracketPrices.add(Math.round(price / tickSize));
      // Bracket legs are always 'mid'; pre-populate so the cache survives the
      // race window where the order activates before `positions` arrives.
      if (order.type === OrderType.Limit) labelPosCache.set(order.id, 'mid');
    }

    // In the race window after position closes but before orders cancel, skip
    // bracket orders so they don't flash with stale "SL" / "Sell Limit" text.
    if (!pos) {
      if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) continue;
      if (order.type === OrderType.Limit && labelPosCache.get(order.id) === 'mid') continue;
    }

    const cls = classifyOrderLine(order, { price, pos, pendingBracketInfo, previewHideEntry, previewSide });

    // Cache label position when pos is known
    if (pos && order.type === OrderType.Limit) {
      const isTP =
        (pos.type === PositionType.Long && order.side === OrderSide.Sell) ||
        (pos.type === PositionType.Short && order.side === OrderSide.Buy);
      labelPosCache.set(order.id, isTP ? 'mid' : 'right');
    }
    let labelPos: 'mid' | 'right' = 'mid';
    if (order.type === OrderType.Limit) {
      if (pos != null) {
        const isTP =
          (pos.type === PositionType.Long && order.side === OrderSide.Sell) ||
          (pos.type === PositionType.Short && order.side === OrderSide.Buy);
        labelPos = isTP ? 'mid' : 'right';
      } else {
        labelPos = labelPosCache.get(order.id) ?? 'right';
      }
    }

    // Compute initial P&L text + bg
    const isSuspended = order.status === OrderStatus.Suspended;
    let pnlText = '---';
    let pnlBg = cls.color;
    const sizeBg = cls.sizeBg;
    const isSameSideEntry =
      pos != null &&
      order.type === OrderType.Limit &&
      (
        (pos.type === PositionType.Long && order.side === OrderSide.Buy) ||
        (pos.type === PositionType.Short && order.side === OrderSide.Sell)
      );

    if (isSuspended && pendingBracketInfo) {
      const ep = pendingBracketInfo.entryPrice;
      const diff = cls.isSl
        ? (pendingBracketInfo.side === OrderSide.Buy ? ep - price : price - ep)
        : (pendingBracketInfo.side === OrderSide.Buy ? price - ep : ep - price);
      const pnl = calcPnl(diff, contract, order.size);
      pnlText = `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`;
      pnlBg = cls.isSl ? SELL_COLOR : BUY_COLOR;
    } else if (pos && !isSameSideEntry) {
      const isLong = pos.type === PositionType.Long;
      const diff = isLong ? price - pos.averagePrice : pos.averagePrice - price;
      const projPnl = calcPnl(diff, contract, order.size);
      pnlText = `${projPnl >= 0 ? '+' : ''}$${projPnl.toFixed(2)}`;
      pnlBg = cls.color;
    } else if (!pos) {
      if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
        pnlText = 'SL';
        pnlBg = SELL_COLOR;
      } else if (!isSuspended) {
        pnlText = order.side === OrderSide.Buy ? 'Buy Limit' : 'Sell Limit';
        pnlBg = LABEL_BG;
      }
    }

    desired.push({
      key: `o:${order.id}`,
      meta: { kind: 'order', order },
      price,
      color: cls.color,
      lineStyle: cls.isSuspendedBracketLeg ? 'dashed' : 'solid',
      labelPos,
      initialCells: {
        pnl: { text: pnlText, bg: pnlBg, color: LABEL_TEXT },
        size: { text: String(order.size), bg: sizeBg, color: LABEL_TEXT },
        close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT },
      },
    });
  }

  // Phantom bracket lines (pendingBracketInfo not yet backed by real orders)
  if (pendingBracketInfo && !previewHideEntry) {
    const bi = pendingBracketInfo;

    if (bi.slPrice != null && !coveredBracketPrices.has(Math.round(bi.slPrice / tickSize))) {
      const diff = bi.side === OrderSide.Buy
        ? bi.entryPrice - bi.slPrice
        : bi.slPrice - bi.entryPrice;
      const pnl = calcPnl(diff, contract, bi.orderSize);
      desired.push({
        key: 'phantom:sl',
        meta: { kind: 'phantom-bracket', bracketType: 'sl', bracketInfo: bi },
        price: bi.slPrice,
        color: SELL_COLOR,
        lineStyle: 'dashed',
        labelPos: 'mid',
        initialCells: {
          pnl: { text: `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`, bg: SELL_COLOR, color: LABEL_TEXT },
          size: { text: String(bi.orderSize), bg: SELL_COLOR, color: LABEL_TEXT },
          close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT },
        },
      });
    }

    for (let i = 0; i < bi.tpPrices.length; i++) {
      const tpPrice = bi.tpPrices[i];
      if (!coveredBracketPrices.has(Math.round(tpPrice / tickSize))) {
        const tpSize = bi.tpSizes[i] ?? bi.orderSize;
        const diff = bi.side === OrderSide.Buy
          ? tpPrice - bi.entryPrice
          : bi.entryPrice - tpPrice;
        const pnl = calcPnl(diff, contract, tpSize);
        desired.push({
          key: `phantom:tp:${i}`,
          meta: { kind: 'phantom-bracket', bracketType: 'tp', tpIndex: i, bracketInfo: bi },
          price: tpPrice,
          color: BUY_COLOR,
          lineStyle: 'dashed',
          labelPos: 'mid',
          initialCells: {
            pnl: { text: `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`, bg: BUY_COLOR, color: LABEL_TEXT },
            size: { text: String(tpSize), bg: BUY_COLOR, color: LABEL_TEXT },
            close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT },
          },
        });
      }
    }
  }

  return desired;
}

// ── Reconcile order/phantom entries ──────────────────────────────────────────

function reconcileOrderEntries(
  current: OrderLineEntry[],
  desired: DesiredEntry[],
  series: ISeriesApi<'Candlestick'>,
  contract: Contract,
  refs: ChartRefs,
): OrderLineEntry[] {
  const currentMap = new Map(current.map((e) => [e.key, e]));
  const desiredKeys = new Set(desired.map((d) => d.key));
  const draggingKey = refs.draggingKey.current;

  for (const e of current) {
    if (!desiredKeys.has(e.key)) series.detachPrimitive(e.line);
  }

  return desired.map((d) => {
    const existing = currentMap.get(d.key);
    const isDragging = draggingKey === d.key && existing != null;

    if (existing) {
      if (!isDragging) {
        existing.line.setPrice(d.price);
        existing.price = d.price;
      }
      existing.line.setLineColor(d.color);
      existing.line.setLineStyle(d.lineStyle);
      existing.line.setLabelPosition(d.labelPos);
      existing.meta = d.meta;
      return existing;
    }

    const { onDragStart, onDrag, onDragEnd } = buildDragCallbacks(d.key, d.meta, contract, refs);
    const p = new PriceLevelPrimitive({
      price: d.price,
      cellOrder: ['pnl', 'size', 'close'],
      cells: d.initialCells,
      labelPosition: d.labelPos,
      lineColor: d.color,
      lineWidth: 1,
      lineStyle: d.lineStyle,
      priceLabel: { visible: true, tickSize: contract.tickSize },
      onDragStart,
      onDrag,
      onDragEnd,
      allowPriceMove: true,
    });
    attachPrimitive(p, series, refs);

    return { key: d.key, line: p, meta: d.meta, price: d.price };
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useOrderLines(refs: ChartRefs, contract: Contract | null, isOrderChart: boolean): void {
  usePreviewLines(refs, contract, isOrderChart);
  usePreviewDrag(refs, contract, isOrderChart);
  usePositionDrag(refs, contract, isOrderChart);

  const positions = useStore((s) => s.positions);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const openOrders = useStore((s) => s.openOrders);
  const pendingBracketInfo = useStore((s) => s.pendingBracketInfo);
  const previewHideEntry = useStore((s) => s.previewHideEntry);
  const previewSide = useStore((s) => s.previewSide);

  // ── Effect 1: position line ──────────────────────────────────────────────
  // Deps: positions. When pos closes, immediately cleans up position-dependent lines
  // so Effect 2 doesn't see stale bracket entries before openOrders clears.
  useEffect(() => {
    if (!isOrderChart) return;
    const series = refs.series.current;
    if (!series || !contract) return;

    const pos = positions.find(
      (p) => p.accountId === activeAccountId
        && String(p.contractId) === String(contract.id) && p.size > 0,
    );

    if (!pos) {
      detachPositionDependentLines(refs, series);
      return;
    }

    // Update existing position entry
    const existingIdx = refs.orderEntries.current.findIndex((e) => e.meta.kind === 'position');
    if (existingIdx >= 0) {
      const existing = refs.orderEntries.current[existingIdx];
      if (refs.draggingKey.current !== 'pos') {
        existing.line.setPrice(pos.averagePrice);
        existing.price = pos.averagePrice;
      }
      existing.meta = { kind: 'position' };
      return;
    }

    // Compute initial P&L (never flash '---')
    const isLong = pos.type === PositionType.Long;
    const sideBg = isLong ? BUY_COLOR : SELL_COLOR;
    const lp = useStore.getState().lastPrice;
    let initText: string;
    let initBg: string;
    if (lp != null) {
      const diff = isLong ? lp - pos.averagePrice : pos.averagePrice - lp;
      const initPnl = calcPnl(diff, contract, pos.size);
      initText = `${initPnl >= 0 ? '+' : ''}$${initPnl.toFixed(2)}`;
      initBg = initPnl >= 0 ? BUY_COLOR : SELL_COLOR;
      refs.lastPnlCache.current = { text: initText, bg: initBg };
    } else if (refs.lastPnlCache.current.text) {
      initText = refs.lastPnlCache.current.text;
      initBg = refs.lastPnlCache.current.bg;
    } else {
      initText = '---';
      initBg = COLOR_TEXT_MUTED;
    }

    const { onDragStart, onDrag, onDragEnd } = buildDragCallbacks('pos', { kind: 'position' }, contract, refs);
    const p = new PriceLevelPrimitive({
      price: pos.averagePrice,
      cellOrder: ['pnl', 'size', 'close'],
      cells: {
        pnl: { text: initText, bg: initBg, color: LABEL_TEXT },
        size: { text: String(pos.size), bg: sideBg, color: LABEL_TEXT },
        close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT },
      },
      labelPosition: 'right',
      lineColor: COLOR_LABEL_BG,
      lineWidth: 1,
      lineStyle: 'solid',
      priceLabel: { visible: true, tickSize: contract.tickSize },
      onDragStart,
      onDrag,
      onDragEnd,
      allowPriceMove: false,
    });
    attachPrimitive(p, series, refs);

    refs.orderEntries.current = [
      { key: 'pos', line: p, meta: { kind: 'position' }, price: pos.averagePrice },
      ...refs.orderEntries.current,
    ];
  }, [isOrderChart, positions, activeAccountId, contract]);

  // ── Effect 2: order / phantom lines ─────────────────────────────────────
  // Deps: openOrders (NOT positions). Reads pos synchronously from store so this
  // effect does not rerun — and never flashes '---' — when only positions changes.
  useEffect(() => {
    if (!isOrderChart) {
      const series = refs.series.current;
      if (series) refs.orderEntries.current.forEach((e) => series.detachPrimitive(e.line));
      refs.orderEntries.current = [];
      return;
    }
    const series = refs.series.current;
    if (!series) return;
    if (!contract) {
      refs.orderEntries.current.forEach((e) => series.detachPrimitive(e.line));
      refs.orderEntries.current = [];
      return;
    }

    const st = useStore.getState();
    const pos = st.positions.find(
      (p) => p.accountId === st.activeAccountId
        && String(p.contractId) === String(contract.id) && p.size > 0,
    );

    const orderEntries = refs.orderEntries.current.filter((e) => e.meta.kind !== 'position');
    const posEntry = refs.orderEntries.current.find((e) => e.meta.kind === 'position');

    const desired = computeOrderDesired(
      contract, openOrders, pos, pendingBracketInfo, previewHideEntry, previewSide,
      refs.labelPosCache.current,
    );

    const reconciledOrders = reconcileOrderEntries(orderEntries, desired, series, contract, refs);

    refs.orderEntries.current = posEntry ? [posEntry, ...reconciledOrders] : reconciledOrders;
  }, [isOrderChart, openOrders, contract, pendingBracketInfo, previewHideEntry, previewSide, activeAccountId]);

  // Unmount cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    const series = refs.series.current;
    if (series) refs.orderEntries.current.forEach((e) => series.detachPrimitive(e.line));
    refs.orderEntries.current = [];
  }, []);
}
