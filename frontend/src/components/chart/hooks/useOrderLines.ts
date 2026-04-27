import { useEffect } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { OrderType, OrderSide, OrderStatus } from '../../../types/enums';
import { PriceLevelLine } from '../PriceLevelLine';
import { COLOR_LABEL_BG } from '../../../constants/colors';
import { classifyOrderLine, BUY_COLOR, SELL_COLOR } from './labelUtils';
import { usePreviewLines } from './usePreviewLines';
import { usePreviewDrag } from './usePreviewDrag';
import { useOrderDrag } from './useOrderDrag';
import { usePositionDrag } from './usePositionDrag';
import type { ChartRefs, OrderLineEntry, OrderLineMeta } from './types';

// ── Desired-entry shape (pure data, no DOM) ──────────────

type DesiredEntry = {
  key: string;
  meta: OrderLineMeta;
  price: number;
  color: string;
  lineStyle: 'solid' | 'dashed';
};

// ── Stable key per logical line ──────────────────────────

function entryKey(meta: OrderLineMeta): string {
  if (meta.kind === 'position') return 'pos';
  if (meta.kind === 'order') return `o:${meta.order.id}`;
  if (meta.bracketType === 'sl') return 'phantom:sl';
  return `phantom:tp:${meta.tpIndex ?? 0}`;
}

// ── Reconciler ───────────────────────────────────────────

function reconcileEntries(
  current: OrderLineEntry[],
  desired: DesiredEntry[],
  series: ISeriesApi<'Candlestick'>,
  overlay: HTMLDivElement,
  chart: IChartApi,
  tickSize: number,
  dragKey: string | null,
): OrderLineEntry[] {
  const currentMap = new Map(current.map((e) => [e.key, e]));
  const desiredKeys = new Set(desired.map((d) => d.key));

  // Destroy lines no longer in desired
  for (const e of current) {
    if (!desiredKeys.has(e.key)) e.line.destroy();
  }

  // Build result in desired order
  return desired.map((d) => {
    const existing = currentMap.get(d.key);
    // Preserve dragged price — don't snap back to server price mid-drag
    const isDragging = dragKey === d.key && existing != null;
    const price = isDragging ? existing!.price : d.price;

    if (existing) {
      existing.line.setPrice(price);
      existing.line.setLineColor(d.color);
      existing.line.setLineStyle(d.lineStyle);
      existing.price = price;
      existing.meta = d.meta;
      return existing;
    }

    return {
      key: d.key,
      line: new PriceLevelLine({
        price: d.price,
        series, overlay, chartApi: chart,
        lineColor: d.color,
        lineStyle: d.lineStyle,
        lineWidth: 1,
        axisLabelVisible: true,
        tickSize,
      }),
      meta: d.meta,
      price: d.price,
    };
  });
}

// ── Desired-entry computation ────────────────────────────

function computeDesired(
  contract: Contract,
  openOrders: ReturnType<typeof useStore.getState>['openOrders'],
  positions: ReturnType<typeof useStore.getState>['positions'],
  activeAccountId: string | null,
  pendingBracketInfo: ReturnType<typeof useStore.getState>['pendingBracketInfo'],
  previewHideEntry: boolean,
  previewSide: number,
): DesiredEntry[] {
  const desired: DesiredEntry[] = [];
  const tickSize = contract.tickSize;

  const pos = positions.find(
    (p) => p.accountId === activeAccountId
      && String(p.contractId) === String(contract.id)
      && p.size > 0,
  );

  // Position entry line
  if (pos) {
    desired.push({
      key: 'pos',
      meta: { kind: 'position' },
      price: pos.averagePrice,
      color: COLOR_LABEL_BG,
      lineStyle: 'solid',
    });
  }

  // Open order lines
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
    }

    const cls = classifyOrderLine(order, { price, pos, pendingBracketInfo, previewHideEntry, previewSide });
    desired.push({
      key: `o:${order.id}`,
      meta: { kind: 'order', order },
      price,
      color: cls.color,
      lineStyle: cls.isSuspendedBracketLeg ? 'dashed' : 'solid',
    });
  }

  // Phantom bracket lines
  if (pendingBracketInfo && !previewHideEntry) {
    const bi = pendingBracketInfo;

    if (bi.slPrice != null && !coveredBracketPrices.has(Math.round(bi.slPrice / tickSize))) {
      desired.push({
        key: 'phantom:sl',
        meta: { kind: 'phantom-bracket', bracketType: 'sl', bracketInfo: bi },
        price: bi.slPrice,
        color: SELL_COLOR,
        lineStyle: 'dashed',
      });
    }

    for (let i = 0; i < bi.tpPrices.length; i++) {
      const tpPrice = bi.tpPrices[i];
      if (!coveredBracketPrices.has(Math.round(tpPrice / tickSize))) {
        desired.push({
          key: `phantom:tp:${i}`,
          meta: { kind: 'phantom-bracket', bracketType: 'tp', tpIndex: i, bracketInfo: bi },
          price: tpPrice,
          color: BUY_COLOR,
          lineStyle: 'dashed',
        });
      }
    }
  }

  return desired;
}

// ── Hook ─────────────────────────────────────────────────

/**
 * Orchestrator for all chart price-level lines.
 * Reconciles live order/position lines in-place (no destroy-and-rebuild on every
 * state change), preserving drag state across store updates.
 */
export function useOrderLines(refs: ChartRefs, contract: Contract | null, isOrderChart: boolean): void {
  usePreviewLines(refs, contract, isOrderChart);
  usePreviewDrag(refs, contract, isOrderChart);
  useOrderDrag(refs, contract, isOrderChart);
  usePositionDrag(refs, contract, isOrderChart);

  const openOrders = useStore((s) => s.openOrders);
  const positions = useStore((s) => s.positions);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const pendingBracketInfo = useStore((s) => s.pendingBracketInfo);
  const previewHideEntry = useStore((s) => s.previewHideEntry);
  const previewSide = useStore((s) => s.previewSide);

  // Reconcile on state changes — no cleanup returned, reconciler handles transitions
  useEffect(() => {
    if (!isOrderChart) {
      refs.orderEntries.current.forEach((e) => e.line.destroy());
      refs.orderEntries.current = [];
      return;
    }

    const series = refs.series.current;
    const overlay = refs.overlay.current;
    const chart = refs.chart.current;
    if (!series || !overlay || !chart) return;

    if (!contract) {
      refs.orderEntries.current.forEach((e) => e.line.destroy());
      refs.orderEntries.current = [];
      return;
    }

    const desired = computeDesired(
      contract, openOrders, positions, activeAccountId,
      pendingBracketInfo, previewHideEntry, previewSide,
    );

    const dragKey = refs.orderDragState.current?.key ?? null;

    refs.orderEntries.current = reconcileEntries(
      refs.orderEntries.current,
      desired,
      series, overlay, chart, contract.tickSize,
      dragKey,
    );
  }, [isOrderChart, openOrders, positions, contract, activeAccountId, pendingBracketInfo, previewHideEntry, previewSide]);

  // Destroy all lines on unmount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    refs.orderEntries.current.forEach((e) => e.line.destroy());
    refs.orderEntries.current = [];
  }, []);
}
