import type { Time } from 'lightweight-charts';
import { useStore } from '../../../store/useStore';
import type { FRVPDrawing } from '../../../types/drawing';
import { DEFAULT_OVAL_FILL, DEFAULT_FREEDRAW_COLOR, DEFAULT_FRVP_COLOR, DEFAULT_RECT_COLOR, DEFAULT_RECT_FILL } from '../../../types/drawing';
import { computeRulerMetrics } from '../drawings/rulerMetrics';
import { maybeSnap } from '../drawings/magnetSnap';
import type { DrawingContext } from './drawingInteraction';
import { getMousePos, getDataPos, pixelToAnchoredPoint } from './drawingInteraction';

export function onMouseMove(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container, primitive, contract, refs } = ctx;

  // Ctrl+drag area selection
  if (state.ctrlDragSelect) {
    const { x, y } = getMousePos(e, container);
    primitive.setSelectionRect(state.ctrlDragSelect.startX, state.ctrlDragSelect.startY, x, y);
    return;
  }

  // Drawing drag-to-move
  if (state.drawingDrag) {
    container.style.cursor = 'grabbing';
    const { x, y } = getMousePos(e, container);
    const dx = Math.abs(x - state.drawingDrag.startX);
    const dy = Math.abs(y - state.drawingDrag.startY);
    if (dx < 3 && dy < 3) return;
    state.drawingDragOccurred = true;

    if (state.drawingDrag.type === 'hline') {
      const rawPrice = series.coordinateToPrice(y);
      const currentTime = chart.timeScale().coordinateToTime(x);
      const patch: Record<string, unknown> = {};
      if (rawPrice !== null) {
        patch.price = maybeSnap(e, rawPrice as number, x, chart, refs.bars.current);
      }
      if (currentTime !== null && state.drawingDrag.startTime) {
        const dt = (currentTime as number) - state.drawingDrag.startTime;
        patch.startTime = state.drawingDrag.origStartTime + dt;
      }
      if (Object.keys(patch).length > 0) {
        useStore.getState().updateDrawing(state.drawingDrag.drawingId, patch, true);
      }
    } else if (state.drawingDrag.type === 'rect' || state.drawingDrag.type === 'oval' || state.drawingDrag.type === 'ruler') {
      const data = getDataPos(chart, series, x, y);
      if (data) {
        const dp = maybeSnap(e, data.price, x, chart, refs.bars.current) - state.drawingDrag.startPrice;
        const dt = data.time - state.drawingDrag.startTime;
        const o1 = state.drawingDrag.origP1;
        const o2 = state.drawingDrag.origP2;
        useStore.getState().updateDrawing(state.drawingDrag.drawingId, {
          p1: {
            time: o1.time + dt, price: o1.price + dp,
            anchorTime: o1.anchorTime !== undefined ? o1.anchorTime + dt : undefined,
            barOffset: o1.barOffset,
          },
          p2: {
            time: o2.time + dt, price: o2.price + dp,
            anchorTime: o2.anchorTime !== undefined ? o2.anchorTime + dt : undefined,
            barOffset: o2.barOffset,
          },
        }, true);
      }
    } else if (state.drawingDrag.type === 'frvp') {
      const data = getDataPos(chart, series, x, y);
      if (data) {
        const dt = data.time - state.drawingDrag.startTime;
        const newAnchorTime = state.drawingDrag.origP1.time + dt;
        const isRange = state.drawingDrag.origP2.time !== state.drawingDrag.origP1.time;
        if (isRange) {
          // Range mode: shift both t1 and t2 by dt; pMin/pMax are fixed (auto-computed from candles)
          const newT2 = state.drawingDrag.origP2.time + dt;
          const bounds = primitive.computeRangeBounds(newAnchorTime, newT2);
          useStore.getState().updateDrawing(state.drawingDrag.drawingId, {
            anchorTime: newAnchorTime,
            t2: newT2,
            ...(bounds ? { pMin: bounds.pMin, pMax: bounds.pMax } : {}),
          } as Partial<FRVPDrawing>, true);
        } else {
          // Anchor mode: shift time + price
          const dp = maybeSnap(e, data.price, x, chart, refs.bars.current) - state.drawingDrag.startPrice;
          useStore.getState().updateDrawing(state.drawingDrag.drawingId, {
            anchorTime: newAnchorTime,
            pMin: state.drawingDrag.origP1.price + dp,
            pMax: state.drawingDrag.origP2.price + dp,
          }, true);
        }
      }
    } else if ((state.drawingDrag.type === 'arrowpath' || state.drawingDrag.type === 'freedraw') && state.drawingDrag.origBarOffsets) {
      const data = getDataPos(chart, series, x, y);
      if (data) {
        const dt = data.time - state.drawingDrag.startTime;
        const dp = maybeSnap(e, data.price, x, chart, refs.bars.current) - state.drawingDrag.startPrice;
        useStore.getState().updateDrawing(state.drawingDrag.drawingId, {
          anchorTime: (state.drawingDrag.origAnchorTime ?? 0) + dt,
          points: state.drawingDrag.origBarOffsets.map((p) => ({ barOffset: p.barOffset, price: p.price + dp })),
        }, true);
      }
    }
    e.stopPropagation();
    e.preventDefault();
    return;
  }

  // Arrow path node drag
  if (state.arrowPathNodeDrag) {
    container.style.cursor = 'grabbing';
    const { x, y } = getMousePos(e, container);
    const rawPrice = series.coordinateToPrice(y);
    if (rawPrice !== null) {
      const anchorX = chart.timeScale().timeToCoordinate(state.arrowPathNodeDrag.anchorTime as unknown as Time);
      if (anchorX !== null) {
        const barSpacing = (chart.timeScale().options() as { barSpacing: number }).barSpacing;
        const barOffset = (x - anchorX) / barSpacing;
        const nodePrice = maybeSnap(e, rawPrice as number, x, chart, refs.bars.current);
        const newPoints = state.arrowPathNodeDrag.origPoints.map((p) => ({ ...p }));
        newPoints[state.arrowPathNodeDrag.nodeIndex] = { barOffset, price: nodePrice };
        useStore.getState().updateDrawing(state.arrowPathNodeDrag.drawingId, { points: newPoints }, true);
      }
    }
    e.stopPropagation();
    e.preventDefault();
    return;
  }

  // Oval/ruler resize drag
  if (state.ovalResize) {
    container.style.cursor = 'grabbing';
    const { x, y } = getMousePos(e, container);
    const data = pixelToAnchoredPoint(chart, series, x, y);
    if (!data) return;

    const newP1 = state.ovalResize.fixedCorner;
    const h = state.ovalResize.handle;
    let newP2: { time: number; price: number; anchorTime?: number; barOffset?: number };

    const resizePrice = (rawPrice: number) => maybeSnap(e, rawPrice, x, chart, refs.bars.current);

    const resizingDrawing = useStore.getState().drawings.find((d) => d.id === state.ovalResize!.drawingId);
    if (resizingDrawing?.type === 'frvp') {
      const frvp = resizingDrawing as FRVPDrawing;
      const h = state.ovalResize.handle;
      if (frvp.mode === 'range' && (h === 'w' || h === 'e')) {
        // Range mode: move t1 or t2, recompute pMin/pMax from bars
        const newTimeRaw = chart.timeScale().coordinateToTime(x);
        if (newTimeRaw === null) return;
        const newTime = newTimeRaw as number;
        const fixedTime = state.ovalResize.fixedCorner.time;
        const t1 = Math.min(newTime, fixedTime);
        const t2 = Math.max(newTime, fixedTime);
        const bounds = primitive.computeRangeBounds(t1, t2);
        useStore.getState().updateDrawing(state.ovalResize.drawingId, {
          anchorTime: t1, t2,
          ...(bounds ? { pMin: bounds.pMin, pMax: bounds.pMax } : {}),
        } as Partial<FRVPDrawing>, true);
      } else {
        // Anchor mode: only price changes
        const fixedPrice = state.ovalResize.fixedCorner.price;
        const newPrice = resizePrice(data.price);
        useStore.getState().updateDrawing(state.ovalResize.drawingId, {
          pMin: Math.min(fixedPrice, newPrice),
          pMax: Math.max(fixedPrice, newPrice),
        }, true);
      }
    } else {
      if (h === 'n' || h === 's') {
        // Cardinal vertical: only price follows mouse, X stays from original moving corner
        const mc = state.ovalResize.movingCorner;
        newP2 = { time: mc.time, price: resizePrice(data.price), anchorTime: mc.anchorTime, barOffset: mc.barOffset };
      } else if (h === 'w' || h === 'e') {
        // Cardinal horizontal: only X follows mouse, price stays from original moving corner
        newP2 = { time: data.time, price: state.ovalResize.movingCorner.price, anchorTime: data.anchorTime, barOffset: data.barOffset };
      } else {
        // Corner handles: both axes follow mouse
        newP2 = { time: data.time, price: resizePrice(data.price), anchorTime: data.anchorTime, barOffset: data.barOffset };
      }
      useStore.getState().updateDrawing(state.ovalResize.drawingId, { p1: newP1, p2: newP2 }, true);
    }
    e.stopPropagation();
    e.preventDefault();
    return;
  }

  // Rect creation preview (click-click)
  if (state.rectCreation) {
    const { x, y } = getMousePos(e, container);
    let previewY = y;
    const rp = series.coordinateToPrice(y);
    if (rp !== null) {
      const snapped = maybeSnap(e, rp as number, x, chart, refs.bars.current);
      if (snapped !== (rp as number)) { const sy = series.priceToCoordinate(snapped); if (sy !== null) previewY = sy; }
    }
    const rectDef = useStore.getState().drawingDefaults['rect'];
    primitive.setRectPreview(
      state.rectCreation.startX, state.rectCreation.startY, x, previewY,
      {
        color:           rectDef?.color           ?? DEFAULT_RECT_COLOR,
        fillColor:       rectDef?.fillColor        ?? DEFAULT_RECT_FILL,
        strokeWidth:     rectDef?.strokeWidth      ?? 1,
        lineStyle:       rectDef?.lineStyle        ?? 'solid',
        extendMode:      rectDef?.extendMode       ?? 'none',
        middleLine:      rectDef?.middleLine       ?? false,
        middleLineColor: rectDef?.middleLineColor  ?? rectDef?.color ?? DEFAULT_RECT_COLOR,
        middleLineStyle: rectDef?.middleLineStyle  ?? 'dashed',
      },
    );
    return;
  }

  // Arrow path creation preview
  if (state.arrowPathCreation) {
    const { x, y } = getMousePos(e, container);
    // Ctrl = snap to horizontal (lock Y to last placed node)
    const snapY = e.ctrlKey
      ? state.arrowPathCreation.cssPoints[state.arrowPathCreation.cssPoints.length - 1].y
      : y;
    primitive.setArrowPathPreview([...state.arrowPathCreation.cssPoints, { x, y: snapY }]);
    return;
  }

  // Ruler creation preview
  if (state.rulerCreation) {
    const { x, y } = getMousePos(e, container);
    const data = getDataPos(chart, series, x, y);
    let metrics = null;
    let previewY = y;
    if (data) {
      const p2Price = maybeSnap(e, data.price, x, chart, refs.bars.current);
      if (p2Price !== data.price) {
        const sy = series.priceToCoordinate(p2Price);
        if (sy !== null) previewY = sy;
      }
      const p1 = { time: state.rulerCreation.startTime, price: state.rulerCreation.startPrice };
      metrics = computeRulerMetrics(refs.bars.current, p1, { time: data.time, price: p2Price }, contract?.tickSize ?? 0);
    }
    const dec = contract ? (contract.tickSize.toString().split('.')[1]?.length ?? 0) : 2;
    primitive.setRulerDragPreview(state.rulerCreation.startX, state.rulerCreation.startY, x, previewY, metrics, dec);
    return;
  }

  // Free draw creation: add points as mouse moves
  if (state.freeDrawCreation) {
    const { x, y: rawY } = getMousePos(e, container);
    // Ctrl = snap to horizontal (lock Y to last point)
    const y = e.ctrlKey ? state.freeDrawCreation.cssPoints[state.freeDrawCreation.cssPoints.length - 1].y : rawY;
    // Only add point if far enough from last point (3px minimum distance)
    const last = state.freeDrawCreation.cssPoints[state.freeDrawCreation.cssPoints.length - 1];
    const dx = x - last.x;
    const dy = y - last.y;
    if (dx * dx + dy * dy < 9) return;
    const price = series.coordinateToPrice(y);
    if (price !== null) {
      const barOffset = (x - state.freeDrawCreation.anchorPixelX) / state.freeDrawCreation.barSpacing;
      state.freeDrawCreation.points.push({ barOffset, price: price as number });
      state.freeDrawCreation.cssPoints.push({ x, y });
      const fdDef = useStore.getState().drawingDefaults['freedraw'];
      primitive.setFreeDrawPreview(
        state.freeDrawCreation.cssPoints,
        fdDef?.color ?? DEFAULT_FREEDRAW_COLOR,
        fdDef?.strokeWidth ?? 2,
      );
    }
    return;
  }

  // FRVP creation drag preview
  if (state.frvpCreation) {
    const frvpDef = useStore.getState().drawingDefaults['frvp'];
    const color = frvpDef?.color ?? DEFAULT_FRVP_COLOR;
    if (state.frvpCreation.mode === 'range') {
      const { x, y } = getMousePos(e, container);
      primitive.setFRVPRangePreview(state.frvpCreation.startX, state.frvpCreation.startY, x, y, color);
    } else {
      // Anchor mode: Y moves, show vertical bar with endpoints
      const { y } = getMousePos(e, container);
      let previewY = y;
      const rp = series.coordinateToPrice(y);
      if (rp !== null) {
        const snapped = maybeSnap(e, rp as number, state.frvpCreation.startX, chart, refs.bars.current);
        if (snapped !== (rp as number)) { const sy = series.priceToCoordinate(snapped); if (sy !== null) previewY = sy; }
      }
      primitive.setFRVPPreview(state.frvpCreation.startX, state.frvpCreation.startY, previewY, color);
    }
    return;
  }

  // Oval creation drag preview
  if (!state.ovalDrag) return;
  const { x, y } = getMousePos(e, container);
  let ovalPreviewY = y;
  const op = series.coordinateToPrice(y);
  if (op !== null) {
    const snapped = maybeSnap(e, op as number, x, chart, refs.bars.current);
    if (snapped !== op) {
      const sy = series.priceToCoordinate(snapped);
      if (sy !== null) ovalPreviewY = sy;
    }
  }
  const ovalDef = useStore.getState().drawingDefaults['oval'];
  primitive.setDragPreview(state.ovalDrag.startX, state.ovalDrag.startY, x, ovalPreviewY, ovalDef?.fillColor ?? DEFAULT_OVAL_FILL);
}
