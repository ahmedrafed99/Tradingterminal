import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import type { PriceLevelLine } from '../PriceLevelLine';
import type { ChartRefs } from './types';
import { snapToTickSize } from '../barUtils';
import { calcPnl } from '../../../utils/instrument';
import type { PreviewState, PreviewDragState } from './conditionLineTypes';
import { CLR_ABOVE, CLR_BELOW, CLR_BUY, CLR_SELL, CLR_ARM_ABOVE, CLR_ARM_BELOW, CLR_SL, CLR_TP } from './conditionLineTypes';

/**
 * Effect 4: Mouse move/up handlers for dragging preview lines.
 * Handles cond, order, SL, and TP line dragging with PnL updates
 * and automatic direction flipping.
 */
export function useConditionPreviewDrag(
  refs: ChartRefs,
  contract: Contract | null,
  timeframe: Timeframe,
  previewRef: React.MutableRefObject<PreviewState | null>,
  previewDragRef: React.MutableRefObject<PreviewDragState | null>,
): void {
  useEffect(() => {
    const container = refs.container.current;
    const series = refs.series.current;
    const chart = refs.chart.current;
    if (!container || !series || !chart || !contract) return;

    const tickSize = contract.tickSize;

    function onMouseMove(e: MouseEvent) {
      const drag = previewDragRef.current;
      const p = previewRef.current;
      if (!drag || !p) return;

      const rect = container!.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const rawPrice = series!.coordinateToPrice(y);
      if (rawPrice === null) return;
      const snapped = snapToTickSize(rawPrice, tickSize);

      if (drag.target === 'cond' && p.condLine) {
        p.condPrice = snapped;
        p.condLine.setPrice(snapped);
        p.condLine.syncPosition();
        if (p.isMarket && p.orderLine) {
          p.orderPrice = snapped;
          p.orderLine.setPrice(snapped);
          p.orderLine.syncPosition();
          updateBracketPnl(p, snapped);
        }
      } else if (drag.target === 'order' && p.orderLine) {
        p.orderPrice = snapped;
        p.orderLine.setPrice(snapped);
        p.orderLine.syncPosition();
        updateBracketPnl(p, snapped);
      }

      // Flip condition type when order/cond lines cross each other (limit only)
      if ((drag.target === 'cond' || drag.target === 'order') && !p.isMarket) {
        const shouldBeAbove = p.condPrice > p.orderPrice;
        if (shouldBeAbove !== p.isAbove) {
          p.isAbove = shouldBeAbove;
          const armBg = p.isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW;
          p.condLine?.setLineColor(p.isAbove ? CLR_ABOVE : CLR_BELOW);
          p.condLine?.updateSection(0, p.isAbove ? '\u25B2' : '\u25BC', armBg, '#fff');
          p.condLine?.updateSection(1, `If Close ${p.isAbove ? 'Above' : 'Below'} ${timeframe.label}`, '#cac9cb', '#000');
          p.condLine?.updateSection(3, 'ARM', armBg, '#fff');
          const sideBg = p.isAbove ? CLR_BUY : CLR_SELL;
          if (!p.isMarket) p.orderLine?.setLineColor(sideBg);
          const orderWord = p.isMarket ? 'Market' : 'Limit';
          p.orderLine?.updateSection(0, `${p.isAbove ? 'Buy' : 'Sell'} ${orderWord}`, '#cac9cb', '#000');
          p.orderLine?.updateSection(1, undefined, sideBg);
          // Update SL/TP PnL since direction flipped
          if (p.slLine && p.slPrice != null) {
            const slDiff = p.isAbove ? p.slPrice - p.orderPrice : p.orderPrice - p.slPrice;
            const slPnl = calcPnl(slDiff, contract!, p.size);
            p.slLine.updateSection(0, `-$${Math.abs(slPnl).toFixed(2)}`, CLR_SL, '#000');
          }
          for (const tp of p.tpLines) {
            const tpDiff = p.isAbove ? tp.price - p.orderPrice : p.orderPrice - tp.price;
            const tpPnl = calcPnl(tpDiff, contract!, tp.size);
            tp.line.updateSection(0, `+$${Math.abs(tpPnl).toFixed(2)}`, CLR_TP, '#000');
          }
        }
      }

      if (drag.target === 'sl' && p.slLine) {
        p.slPrice = snapped;
        p.slLine.setPrice(snapped);
        p.slLine.syncPosition();
        if (contract) {
          const diff = p.isAbove ? snapped - p.orderPrice : p.orderPrice - snapped;
          const pnl = calcPnl(diff, contract, p.size);
          p.slLine.updateSection(0, `-$${Math.abs(pnl).toFixed(2)}`, CLR_SL, '#000');
        }
      } else if (drag.target === 'tp' && drag.tpIndex != null) {
        const tpEntry = p.tpLines[drag.tpIndex];
        if (tpEntry) {
          tpEntry.price = snapped;
          tpEntry.line.setPrice(snapped);
          tpEntry.line.syncPosition();
          if (contract) {
            const diff = p.isAbove ? snapped - p.orderPrice : p.orderPrice - snapped;
            const pnl = calcPnl(diff, contract, tpEntry.size);
            tpEntry.line.updateSection(0, `+$${Math.abs(pnl).toFixed(2)}`, CLR_TP, '#000');
          }
        }
      }
    }

    /** Update SL/TP PnL labels when the reference price (order or market) moves */
    function updateBracketPnl(p: PreviewState, refPrice: number) {
      if (p.slLine && p.slPrice != null && contract) {
        const slDiff = p.isAbove ? p.slPrice - refPrice : refPrice - p.slPrice;
        const slPnl = calcPnl(slDiff, contract, p.size);
        p.slLine.updateSection(0, `-$${Math.abs(slPnl).toFixed(2)}`, CLR_SL, '#000');
      }
      for (const tp of p.tpLines) {
        const tpDiff = p.isAbove ? tp.price - refPrice : refPrice - tp.price;
        const tpPnl = calcPnl(tpDiff, contract!, tp.size);
        tp.line.updateSection(0, `+$${Math.abs(tpPnl).toFixed(2)}`, CLR_TP, '#000');
      }
    }

    function onMouseUp(_e: MouseEvent) {
      const drag = previewDragRef.current;
      if (!drag) return;
      previewDragRef.current = null;

      container!.style.cursor = '';
      chart!.applyOptions({ handleScroll: true, handleScale: true });

      const p = previewRef.current;
      if (!p) return;

      let line: PriceLevelLine | null = null;
      if (drag.target === 'tp' && drag.tpIndex != null) {
        line = p.tpLines[drag.tpIndex]?.line ?? null;
      } else {
        const lineMap: Record<string, PriceLevelLine | null> = { cond: p.condLine, order: p.orderLine, sl: p.slLine };
        line = lineMap[drag.target] ?? null;
      }
      const labelEl = line?.getLabelEl();
      if (labelEl) labelEl.style.cursor = 'grab';
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [contract, timeframe, refs, previewRef, previewDragRef]);
}
