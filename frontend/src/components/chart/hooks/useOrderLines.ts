import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { OrderType } from '../../../types/enums';
import { PriceLevelLine } from '../PriceLevelLine';
import { computeOrderLineColor } from './labelUtils';
import { usePreviewLines } from './usePreviewLines';
import { usePreviewDrag } from './usePreviewDrag';
import { useOrderDrag } from './useOrderDrag';
import { usePositionDrag } from './usePositionDrag';
import type { ChartRefs } from './types';

/**
 * Orchestrator for all chart price-level lines.
 * Delegates to focused sub-hooks for preview lifecycle, drag interactions,
 * and position drag-to-create. Directly manages live order/position lines.
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
        lineColor: '#cac8cb', lineStyle: 'solid', lineWidth: 1,
        axisLabelVisible: true, tickSize,
      }));
      refs.orderLineMeta.current.push({ kind: 'position' });
      refs.orderLinePrices.current.push(pos.averagePrice);
    }

    // Open order lines (draggable)
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

      const color = computeOrderLineColor(order, price, pos);

      refs.orderLines.current.push(new PriceLevelLine({
        price,
        series, overlay, chartApi: chart,
        lineColor: color, lineStyle: 'solid', lineWidth: 1,
        axisLabelVisible: true, tickSize,
      }));
      refs.orderLineMeta.current.push({ kind: 'order', order });
      refs.orderLinePrices.current.push(price);
    }

    return () => {
      refs.orderLines.current.forEach((l) => l.destroy());
      refs.orderLines.current = [];
      refs.orderLineMeta.current = [];
      refs.orderLinePrices.current = [];
    };
  }, [isOrderChart, openOrders, positions, contract, activeAccountId]);
}
