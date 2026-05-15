import { useStore } from '../../../store/useStore';
import type { FRVPDrawing } from '../../../types/drawing';
import { DEFAULT_OVAL_COLOR, DEFAULT_OVAL_FILL, DEFAULT_RECT_COLOR, DEFAULT_RECT_FILL, DEFAULT_FREEDRAW_COLOR, DEFAULT_FRVP_COLOR } from '../../../types/drawing';
import { computeRulerMetrics } from '../drawings/rulerMetrics';
import { maybeSnap } from '../drawings/magnetSnap';
import type { DrawingContext } from './drawingInteraction';
import { CROSSHAIR_CURSOR, getMousePos, getDataPos, resetChartInteraction, pixelToAnchoredPoint } from './drawingInteraction';

export function onMouseUp(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container, primitive, contract, refs } = ctx;

  // Ctrl+drag area selection end
  if (state.ctrlDragSelect) {
    const { x, y } = getMousePos(e, container);
    const ids = primitive.getDrawingsInRect(
      state.ctrlDragSelect.startX, state.ctrlDragSelect.startY, x, y
    );
    primitive.clearSelectionRect();
    state.ctrlDragSelect = null;
    resetChartInteraction(ctx);
    if (ids.length > 0) {
      useStore.getState().setSelectedDrawingIds(ids);
    }
    return;
  }

  // Dismiss ephemeral ruler on any left click after it's shown
  if (state.rulerDisplayActive && e.button === 0) {
    state.rulerDisplayActive = false;
    primitive.clearRulerDragPreview();
    return;
  }

  // Drawing drag-to-move end
  if (state.drawingDrag) {
    if (state.drawingDragOccurred) {
      const prev: Record<string, unknown> = {};
      if (state.drawingDrag.type === 'hline') {
        prev.price = state.drawingDrag.origPrice;
        prev.startTime = state.drawingDrag.origStartTime;
      } else if (state.drawingDrag.type === 'rect' || state.drawingDrag.type === 'oval' || state.drawingDrag.type === 'ruler') {
        prev.p1 = { ...state.drawingDrag.origP1 };
        prev.p2 = { ...state.drawingDrag.origP2 };
      } else if (state.drawingDrag.type === 'frvp') {
        prev.anchorTime = state.drawingDrag.origP1.time;
        prev.pMin = state.drawingDrag.origP1.price;
        prev.pMax = state.drawingDrag.origP2.price;
        // If range mode (t2 stored in origP2.time), restore it too
        if (state.drawingDrag.origP2.time !== state.drawingDrag.origP1.time) {
          (prev as Partial<FRVPDrawing>).t2 = state.drawingDrag.origP2.time;
        }
      } else if ((state.drawingDrag.type === 'arrowpath' || state.drawingDrag.type === 'freedraw') && state.drawingDrag.origBarOffsets) {
        prev.anchorTime = state.drawingDrag.origAnchorTime;
        prev.points = state.drawingDrag.origBarOffsets.map((p) => ({ ...p }));
      }
      useStore.getState().pushDrawingUndo({ type: 'update', drawingId: state.drawingDrag.drawingId, previous: prev });
    }
    // Recompute ruler metrics after move
    if (state.drawingDrag.type === 'ruler' && state.drawingDragOccurred) {
      const d = useStore.getState().drawings.find((dd) => dd.id === state.drawingDrag!.drawingId);
      if (d && d.type === 'ruler') {
        const metrics = computeRulerMetrics(refs.bars.current, d.p1, d.p2, contract?.tickSize ?? 0);
        useStore.getState().updateDrawing(d.id, { metrics });
      }
    }
    refs.crosshairLabel.current?.suppress(false);
    state.drawingDrag = null;
    state.drawingDragOccurred = false;
    state.drawingJustSelected = false;
    container.style.cursor = CROSSHAIR_CURSOR;
    chart.applyOptions({ handleScroll: true, handleScale: true, crosshair: { horzLine: { labelVisible: true } } });
    return;
  }

  // Arrow path node drag end
  if (state.arrowPathNodeDrag) {
    useStore.getState().pushDrawingUndo({
      type: 'update',
      drawingId: state.arrowPathNodeDrag.drawingId,
      previous: { points: state.arrowPathNodeDrag.origPoints.map((p) => ({ ...p })) },
    });
    state.arrowPathNodeDrag = null;
    resetChartInteraction(ctx);
    return;
  }

  // Resize drag end
  if (state.ovalResize) {
    const resizedDrawing = useStore.getState().drawings.find((d) => d.id === state.ovalResize!.drawingId);
    const frvpResized = resizedDrawing?.type === 'frvp' ? resizedDrawing as FRVPDrawing : null;
    const undoPrev = frvpResized
      ? (frvpResized.mode === 'range'
        ? { anchorTime: state.ovalResize.origP1.time, t2: state.ovalResize.origP2.time, pMin: state.ovalResize.origP1.price, pMax: state.ovalResize.origP2.price }
        : { pMin: state.ovalResize.origP1.price, pMax: state.ovalResize.origP2.price })
      : { p1: { ...state.ovalResize.origP1 }, p2: { ...state.ovalResize.origP2 } };
    useStore.getState().pushDrawingUndo({
      type: 'update',
      drawingId: state.ovalResize.drawingId,
      previous: undoPrev,
    });
    const resized = useStore.getState().drawings.find((d) => d.id === state.ovalResize!.drawingId);
    if (resized && resized.type === 'ruler') {
      const metrics = computeRulerMetrics(refs.bars.current, resized.p1, resized.p2, contract?.tickSize ?? 0);
      useStore.getState().updateDrawing(resized.id, { metrics });
    }
    // Dragging the t2 handle manually disables auto-follow
    if (frvpResized?.mode === 'range' && state.ovalResize.handle === 'e') {
      useStore.getState().updateDrawing(state.ovalResize.drawingId, { t2Auto: false } as Partial<FRVPDrawing>);
    }
    state.ovalResize = null;
    resetChartInteraction(ctx);
    return;
  }

  // Free draw creation: mouseup finalizes the stroke
  if (state.freeDrawCreation && e.button === 0) {
    // Add final point (skip if Ctrl-snapping to avoid vertical jump at end)
    if (!e.ctrlKey) {
      const { x, y } = getMousePos(e, container);
      const price = series.coordinateToPrice(y);
      if (price !== null) {
        const barOffset = (x - state.freeDrawCreation.anchorPixelX) / state.freeDrawCreation.barSpacing;
        state.freeDrawCreation.points.push({ barOffset, price: price as number });
      }
    }
    primitive.clearFreeDrawPreview();
    chart.applyOptions({ handleScroll: true, handleScale: true });
    if (state.freeDrawCreation.points.length >= 2 && contract) {
      const fdDef = useStore.getState().drawingDefaults['freedraw'];
      const createdId = crypto.randomUUID();
      useStore.getState().addDrawing({
        id: createdId,
        type: 'freedraw',
        anchorTime: state.freeDrawCreation.anchorTime,
        points: [...state.freeDrawCreation.points],
        color: fdDef?.color ?? DEFAULT_FREEDRAW_COLOR,
        strokeWidth: fdDef?.strokeWidth ?? 2,
        lineStyle: fdDef?.lineStyle ?? 'solid',
        text: null,
        contractId: String(contract.id),
      });
      useStore.getState().setSelectedDrawingIds([createdId]);
    }
    state.freeDrawCreation = null;
    return;
  }

  // FRVP creation: drag to create
  if (state.frvpCreation && e.button === 0) {
    const { x, y } = getMousePos(e, container);
    chart.applyOptions({ handleScroll: true, handleScale: true });
    const frvpDef = useStore.getState().drawingDefaults['frvp'];

    if (state.frvpCreation.mode === 'range') {
      primitive.clearFRVPRangePreview();
      const dx = Math.abs(x - state.frvpCreation.startX);
      if (dx > 5 && contract !== null) {
        const endTimeRaw = chart.timeScale().coordinateToTime(x);
        if (endTimeRaw !== null) {
          const t1 = Math.min(state.frvpCreation.startTime, endTimeRaw as number);
          const t2 = Math.max(state.frvpCreation.startTime, endTimeRaw as number);
          const bounds = primitive.computeRangeBounds(t1, t2);
          if (!bounds) { state.frvpCreation = null; return; }
          const createdId = crypto.randomUUID();
          useStore.getState().addDrawing({
            id: createdId,
            type: 'frvp',
            mode: 'range',
            anchorTime: t1,
            t2,
            t2Auto: true,
            pMin: bounds.pMin,
            pMax: bounds.pMax,
            color: frvpDef?.color ?? DEFAULT_FRVP_COLOR,
            strokeWidth: frvpDef?.strokeWidth ?? 1,
            lineStyle: frvpDef?.lineStyle ?? 'solid',
            numBars: frvpDef?.numBars,
            rowSizeMode: frvpDef?.rowSizeMode,
            rowSizePrice: frvpDef?.rowSizePrice,
            rowTickSize: frvpDef?.rowTickSize,
            pocColor: frvpDef?.pocColor,
            showPoc: frvpDef?.showPoc,
            extendPoc: frvpDef?.extendPoc,
            showBarValues: frvpDef?.showBarValues,
            valuesBgColor: frvpDef?.valuesBgColor ?? 'rgba(0,0,0,0.55)',
            text: null,
            contractId: String(contract.id),
          });
          useStore.getState().setActiveTool('select');
          useStore.getState().setSelectedDrawingIds([createdId]);
        }
      }
    } else {
      primitive.clearFRVPPreview();
      const dy = Math.abs(y - state.frvpCreation.startY);
      if (dy > 5 && contract !== null) {
        const rawEndPrice = series.coordinateToPrice(y);
        if (rawEndPrice !== null) {
          const endPrice = maybeSnap(e, rawEndPrice as number, state.frvpCreation.startX, chart, refs.bars.current);
          const createdId = crypto.randomUUID();
          useStore.getState().addDrawing({
            id: createdId,
            type: 'frvp',
            mode: 'anchor',
            anchorTime: state.frvpCreation.startTime,
            pMin: Math.min(state.frvpCreation.startPrice, endPrice),
            pMax: Math.max(state.frvpCreation.startPrice, endPrice),
            color: frvpDef?.color ?? DEFAULT_FRVP_COLOR,
            strokeWidth: frvpDef?.strokeWidth ?? 1,
            lineStyle: frvpDef?.lineStyle ?? 'solid',
            numBars: frvpDef?.numBars,
            rowSizeMode: frvpDef?.rowSizeMode,
            rowSizePrice: frvpDef?.rowSizePrice,
            rowTickSize: frvpDef?.rowTickSize,
            pocColor: frvpDef?.pocColor,
            showPoc: frvpDef?.showPoc,
            extendPoc: frvpDef?.extendPoc,
            showBarValues: frvpDef?.showBarValues,
            valuesBgColor: frvpDef?.valuesBgColor ?? 'rgba(0,0,0,0.55)',
            text: null,
            contractId: String(contract.id),
          });
          useStore.getState().setActiveTool('select');
          useStore.getState().setSelectedDrawingIds([createdId]);
        }
      }
    }
    state.frvpCreation = null;
    return;
  }

  // Arrow path creation: left-click adds nodes
  if (useStore.getState().activeTool === 'arrowpath' && e.button === 0) {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    // Ctrl = snap to horizontal (lock Y to last placed node) — only when not using magnet
    if (e.ctrlKey && !useStore.getState().magnetEnabled && state.arrowPathCreation) {
      y = state.arrowPathCreation.cssPoints[state.arrowPathCreation.cssPoints.length - 1].y;
    }
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height
        && container.contains(e.target as Node)) {
      const rawPrice = series.coordinateToPrice(y);
      if (rawPrice !== null && contract !== null) {
        const nodePrice = maybeSnap(e, rawPrice as number, x, chart, refs.bars.current);
        const nodeY = nodePrice !== (rawPrice as number) ? (series.priceToCoordinate(nodePrice) ?? y) : y;
        if (!state.arrowPathCreation) {
          // First click: compute anchor
          const anchorTimeRaw = chart.timeScale().coordinateToTime(x);
          if (!anchorTimeRaw) return; // off visible time range — bail out
          const anchorTime = anchorTimeRaw as number;
          const anchorPixelX = chart.timeScale().timeToCoordinate(anchorTimeRaw) ?? x;
          const barSpacing = (chart.timeScale().options() as { barSpacing: number }).barSpacing;
          const barOffset = (x - anchorPixelX) / barSpacing;
          state.arrowPathCreation = {
            anchorTime, anchorPixelX, barSpacing,
            points: [{ barOffset, price: nodePrice }],
            cssPoints: [{ x, y: nodeY }],
          };
          chart.applyOptions({ handleScroll: false, handleScale: false });
        } else {
          const barOffset = (x - state.arrowPathCreation.anchorPixelX) / state.arrowPathCreation.barSpacing;
          state.arrowPathCreation.points.push({ barOffset, price: nodePrice });
          state.arrowPathCreation.cssPoints.push({ x, y: nodeY });
        }
        primitive.setArrowPathPreview(state.arrowPathCreation.cssPoints);
      }
    }
    return;
  }

  // Rect creation: finalize on mouseup if dragged enough, otherwise wait for second click
  if (state.rectCreation && useStore.getState().activeTool === 'rect' && e.button === 0) {
    const { x, y } = getMousePos(e, container);
    const dx = Math.abs(x - state.rectCreation.startX);
    const dy = Math.abs(y - state.rectCreation.startRawY);
    // If mouse moved enough → finalize (drag-release flow)
    if (dx > 5 || dy > 5) {
      let createdId: string | null = null;
      const data = pixelToAnchoredPoint(chart, series, x, y);
      if (data && contract !== null) {
        const p2Price = maybeSnap(e, data.price, x, chart, refs.bars.current);
        const rectDef = useStore.getState().drawingDefaults['rect'];
        createdId = crypto.randomUUID();
        useStore.getState().addDrawing({
          id: createdId,
          type: 'rect',
          p1: {
            time: state.rectCreation.startTime, price: state.rectCreation.startPrice,
            anchorTime: state.rectCreation.startAnchorTime, barOffset: state.rectCreation.startBarOffset,
          },
          p2: { time: data.time, price: p2Price, anchorTime: data.anchorTime, barOffset: data.barOffset },
          color: rectDef?.color ?? DEFAULT_RECT_COLOR,
          strokeWidth: rectDef?.strokeWidth ?? 1,
          lineStyle: rectDef?.lineStyle ?? 'solid',
          fillColor: rectDef?.fillColor ?? DEFAULT_RECT_FILL,
          extendMode: rectDef?.extendMode ?? 'none',
          middleLine: rectDef?.middleLine ?? false,
          middleLineColor: rectDef?.middleLineColor,
          middleLineStyle: rectDef?.middleLineStyle ?? 'dashed',
          text: null,
          contractId: String(contract.id),
        });
      }
      state.rectCreation = null;
      primitive.clearRectPreview();
      chart.applyOptions({ handleScroll: true, handleScale: true });
      useStore.getState().setActiveTool('select');
      if (createdId) useStore.getState().setSelectedDrawingIds([createdId]);
    }
    // If not moved enough → keep rectCreation active (click-move-click flow, wait for second click)
    return;
  }

  // Rect: second click finalizes (click-move-click flow)
  if (!state.rectCreation && useStore.getState().activeTool === 'rect' && e.button === 0) {
    // rectCreation was started on mousedown of THIS click — do nothing, wait for move
    return;
  }

  // Ruler click-move-click
  if (useStore.getState().activeTool === 'ruler' && e.button === 0) {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height
        && container.contains(e.target as Node)) {
      const data = getDataPos(chart, series, x, y);
      if (data && contract !== null) {
        if (!state.rulerCreation) {
          const rulerStartPrice = maybeSnap(e, data.price, x, chart, refs.bars.current);
          const rulerStartY = rulerStartPrice !== data.price ? (series.priceToCoordinate(rulerStartPrice) ?? y) : y;
          state.rulerCreation = { startX: x, startY: rulerStartY, startTime: data.time, startPrice: rulerStartPrice };
          chart.applyOptions({ handleScroll: false, handleScale: false });
        } else {
          state.rulerCreation = null;
          state.rulerDisplayActive = true;
          state.shiftRulerConsumed = true;
          chart.applyOptions({ handleScroll: true, handleScale: true });
          useStore.getState().setActiveTool('select');
        }
      }
    }
    return;
  }

  // Oval creation drag end
  if (!state.ovalDrag) return;
  if (e.button !== 0) {
    // Right-click during drag: cancel without creating
    state.ovalDrag = null;
    primitive.clearDragPreview();
    chart.applyOptions({ handleScroll: true, handleScale: true });
    return;
  }
  const { x, y } = getMousePos(e, container);
  const endData = pixelToAnchoredPoint(chart, series, x, y);

  primitive.clearDragPreview();
  chart.applyOptions({ handleScroll: true, handleScale: true });

  let createdId: string | null = null;
  if (endData && contract) {
    const dx = Math.abs(x - state.ovalDrag.startX);
    const dy = Math.abs(y - state.ovalDrag.startY);
    if (dx > 5 || dy > 5) {
      const ovalEndPrice = maybeSnap(e, endData.price, x, chart, refs.bars.current);
      const ovalDef = useStore.getState().drawingDefaults['oval'];
      createdId = crypto.randomUUID();
      useStore.getState().addDrawing({
        id: createdId,
        type: 'oval',
        p1: {
          time: state.ovalDrag.startTime, price: state.ovalDrag.startPrice,
          anchorTime: state.ovalDrag.startAnchorTime, barOffset: state.ovalDrag.startBarOffset,
        },
        p2: { time: endData.time, price: ovalEndPrice, anchorTime: endData.anchorTime, barOffset: endData.barOffset },
        color: ovalDef?.color ?? DEFAULT_OVAL_COLOR,
        strokeWidth: ovalDef?.strokeWidth ?? 1,
        lineStyle: ovalDef?.lineStyle ?? 'solid',
        fillColor: ovalDef?.fillColor ?? DEFAULT_OVAL_FILL,
        text: null,
        contractId: String(contract.id),
      });
    }
  }

  state.ovalDrag = null;
  useStore.getState().setActiveTool('select');
  if (createdId) useStore.getState().setSelectedDrawingIds([createdId]);
}
