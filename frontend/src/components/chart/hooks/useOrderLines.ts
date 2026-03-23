import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { OrderType, OrderStatus } from '../../../types/enums';
import { PriceLevelLine } from '../PriceLevelLine';
import { COLOR_LABEL_BG } from '../../../constants/colors';
import { computeOrderLineColor, BUY_COLOR, SELL_COLOR } from './labelUtils';
import { usePreviewLines } from './usePreviewLines';
import { usePreviewDrag } from './usePreviewDrag';
import { useOrderDrag } from './useOrderDrag';
import { usePositionDrag } from './usePositionDrag';
import type { ChartRefs } from './types';

/**
 * Orchestrator for all chart price-level lines.
 * Delegates to focused sub-hooks for preview lifecycle, drag interactions,
 * and position drag-to-create. Directly manages live order/position lines.
 *
 * Also renders "phantom" bracket lines from pendingBracketInfo for prices that
 * have no matching order in openOrders[] (engine-managed TPs before fill,
 * or after refresh when REST doesn't return Suspended legs).
 */
export function useOrderLines(refs: ChartRefs, contract: Contract | null, isOrderChart: boolean): void {
  // -- Delegate to sub-hooks --
  usePreviewLines(refs, contract, isOrderChart);
  usePreviewDrag(refs, contract, isOrderChart);
  useOrderDrag(refs, contract, isOrderChart);
  usePositionDrag(refs, contract, isOrderChart);

  // -- Live order & position lines (always visible) --
  const openOrders = useStore((s) => s.openOrders);
  const positions = useStore((s) => s.positions);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const pendingBracketInfo = useStore((s) => s.pendingBracketInfo);

  useEffect(() => {
    if (!isOrderChart) return;
    const series = refs.series.current;
    const overlay = refs.overlay.current;
    const chart = refs.chart.current;
    if (!series || !overlay || !chart) return;

    // Tear down previous
    refs.orderLines.current.forEach((l) => l.destroy());
    refs.orderLines.current = [];
    refs.orderLineMeta.current = [];
    refs.orderLinePrices.current = [];

    if (!contract) return;

    const tickSize = contract.tickSize;

    // Position entry line (not draggable)
    const pos = positions.find(
      (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
    );
    if (pos) {
      refs.orderLines.current.push(new PriceLevelLine({
        price: pos.averagePrice,
        series, overlay, chartApi: chart,
        lineColor: COLOR_LABEL_BG, lineStyle: 'solid', lineWidth: 1,
        axisLabelVisible: true, tickSize,
      }));
      refs.orderLineMeta.current.push({ kind: 'position' });
      refs.orderLinePrices.current.push(pos.averagePrice);
    }

    // Open order lines (draggable)
    // Track which bracket prices from pendingBracketInfo are covered by real orders
    const coveredBracketPrices = new Set<number>();

    for (const order of openOrders) {
      if (order.contractId !== contract.id) continue;

      let price: number | undefined;

      if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
        price = order.stopPrice;
      } else if (order.type === OrderType.Limit) {
        price = order.limitPrice;
      } else {
        continue;
      }

      if (price == null) continue;

      // Track this price so we don't duplicate it with a phantom line
      if (order.status === OrderStatus.Suspended) {
        coveredBracketPrices.add(Math.round(price / tickSize));
      }

      const isSuspended = order.status === OrderStatus.Suspended;
      // Bracket legs: color by role (SL=red, TP=green), not by order side
      let color: string;
      if (isSuspended && pendingBracketInfo) {
        const isSl = order.type === OrderType.Stop || order.type === OrderType.TrailingStop;
        color = isSl ? SELL_COLOR : BUY_COLOR;
      } else {
        color = computeOrderLineColor(order, price, pos);
      }

      refs.orderLines.current.push(new PriceLevelLine({
        price,
        series, overlay, chartApi: chart,
        lineColor: color, lineStyle: isSuspended ? 'dashed' : 'solid', lineWidth: 1,
        axisLabelVisible: true, tickSize,
      }));
      refs.orderLineMeta.current.push({ kind: 'order', order });
      refs.orderLinePrices.current.push(price);
    }

    // Phantom bracket lines: render from pendingBracketInfo for prices not covered by real orders.
    // Covers: engine-managed TPs (not yet placed), and Suspended legs lost after refresh.
    if (pendingBracketInfo) {
      const bi = pendingBracketInfo;

      // Phantom SL
      if (bi.slPrice != null && !coveredBracketPrices.has(Math.round(bi.slPrice / tickSize))) {
        refs.orderLines.current.push(new PriceLevelLine({
          price: bi.slPrice,
          series, overlay, chartApi: chart,
          lineColor: SELL_COLOR, lineStyle: 'dashed', lineWidth: 1,
          axisLabelVisible: true, tickSize,
        }));
        refs.orderLineMeta.current.push({ kind: 'phantom-bracket', bracketType: 'sl', bracketInfo: bi });
        refs.orderLinePrices.current.push(bi.slPrice);
      }

      // Phantom TPs
      for (let i = 0; i < bi.tpPrices.length; i++) {
        const tpPrice = bi.tpPrices[i];
        if (!coveredBracketPrices.has(Math.round(tpPrice / tickSize))) {
          refs.orderLines.current.push(new PriceLevelLine({
            price: tpPrice,
            series, overlay, chartApi: chart,
            lineColor: BUY_COLOR, lineStyle: 'dashed', lineWidth: 1,
            axisLabelVisible: true, tickSize,
          }));
          refs.orderLineMeta.current.push({ kind: 'phantom-bracket', bracketType: 'tp', tpIndex: i, bracketInfo: bi });
          refs.orderLinePrices.current.push(tpPrice);
        }
      }
    }

    return () => {
      refs.orderLines.current.forEach((l) => l.destroy());
      refs.orderLines.current = [];
      refs.orderLineMeta.current = [];
      refs.orderLinePrices.current = [];
    };
  }, [isOrderChart, openOrders, positions, contract, activeAccountId, pendingBracketInfo]);
}
