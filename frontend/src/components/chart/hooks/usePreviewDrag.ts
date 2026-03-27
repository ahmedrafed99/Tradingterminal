import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { bracketEngine } from '../../../services/bracketEngine';
import { priceToPoints } from '../../../utils/instrument';
import type { ChartRefs } from './types';

// Custom white crosshair cursor (24x24 SVG, hotspot at center)
const CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cline x1='12' y1='0' x2='12' y2='24' stroke='%23ffffff' stroke-width='2'/%3E%3Cline x1='0' y1='12' x2='24' y2='12' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`;

/**
 * Handle drag interaction for preview lines (entry, SL, TP).
 * Initiated from overlay labels via previewDragState ref.
 */
export function usePreviewDrag(
  refs: ChartRefs,
  contract: Contract | null,
  isOrderChart: boolean,
): void {
  const previewEnabled = useStore((s) => s.previewEnabled);
  const previewHideEntry = useStore((s) => s.previewHideEntry);

  useEffect(() => {
    if (!isOrderChart) return;
    const container = refs.container.current;
    if (!container || (!previewEnabled && !previewHideEntry) || !contract) return;

    function snap(price: number): number {
      const ts = contract!.tickSize;
      return Math.round(price / ts) * ts;
    }

    function onMouseMove(e: MouseEvent) {
      const drag = refs.previewDragState.current;
      if (!drag) return;

      // Don't stopPropagation — let LWC see the event so crosshair stays visible
      e.preventDefault();

      const rect = container!.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const series = refs.series.current;
      if (!series) return;
      const rawPrice = series.coordinateToPrice(mouseY);
      if (rawPrice === null) return;
      const snapped = snap(rawPrice as number);

      // Regular order panel preview drag
      const pvLine = refs.previewLines.current[drag.lineIdx];
      if (pvLine) { pvLine.setPrice(snapped); pvLine.syncPosition(); }
      refs.previewPrices.current[drag.lineIdx] = snapped;
      refs.updateOverlay.current();

      const st = useStore.getState();

      if (drag.role.kind === 'entry') {
        st.setOrderType('limit');
        st.setLimitPrice(snapped);
      } else {
        const entryPrice = st.orderType === 'limit' ? st.limitPrice : st.lastPrice;
        if (entryPrice) {
          const pts = priceToPoints(Math.abs(entryPrice - snapped), contract!);
          const rounded = Math.max(1, Math.round(pts));
          const hasPreset = st.bracketPresets.some((p) => p.id === st.activePresetId);
          if (drag.role.kind === 'sl') {
            if (hasPreset) st.setDraftSlPoints(rounded);
            else st.setAdHocSlPoints(rounded);
          } else if (drag.role.kind === 'tp') {
            if (hasPreset) st.setDraftTpPoints(drag.role.index, rounded);
            else st.updateAdHocTpPoints(drag.role.index, rounded);
          }
        }
      }
    }

    function onMouseUp(e: MouseEvent) {
      const drag = refs.previewDragState.current;
      if (drag) {
        // Entry label click-vs-drag: if movement < 4px, treat as click (submit order)
        const click = refs.entryClick.current;
        if (click) {
          const dx = Math.abs(e.clientX - click.downX);
          const dy = Math.abs(e.clientY - click.downY);
          if (dx < 4 && dy < 4) click.exec();
          refs.entryClick.current = null;
        }

        // Update engine's armed config so fills use adjusted bracket values (2+ TP path)
        if (previewHideEntry && drag.role.kind !== 'entry') {
          const st = useStore.getState();
          bracketEngine.updateArmedConfig((cfg) => ({
            ...cfg,
            stopLoss: st.draftSlPoints != null
              ? { ...cfg.stopLoss, points: st.draftSlPoints }
              : cfg.stopLoss,
            takeProfits: cfg.takeProfits.map((tp, i) => {
              const draft = st.draftTpPoints[i];
              return draft != null ? { ...tp, points: draft } : tp;
            }),
          }));
        }

        refs.previewDragState.current = null;
        if (refs.activeDragRow.current) {
          refs.activeDragRow.current.style.cursor = 'pointer';
          refs.activeDragRow.current = null;
        }
        if (refs.container.current) refs.container.current.style.cursor = CROSSHAIR_CURSOR;
        // Re-enable LWC scroll/scale after drag
        if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: true, handleScale: true });
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isOrderChart, previewEnabled, previewHideEntry, contract]);
}
