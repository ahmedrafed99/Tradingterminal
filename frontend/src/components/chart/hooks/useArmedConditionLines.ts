import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Condition } from '../../../services/conditionService';
import { conditionService } from '../../../services/conditionService';
import { useStore } from '../../../store/useStore';
import { PriceLevelLine } from '../PriceLevelLine';
import type { ChartRefs } from './types';
import { showToast, errorMessage } from '../../../utils/toast';
import type { ArmedDragState } from './conditionLineTypes';
import { CLR_ABOVE, CLR_BELOW, CLR_BUY, CLR_SELL, CLR_ARM_ABOVE, CLR_ARM_BELOW } from './conditionLineTypes';

/**
 * Effect 1: Creates dashed lines on the chart for each armed condition
 * that matches the current contract.
 */
export function useArmedConditionLines(
  refs: ChartRefs,
  contract: Contract | null,
  conditions: Condition[],
  conditionServerUrl: string | null,
  linesRef: React.MutableRefObject<PriceLevelLine[]>,
  condIdsRef: React.MutableRefObject<string[]>,
  dragRef: React.MutableRefObject<ArmedDragState | null>,
): void {
  useEffect(() => {
    const series = refs.series.current;
    const overlay = refs.overlay.current;
    const chart = refs.chart.current;

    for (const line of linesRef.current) line.destroy();
    linesRef.current = [];
    condIdsRef.current = [];

    if (!series || !overlay || !chart || !contract || !conditionServerUrl) return;

    const relevant = conditions.filter(
      (c) => c.status === 'armed' && String(c.contractId) === String(contract.id),
    );

    const tickSize = contract.tickSize;

    for (const cond of relevant) {
      const isAbove = cond.conditionType === 'closes_above';
      const lineColor = isAbove ? CLR_ABOVE : CLR_BELOW;
      const condId = cond.id;

      // --- Trigger line ---
      const line = new PriceLevelLine({
        price: cond.triggerPrice,
        series,
        overlay,
        chartApi: chart,
        lineColor,
        lineStyle: 'dashed',
        lineWidth: 1,
        axisLabelVisible: true,
        tickSize,
      });

      const arrowChar = isAbove ? '\u25B2' : '\u25BC';

      line.setLabel([
        { text: arrowChar, bg: isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW, color: '#fff' },
        { text: `${isAbove ? 'Above' : 'Below'} ${cond.timeframe}`, bg: '#cac9cb', color: '#000' },
        { text: '\u2715', bg: '#e0e0e0', color: '#000' },
      ]);

      const labelEl = line.getLabelEl();
      const cells = line.getCells();
      const lineIdx = linesRef.current.length;

      if (labelEl) {
        labelEl.style.pointerEvents = 'auto';
        labelEl.style.cursor = 'grab';

        const xCell = cells[cells.length - 1];
        if (xCell) {
          xCell.style.cursor = 'pointer';
          xCell.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const url = useStore.getState().conditionServerUrl;
            if (!url) return;
            conditionService.remove(url, condId).then(() => {
              useStore.getState().removeCondition(condId);
            }).catch((err) => {
              showToast('error', 'Failed to delete', errorMessage(err));
            });
          });
        }

        labelEl.addEventListener('mousedown', (e) => {
          if (e.target === xCell || xCell?.contains(e.target as Node)) return;
          e.preventDefault();
          dragRef.current = {
            condId,
            lineIdx,
            originalPrice: cond.triggerPrice,
            startY: e.clientY,
            field: 'triggerPrice',
          };
          labelEl.style.cursor = 'grabbing';
          if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
          if (chart) chart.applyOptions({ handleScroll: false, handleScale: false });
        });
      }

      linesRef.current.push(line);
      condIdsRef.current.push(condId);

      // --- Order price line (limit orders only) ---
      if (cond.orderType === 'limit' && cond.orderPrice != null) {
        const sideLabel = cond.orderSide === 'buy' ? 'Buy Limit' : 'Sell Limit';
        const sideBg = cond.orderSide === 'buy' ? CLR_BUY : CLR_SELL;

        const orderLine = new PriceLevelLine({
          price: cond.orderPrice,
          series,
          overlay,
          chartApi: chart,
          lineColor: sideBg,
          lineStyle: 'dashed',
          lineWidth: 1,
          axisLabelVisible: true,
          tickSize,
        });

        orderLine.setLabel([
          { text: sideLabel, bg: '#cac9cb', color: '#000' },
          { text: String(cond.orderSize), bg: sideBg, color: '#000' },
          { text: '\u2715', bg: '#e0e0e0', color: '#000' },
        ]);

        const orderLabelEl = orderLine.getLabelEl();
        const orderCells = orderLine.getCells();
        const orderLineIdx = linesRef.current.length;
        if (orderLabelEl) {
          orderLabelEl.style.pointerEvents = 'auto';
          orderLabelEl.style.cursor = 'grab';

          const orderXCell = orderCells[orderCells.length - 1];
          if (orderXCell) {
            orderXCell.style.cursor = 'pointer';
            orderXCell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              const url = useStore.getState().conditionServerUrl;
              if (!url) return;
              conditionService.update(url, condId, { orderType: 'market', orderPrice: undefined })
                .then((updated) => { useStore.getState().upsertCondition(updated); })
                .catch((err) => {
                  showToast('error', 'Failed to update', errorMessage(err));
                });
            });
          }

          // Drag to modify order price
          orderLabelEl.addEventListener('mousedown', (e) => {
            if (e.target === orderXCell || orderXCell?.contains(e.target as Node)) return;
            e.preventDefault();
            dragRef.current = {
              condId,
              lineIdx: orderLineIdx,
              originalPrice: cond.orderPrice!,
              startY: e.clientY,
              field: 'orderPrice',
            };
            orderLabelEl.style.cursor = 'grabbing';
            if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
            if (chart) chart.applyOptions({ handleScroll: false, handleScale: false });
          });
        }

        linesRef.current.push(orderLine);
        condIdsRef.current.push(condId);
      }
    }

    return () => {
      for (const line of linesRef.current) line.destroy();
      linesRef.current = [];
      condIdsRef.current = [];
    };
  }, [conditions, contract, conditionServerUrl, refs, linesRef, condIdsRef, dragRef]);
}
