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
import { LABEL_BG, LABEL_TEXT, CLOSE_BG, wireCloseHover, formatSlPnl, formatTpPnl } from './labelUtils';
import { snapToTickSize } from '../barUtils';

/**
 * Effect 1: Creates dashed lines on the chart for each armed condition
 * that matches the current contract. Labels mirror the preview view exactly.
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

    function wireDrag(
      labelEl: HTMLElement,
      excludeEl: HTMLElement | null,
      drag: Omit<ArmedDragState, 'startY'>,
    ) {
      labelEl.style.pointerEvents = 'auto';
      labelEl.style.cursor = 'grab';
      labelEl.addEventListener('mousedown', (e) => {
        if (excludeEl && (e.target === excludeEl || excludeEl.contains(e.target as Node))) return;
        e.preventDefault();
        dragRef.current = { ...drag, startY: e.clientY };
        labelEl.style.cursor = 'grabbing';
        if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
        if (chart) chart.applyOptions({ handleScroll: false, handleScale: false });
      });
    }

    function wireX(
      xCell: HTMLDivElement,
      onClick: () => void,
    ) {
      xCell.style.cursor = 'pointer';
      wireCloseHover(xCell);
      xCell.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      });
    }

    for (const cond of relevant) {
      const isAbove = cond.conditionType === 'closes_above';
      const lineColor = isAbove ? CLR_ABOVE : CLR_BELOW;
      const condId = cond.id;
      const isBuy = cond.orderSide === 'buy';
      const sideBg = isBuy ? CLR_BUY : CLR_SELL;
      const url = () => resolveConditionServerUrl(useStore.getState().conditionServerUrl);

      // --- Trigger line ---
      const line = new PriceLevelLine({
        price: cond.triggerPrice,
        series, overlay, chartApi: chart,
        lineColor, lineStyle: 'dashed', lineWidth: 1,
        axisLabelVisible: true, tickSize,
      });

      const arrowChar = isAbove ? '\u25B2' : '\u25BC';
      const condText = isAbove ? 'If Close Above' : 'If Close Below';
      const orderWord = cond.orderType === 'market' ? 'market' : 'limit';

      line.setLabel([
        { text: arrowChar, bg: isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW, color: '#fff' },
        { text: `${condText} ${cond.timeframe}`, bg: LABEL_BG, color: LABEL_TEXT },
        { text: orderWord, bg: LABEL_BG, color: LABEL_TEXT },
        { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT },
      ]);

      const labelEl = line.getLabelEl();
      const cells = line.getCells();
      const lineIdx = linesRef.current.length;

      if (labelEl) {
        const xCell = cells[cells.length - 1];
        if (xCell) {
          wireX(xCell, () => {
            conditionService.remove(url(), condId)
              .then(() => useStore.getState().removeCondition(condId))
              .catch((err) => showToast('error', 'Failed to delete', errorMessage(err)));
          });
        }
        wireDrag(labelEl, xCell ?? null, { condId, lineIdx, originalPrice: cond.triggerPrice, field: 'triggerPrice' });
      }

      linesRef.current.push(line);
      condIdsRef.current.push(condId);

      // --- Market order label (ghost line, side-by-side with trigger) ---
      if (cond.orderType === 'market') {
        const sideLabel = isBuy ? 'Buy Market' : 'Sell Market';

        const orderLine = new PriceLevelLine({
          price: cond.triggerPrice,
          series, overlay, chartApi: chart,
          lineColor: sideBg, lineStyle: 'dashed', lineWidth: 0,
          axisLabelVisible: false, tickSize,
        });

        orderLine.setLabel([
          { text: sideLabel, bg: LABEL_BG, color: LABEL_TEXT },
          { text: String(cond.orderSize), bg: sideBg, color: LABEL_TEXT },
          { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT },
        ]);

        const orderLabelEl = orderLine.getLabelEl();
        const orderCells = orderLine.getCells();
        if (orderLabelEl) {
          const xCell = orderCells[orderCells.length - 1];
          if (xCell) {
            wireX(xCell, () => {
              conditionService.remove(url(), condId)
                .then(() => useStore.getState().removeCondition(condId))
                .catch((err) => showToast('error', 'Failed to delete', errorMessage(err)));
            });
          }
        }

        // Position side-by-side
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
          series, overlay, chartApi: chart,
          lineColor: sideBg, lineStyle: 'dashed', lineWidth: 1,
          axisLabelVisible: true, tickSize,
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
          const xCell = orderCells[orderCells.length - 1];
          if (xCell) {
            wireX(xCell, () => {
              conditionService.update(url(), condId, { orderType: 'market', orderPrice: undefined })
                .then((updated) => useStore.getState().upsertCondition(updated))
                .catch((err) => showToast('error', 'Failed to update', errorMessage(err)));
            });
          }
          wireDrag(orderLabelEl, xCell ?? null, { condId, lineIdx: orderLineIdx, originalPrice: cond.orderPrice!, field: 'orderPrice' });
        }

        linesRef.current.push(orderLine);
        condIdsRef.current.push(condId);
      }

      // --- Bracket SL/TP lines ---
      if (cond.bracket?.enabled) {
        const refPrice = cond.orderType === 'limit' && cond.orderPrice != null
          ? cond.orderPrice
          : cond.triggerPrice;

        if (cond.bracket.sl) {
          const slPoints = cond.bracket.sl.points;
          const slPrice = snapToTickSize(
            isBuy ? refPrice - slPoints : refPrice + slPoints,
            tickSize,
          );
          const pnlText = formatSlPnl(refPrice, slPrice, cond.orderSize, isBuy, contract);

          const slLine = new PriceLevelLine({
            price: slPrice,
            series, overlay, chartApi: chart,
            lineColor: CLR_SL, lineStyle: 'dashed', lineWidth: 1,
            axisLabelVisible: true, tickSize,
          });

          slLine.setLabel([
            { text: pnlText, bg: CLR_SL, color: LABEL_TEXT },
            { text: String(cond.orderSize), bg: CLR_SL, color: LABEL_TEXT },
            { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT },
          ]);

          const slLabelEl = slLine.getLabelEl();
          const slCells = slLine.getCells();
          const slLineIdx = linesRef.current.length;
          if (slLabelEl) {
            const xCell = slCells[slCells.length - 1];
            if (xCell) {
              wireX(xCell, () => {
                const existing = useStore.getState().conditions.find((c) => c.id === condId);
                if (!existing?.bracket) return;
                const newBracket = { ...existing.bracket, sl: undefined };
                conditionService.update(url(), condId, { bracket: newBracket })
                  .then((updated) => useStore.getState().upsertCondition(updated))
                  .catch((err) => showToast('error', 'Failed to update', errorMessage(err)));
              });
            }
            wireDrag(slLabelEl, xCell ?? null, {
              condId, lineIdx: slLineIdx, originalPrice: slPrice,
              field: 'slPrice', refPrice, isBuy,
            });
          }

          linesRef.current.push(slLine);
          condIdsRef.current.push(condId);
        }

        for (let tpIndex = 0; tpIndex < (cond.bracket.tp ?? []).length; tpIndex++) {
          const tp = cond.bracket.tp![tpIndex];
          const tpPrice = snapToTickSize(
            isBuy ? refPrice + tp.points : refPrice - tp.points,
            tickSize,
          );
          const tpSize = tp.size ?? cond.orderSize;
          const pnlText = formatTpPnl(refPrice, tpPrice, tpSize, isBuy, contract);

          const tpLine = new PriceLevelLine({
            price: tpPrice,
            series, overlay, chartApi: chart,
            lineColor: CLR_TP, lineStyle: 'dashed', lineWidth: 1,
            axisLabelVisible: true, tickSize,
          });

          tpLine.setLabel([
            { text: pnlText, bg: CLR_TP, color: LABEL_TEXT },
            { text: String(tpSize), bg: CLR_TP, color: LABEL_TEXT },
            { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT },
          ]);

          const tpLabelEl = tpLine.getLabelEl();
          const tpCells = tpLine.getCells();
          const tpLineIdx = linesRef.current.length;
          if (tpLabelEl) {
            const xCell = tpCells[tpCells.length - 1];
            if (xCell) {
              wireX(xCell, () => {
                const existing = useStore.getState().conditions.find((c) => c.id === condId);
                if (!existing?.bracket?.tp) return;
                const newTp = existing.bracket.tp.filter((_, i) => i !== tpIndex);
                const newBracket = { ...existing.bracket, tp: newTp.length > 0 ? newTp : undefined };
                conditionService.update(url(), condId, { bracket: newBracket })
                  .then((updated) => useStore.getState().upsertCondition(updated))
                  .catch((err) => showToast('error', 'Failed to update', errorMessage(err)));
              });
            }
            wireDrag(tpLabelEl, xCell ?? null, {
              condId, lineIdx: tpLineIdx, originalPrice: tpPrice,
              field: 'tpPrice', tpIndex, refPrice, isBuy,
            });
          }

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
