import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Condition } from '../../../services/conditionService';
import { conditionService } from '../../../services/conditionService';
import { useStore } from '../../../store/useStore';
import { resolveConditionServerUrl } from '../../../store/slices/conditionsSlice';
import { PriceLevelPrimitive } from '../primitives/PriceLevelPrimitive';
import type { ChartRefs } from './types';
import { showToast, errorMessage } from '../../../utils/toast';
import type { ArmedDragState } from './conditionLineTypes';
import { CLR_ABOVE, CLR_BELOW, CLR_BUY, CLR_SELL, CLR_ARM_ABOVE, CLR_ARM_BELOW, CLR_SL, CLR_TP } from './conditionLineTypes';
import { LABEL_BG, LABEL_TEXT, CLOSE_BG, formatSlPnl, formatTpPnl } from './labelUtils';
import { snapToTickSize } from '../barUtils';

const CLOSE_BG_HOVER = '#c0392b';

/**
 * Effect 1: Creates canvas primitives for each armed condition matching the
 * current contract. Labels mirror the preview view. Drag is handled via
 * built-in onDrag/onDragEnd callbacks; small click opens condition modal.
 */
export function useArmedConditionLines(
  refs: ChartRefs,
  contract: Contract | null,
  conditions: Condition[],
  conditionServerUrl: string,
  linesRef: React.MutableRefObject<PriceLevelPrimitive[]>,
  condIdsRef: React.MutableRefObject<string[]>,
  dragRef: React.MutableRefObject<ArmedDragState | null>,
): void {
  useEffect(() => {
    const series = refs.series.current;
    const container = refs.container.current;

    for (const line of linesRef.current) series?.detachPrimitive(line);
    linesRef.current = [];
    condIdsRef.current = [];

    if (!series || !container || !contract) return;

    const relevant = conditions.filter(
      (c) => c.status === 'armed' && String(c.contractId) === String(contract.id),
    );

    const tickSize = contract.tickSize;

    function attach(prim: PriceLevelPrimitive): PriceLevelPrimitive {
      series!.attachPrimitive(prim);
      prim.setChartElement(container!);
      return prim;
    }

    const url = () => resolveConditionServerUrl(useStore.getState().conditionServerUrl);

    for (const cond of relevant) {
      const isAbove = cond.conditionType === 'closes_above';
      const condId = cond.id;
      const isBuy = cond.orderSide === 'buy';
      const sideBg = isBuy ? CLR_BUY : CLR_SELL;
      const arrowChar = isAbove ? '▲' : '▼';
      const condText = isAbove ? 'If Close Above' : 'If Close Below';
      const armBg = isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW;
      const orderWord = cond.orderType === 'market' ? 'market' : 'limit';
      const lineIdx = linesRef.current.length;

      // ── Trigger line ──
      const triggerLine = attach(new PriceLevelPrimitive({
        price: cond.triggerPrice,
        lineColor: isAbove ? CLR_ABOVE : CLR_BELOW,
        lineStyle: 'dashed',
        lineWidth: 1,
        priceLabel: { visible: true, tickSize },
        labelFraction: cond.orderType === 'market' ? 0.30 : undefined,
        cellOrder: ['arrow', 'label', 'type', 'close'],
        cells: {
          arrow: { text: arrowChar, bg: armBg, color: '#fff',
                   onClick: () => useStore.getState().openConditionModal(condId) },
          label: { text: `${condText} ${cond.timeframe}`, bg: LABEL_BG, color: LABEL_TEXT,
                   onClick: () => useStore.getState().openConditionModal(condId) },
          type:  { text: orderWord, bg: LABEL_BG, color: LABEL_TEXT,
                   onClick: () => useStore.getState().openConditionModal(condId) },
          close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT,
                   hoverBg: CLOSE_BG_HOVER,
                   onClick: () => {
                     conditionService.remove(url(), condId)
                       .then(() => useStore.getState().removeCondition(condId))
                       .catch((err) => showToast('error', 'Failed to delete', errorMessage(err)));
                   } },
        },
        onDrag: (price) => {
          const line = linesRef.current[lineIdx];
          if (line) line.setPrice(snapToTickSize(price, tickSize));
        },
        onDragEnd: (newPrice) => {
          const snapped = snapToTickSize(newPrice, tickSize);
          if (snapped === cond.triggerPrice) return;
          conditionService.update(url(), condId, { triggerPrice: snapped })
            .then((updated) => useStore.getState().upsertCondition(updated))
            .catch((err) => {
              const line = linesRef.current[lineIdx];
              if (line) line.setPrice(cond.triggerPrice);
              showToast('error', 'Failed to update condition', errorMessage(err));
            });
        },
      }));

      linesRef.current.push(triggerLine);
      condIdsRef.current.push(condId);

      // ── Market mode: ghost order line with label side-by-side ──
      if (cond.orderType === 'market') {
        const sideLabel = isBuy ? 'Buy Market' : 'Sell Market';
        const orderLineIdx = linesRef.current.length;

        const orderLine = attach(new PriceLevelPrimitive({
          price: cond.triggerPrice,
          lineColor: sideBg,
          lineStyle: 'dashed',
          lineWidth: 0,
          priceLabel: { visible: false, tickSize },
          labelFraction: 0.65,
          cellOrder: ['side', 'size', 'close'],
          cells: {
            side:  { text: sideLabel, bg: LABEL_BG, color: LABEL_TEXT },
            size:  { text: String(cond.orderSize), bg: sideBg, color: LABEL_TEXT },
            close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT,
                     hoverBg: CLOSE_BG_HOVER,
                     onClick: () => {
                       conditionService.remove(url(), condId)
                         .then(() => useStore.getState().removeCondition(condId))
                         .catch((err) => showToast('error', 'Failed to delete', errorMessage(err)));
                     } },
          },
        }));

        linesRef.current.push(orderLine);
        condIdsRef.current.push(condId);
        void orderLineIdx; // referenced by index but not draggable
      }

      // ── Limit order line ──
      if (cond.orderType === 'limit' && cond.orderPrice != null) {
        const sideLabel = isBuy ? 'Buy Limit' : 'Sell Limit';
        const orderLineIdx = linesRef.current.length;
        const origOrderPrice = cond.orderPrice;

        const orderLine = attach(new PriceLevelPrimitive({
          price: cond.orderPrice,
          lineColor: sideBg,
          lineStyle: 'dashed',
          lineWidth: 1,
          priceLabel: { visible: true, tickSize },
          cellOrder: ['side', 'size', 'close'],
          cells: {
            side:  { text: sideLabel, bg: LABEL_BG, color: LABEL_TEXT,
                     onClick: () => useStore.getState().openConditionModal(condId) },
            size:  { text: String(cond.orderSize), bg: sideBg, color: LABEL_TEXT,
                     onClick: () => useStore.getState().openConditionModal(condId) },
            close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT,
                     hoverBg: CLOSE_BG_HOVER,
                     onClick: () => {
                       conditionService.update(url(), condId, { orderType: 'market', orderPrice: undefined })
                         .then((updated) => useStore.getState().upsertCondition(updated))
                         .catch((err) => showToast('error', 'Failed to update', errorMessage(err)));
                     } },
          },
          onDrag: (price) => {
            const line = linesRef.current[orderLineIdx];
            if (line) line.setPrice(snapToTickSize(price, tickSize));
          },
          onDragEnd: (newPrice) => {
            const snapped = snapToTickSize(newPrice, tickSize);
            if (snapped === origOrderPrice) return;
            conditionService.update(url(), condId, { orderPrice: snapped })
              .then((updated) => useStore.getState().upsertCondition(updated))
              .catch((err) => {
                const line = linesRef.current[orderLineIdx];
                if (line) line.setPrice(origOrderPrice);
                showToast('error', 'Failed to update condition', errorMessage(err));
              });
          },
        }));

        linesRef.current.push(orderLine);
        condIdsRef.current.push(condId);
      }

      // ── Bracket SL/TP lines ──
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
          const origSlPrice = slPrice;
          const slLineIdx = linesRef.current.length;
          const pnlText = formatSlPnl(refPrice, slPrice, cond.orderSize, isBuy, contract);

          const slLine = attach(new PriceLevelPrimitive({
            price: slPrice,
            lineColor: CLR_SL,
            lineStyle: 'dashed',
            lineWidth: 1,
            priceLabel: { visible: true, tickSize },
            cellOrder: ['pnl', 'size', 'close'],
            cells: {
              pnl:   { text: pnlText, bg: CLR_SL, color: LABEL_TEXT },
              size:  { text: String(cond.orderSize), bg: CLR_SL, color: LABEL_TEXT },
              close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT,
                       hoverBg: CLOSE_BG_HOVER,
                       onClick: () => {
                         const existing = useStore.getState().conditions.find((c) => c.id === condId);
                         if (!existing?.bracket) return;
                         const newBracket = { ...existing.bracket, sl: undefined };
                         conditionService.update(url(), condId, { bracket: newBracket })
                           .then((updated) => useStore.getState().upsertCondition(updated))
                           .catch((err) => showToast('error', 'Failed to update', errorMessage(err)));
                       } },
            },
            onDrag: (price) => {
              const line = linesRef.current[slLineIdx];
              if (!line) return;
              const snapped = snapToTickSize(price, tickSize);
              line.setPrice(snapped);
              const newPnl = formatSlPnl(refPrice, snapped, cond.orderSize, isBuy, contract);
              line.setCell('pnl', { text: newPnl });
            },
            onDragEnd: (newPrice) => {
              const snapped = snapToTickSize(newPrice, tickSize);
              if (snapped === origSlPrice) return;
              const wrongSide = isBuy ? snapped >= refPrice : snapped <= refPrice;
              if (wrongSide) {
                showToast('error', 'Invalid bracket price', 'SL dragged to wrong side');
                const line = linesRef.current[slLineIdx];
                if (line) line.setPrice(origSlPrice);
                return;
              }
              const existing = useStore.getState().conditions.find((c) => c.id === condId);
              if (!existing?.bracket) return;
              const points = Math.abs(snapped - refPrice);
              const newBracket = { ...existing.bracket, sl: { points } };
              conditionService.update(url(), condId, { bracket: newBracket })
                .then((updated) => useStore.getState().upsertCondition(updated))
                .catch((err) => {
                  const line = linesRef.current[slLineIdx];
                  if (line) line.setPrice(origSlPrice);
                  showToast('error', 'Failed to update condition', errorMessage(err));
                });
            },
          }));

          linesRef.current.push(slLine);
          condIdsRef.current.push(condId);
        }

        for (let tpIndex = 0; tpIndex < (cond.bracket.tp ?? []).length; tpIndex++) {
          const tp = cond.bracket.tp![tpIndex];
          const tpPrice = snapToTickSize(
            isBuy ? refPrice + tp.points : refPrice - tp.points,
            tickSize,
          );
          const origTpPrice = tpPrice;
          const tpSize = tp.size ?? cond.orderSize;
          const tpLineIdx = linesRef.current.length;
          const pnlText = formatTpPnl(refPrice, tpPrice, tpSize, isBuy, contract);
          const tpIndexCapture = tpIndex;

          const tpLine = attach(new PriceLevelPrimitive({
            price: tpPrice,
            lineColor: CLR_TP,
            lineStyle: 'dashed',
            lineWidth: 1,
            priceLabel: { visible: true, tickSize },
            cellOrder: ['pnl', 'size', 'close'],
            cells: {
              pnl:   { text: pnlText, bg: CLR_TP, color: LABEL_TEXT },
              size:  { text: String(tpSize), bg: CLR_TP, color: LABEL_TEXT },
              close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT,
                       hoverBg: CLOSE_BG_HOVER,
                       onClick: () => {
                         const existing = useStore.getState().conditions.find((c) => c.id === condId);
                         if (!existing?.bracket?.tp) return;
                         const newTp = existing.bracket.tp.filter((_, i) => i !== tpIndexCapture);
                         const newBracket = { ...existing.bracket, tp: newTp.length > 0 ? newTp : undefined };
                         conditionService.update(url(), condId, { bracket: newBracket })
                           .then((updated) => useStore.getState().upsertCondition(updated))
                           .catch((err) => showToast('error', 'Failed to update', errorMessage(err)));
                       } },
            },
            onDrag: (price) => {
              const line = linesRef.current[tpLineIdx];
              if (!line) return;
              const snapped = snapToTickSize(price, tickSize);
              line.setPrice(snapped);
              const newPnl = formatTpPnl(refPrice, snapped, tpSize, isBuy, contract);
              line.setCell('pnl', { text: newPnl });
            },
            onDragEnd: (newPrice) => {
              const snapped = snapToTickSize(newPrice, tickSize);
              if (snapped === origTpPrice) return;
              const wrongSide = isBuy ? snapped <= refPrice : snapped >= refPrice;
              if (wrongSide) {
                showToast('error', 'Invalid bracket price', 'TP dragged to wrong side');
                const line = linesRef.current[tpLineIdx];
                if (line) line.setPrice(origTpPrice);
                return;
              }
              const existing = useStore.getState().conditions.find((c) => c.id === condId);
              if (!existing?.bracket?.tp) return;
              const points = Math.abs(snapped - refPrice);
              const newTp = (existing.bracket.tp ?? []).map((t, i) =>
                i === tpIndexCapture ? { ...t, points } : t,
              );
              const newBracket = { ...existing.bracket, tp: newTp };
              conditionService.update(url(), condId, { bracket: newBracket })
                .then((updated) => useStore.getState().upsertCondition(updated))
                .catch((err) => {
                  const line = linesRef.current[tpLineIdx];
                  if (line) line.setPrice(origTpPrice);
                  showToast('error', 'Failed to update condition', errorMessage(err));
                });
            },
          }));

          linesRef.current.push(tpLine);
          condIdsRef.current.push(condId);
        }
      }
    }

    return () => {
      for (const line of linesRef.current) series?.detachPrimitive(line);
      linesRef.current = [];
      condIdsRef.current = [];
    };
  }, [conditions, contract, conditionServerUrl, refs, linesRef, condIdsRef, dragRef]);
}
