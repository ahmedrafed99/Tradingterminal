import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Condition } from '../../../services/conditionService';
import { conditionService } from '../../../services/conditionService';
import { useStore } from '../../../store/useStore';
import { resolveConditionServerUrl } from '../../../store/slices/conditionsSlice';
import { PriceLevelLine } from '../PriceLevelLine';
import type { ChartRefs } from './types';
import { showToast, errorMessage } from '../../../utils/toast';
import type { ArmedDragState } from './conditionLineTypes';
import { CLR_ABOVE, CLR_BELOW, CLR_BUY, CLR_SELL, CLR_ARM_ABOVE, CLR_ARM_BELOW, CLR_SL, CLR_TP } from './conditionLineTypes';
import { LABEL_BG, LABEL_TEXT, CLOSE_BG, wireCloseHover } from './labelUtils';
import { snapToTickSize } from '../barUtils';

/**
 * Effect 1: Creates dashed lines on the chart for each armed condition
 * that matches the current contract.
 */
export function useArmedConditionLines(
  refs: ChartRefs,
  contract: Contract | null,
  conditions: Condition[],
  conditionServerUrl: string,
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

    if (!series || !overlay || !chart || !contract) return;

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
        { text: `${isAbove ? 'Above' : 'Below'} ${cond.timeframe}`, bg: LABEL_BG, color: LABEL_TEXT },
        { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT },
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
          wireCloseHover(xCell);
          xCell.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const url = resolveConditionServerUrl(useStore.getState().conditionServerUrl);
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

      const isBuy = cond.orderSide === 'buy';
      const sideBg = isBuy ? CLR_BUY : CLR_SELL;

      // --- Market order label (side-by-side with trigger line) ---
      if (cond.orderType === 'market') {
        const sideLabel = isBuy ? 'Buy Market' : 'Sell Market';

        // Ghost line at same price — hidden, just carries the label
        const orderLine = new PriceLevelLine({
          price: cond.triggerPrice,
          series,
          overlay,
          chartApi: chart,
          lineColor: sideBg,
          lineStyle: 'dashed',
          lineWidth: 0,
          axisLabelVisible: false,
          tickSize,
        });

        orderLine.setLabel([
          { text: sideLabel, bg: LABEL_BG, color: LABEL_TEXT },
          { text: String(cond.orderSize), bg: sideBg, color: LABEL_TEXT },
        ]);

        // Position side-by-side with trigger label
        line.setLabelLeft(0.30);
        orderLine.setLabelLeft(0.65);

        linesRef.current.push(orderLine);
        condIdsRef.current.push(condId);
      }

      // --- Limit order line ---
      if (cond.orderType === 'limit' && cond.orderPrice != null) {
        const sideLabel = isBuy ? 'Buy Limit' : 'Sell Limit';

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
          { text: sideLabel, bg: LABEL_BG, color: LABEL_TEXT },
          { text: String(cond.orderSize), bg: sideBg, color: LABEL_TEXT },
          { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT },
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
            wireCloseHover(orderXCell);
            orderXCell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              const url = resolveConditionServerUrl(useStore.getState().conditionServerUrl);
              conditionService.update(url, condId, { orderType: 'market', orderPrice: undefined })
                .then((updated) => { useStore.getState().upsertCondition(updated); })
                .catch((err) => {
                  showToast('error', 'Failed to update', errorMessage(err));
                });
            });
          }

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

      // --- Bracket SL/TP lines ---
      if (cond.bracket?.enabled) {
        // Reference price: limit order price if known, else trigger price
        const refPrice = cond.orderType === 'limit' && cond.orderPrice != null
          ? cond.orderPrice
          : cond.triggerPrice;

        if (cond.bracket.sl) {
          const slPrice = snapToTickSize(
            isBuy ? refPrice - cond.bracket.sl.points : refPrice + cond.bracket.sl.points,
            tickSize,
          );
          const slLine = new PriceLevelLine({
            price: slPrice,
            series,
            overlay,
            chartApi: chart,
            lineColor: CLR_SL,
            lineStyle: 'dashed',
            lineWidth: 1,
            axisLabelVisible: true,
            tickSize,
          });
          slLine.setLabel([
            { text: 'SL', bg: CLR_SL, color: '#fff' },
            { text: `${cond.bracket.sl.points}pts`, bg: LABEL_BG, color: LABEL_TEXT },
          ]);
          linesRef.current.push(slLine);
          condIdsRef.current.push(condId);
        }

        for (const tp of cond.bracket.tp ?? []) {
          const tpPrice = snapToTickSize(
            isBuy ? refPrice + tp.points : refPrice - tp.points,
            tickSize,
          );
          const tpLine = new PriceLevelLine({
            price: tpPrice,
            series,
            overlay,
            chartApi: chart,
            lineColor: CLR_TP,
            lineStyle: 'dashed',
            lineWidth: 1,
            axisLabelVisible: true,
            tickSize,
          });
          tpLine.setLabel([
            { text: 'TP', bg: CLR_TP, color: '#fff' },
            { text: `${tp.points}pts`, bg: LABEL_BG, color: LABEL_TEXT },
          ]);
          linesRef.current.push(tpLine);
          condIdsRef.current.push(condId);
        }
      }
    }

    return () => {
      for (const line of linesRef.current) line.destroy();
      linesRef.current = [];
      condIdsRef.current = [];
    };
  }, [conditions, contract, conditionServerUrl, refs, linesRef, condIdsRef, dragRef]);
}
