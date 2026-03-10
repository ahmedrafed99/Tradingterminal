import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { conditionService } from '../../../services/conditionService';
import { useStore } from '../../../store/useStore';
import type { PriceLevelLine } from '../PriceLevelLine';
import type { ChartRefs } from './types';
import { showToast, errorMessage } from '../../../utils/toast';
import { snapToTickSize } from '../barUtils';
import type { ArmedDragState } from './conditionLineTypes';

/**
 * Effect 2: Mouse move/up handlers for dragging armed condition lines.
 * Small drag (<4px) opens the condition modal instead.
 */
export function useArmedConditionDrag(
  refs: ChartRefs,
  contract: Contract | null,
  linesRef: React.MutableRefObject<PriceLevelLine[]>,
  dragRef: React.MutableRefObject<ArmedDragState | null>,
): void {
  useEffect(() => {
    const container = refs.container.current;
    const series = refs.series.current;
    const chart = refs.chart.current;
    if (!container || !series || !chart || !contract) return;

    const tickSize = contract.tickSize;

    function onMouseMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = container!.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const rawPrice = series!.coordinateToPrice(y);
      if (rawPrice === null) return;
      const snapped = snapToTickSize(rawPrice, tickSize);
      const line = linesRef.current[drag.lineIdx];
      if (line) { line.setPrice(snapped); line.syncPosition(); }
    }

    function onMouseUp(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      container!.style.cursor = '';
      chart!.applyOptions({ handleScroll: true, handleScale: true });
      const line = linesRef.current[drag.lineIdx];
      const labelEl = line?.getLabelEl();
      if (labelEl) labelEl.style.cursor = 'grab';

      const dy = Math.abs(e.clientY - drag.startY);
      if (dy < 4) {
        if (line) { line.setPrice(drag.originalPrice); line.syncPosition(); }
        if (drag.field === 'triggerPrice') {
          useStore.getState().openConditionModal(drag.condId);
        }
        return;
      }

      const newPrice = line?.getPrice() ?? drag.originalPrice;
      if (newPrice === drag.originalPrice) return;
      const url = useStore.getState().conditionServerUrl;
      if (!url) return;
      conditionService.update(url, drag.condId, { [drag.field]: newPrice })
        .then((updated) => { useStore.getState().upsertCondition(updated); })
        .catch((err) => {
          if (line) { line.setPrice(drag.originalPrice); line.syncPosition(); }
          showToast('error', 'Failed to update condition', errorMessage(err));
        });
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [contract, refs, linesRef, dragRef]);
}
