import type { Time } from 'lightweight-charts';
import { useStore } from '../../../store/useStore';
import { DEFAULT_OVAL_COLOR, DEFAULT_FREEDRAW_COLOR } from '../../../types/drawing';
import { computeRulerMetrics } from '../drawings/rulerMetrics';
import type { DrawingContext } from './drawingInteraction';
import { CROSSHAIR_CURSOR, getMousePos, getDataPos, resetChartInteraction } from './drawingInteraction';

// ═══════════════════════════════════════════════════════════════════
// Mouse-down handlers
// ═══════════════════════════════════════════════════════════════════

/** Mousedown: Ctrl+drag area selection for multi-select. */
export function onCtrlDragSelectDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, container } = ctx;
  if (!e.ctrlKey || e.button !== 0) return;
  const st = useStore.getState();
  if (st.activeTool !== 'select') return;
  // Don't start if another interaction is in progress
  if (state.drawingDrag || state.ovalResize || state.arrowPathNodeDrag || state.ovalDrag
      || state.arrowPathCreation || state.rulerCreation || state.freeDrawCreation) return;

  const { x, y } = getMousePos(e, container);
  state.ctrlDragSelect = { startX: x, startY: y };
  chart.applyOptions({ handleScroll: false, handleScale: false });
  e.stopPropagation();
  e.preventDefault();
}

/** Mousedown: start oval/ruler resize by handle. */
export function onResizeMouseDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container, primitive } = ctx;
  const st = useStore.getState();
  if (st.activeTool !== 'select' || st.selectedDrawingIds.length !== 1) return;
  const drawing = st.drawings.find((d) => d.id === st.selectedDrawingIds[0]);
  if (!drawing || (drawing.type !== 'oval' && drawing.type !== 'arrowpath' && drawing.type !== 'ruler')) return;

  const { x, y } = getMousePos(e, container);
  const hit = primitive.getHandleAt(x, y);
  if (!hit || hit.drawingId !== drawing.id) return;

  // Arrow path node drag
  if (drawing.type === 'arrowpath' && hit.handle.startsWith('node-')) {
    const nodeIndex = parseInt(hit.handle.replace('node-', ''), 10);
    if (!isNaN(nodeIndex)) {
      state.arrowPathNodeDrag = {
        drawingId: drawing.id,
        nodeIndex,
        anchorTime: drawing.anchorTime,
        origPoints: drawing.points.map((p) => ({ ...p })),
      };
      container.style.cursor = 'grabbing';
      chart.applyOptions({ handleScroll: false, handleScale: false });
      e.stopPropagation();
      e.preventDefault();
      return;
    }
  }

  if (drawing.type !== 'oval' && drawing.type !== 'ruler') return;

  const p1 = drawing.p1;
  const p2 = drawing.p2;
  const sx1 = chart.timeScale().timeToCoordinate(p1.time as unknown as Time);
  const sy1 = series.priceToCoordinate(p1.price);
  const sx2 = chart.timeScale().timeToCoordinate(p2.time as unknown as Time);
  const sy2 = series.priceToCoordinate(p2.price);
  if (sx1 === null || sy1 === null || sx2 === null || sy2 === null) return;

  state.ovalResize = {
    drawingId: drawing.id,
    handle: hit.handle,
    leftTime: sx1 < sx2 ? p1.time : p2.time,
    rightTime: sx1 < sx2 ? p2.time : p1.time,
    topPrice: sy1 < sy2 ? p1.price : p2.price,
    bottomPrice: sy1 < sy2 ? p2.price : p1.price,
    origP1: { ...p1 },
    origP2: { ...p2 },
  };

  container.style.cursor = 'grabbing';
  chart.applyOptions({ handleScroll: false, handleScale: false });
  e.stopPropagation();
  e.preventDefault();
}

/** Mousedown: start drawing drag-to-move. */
export function onDrawingDragMouseDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container, primitive, refs } = ctx;
  if (state.ovalResize || state.arrowPathNodeDrag) return;
  const st = useStore.getState();
  if (st.activeTool !== 'select') return;

  const { x, y } = getMousePos(e, container);
  const hit = primitive.hitTest(x, y);
  if (!hit || typeof hit.externalId !== 'string') return;

  const drawing = st.drawings.find((d) => d.id === hit.externalId);
  if (!drawing) return;

  if (drawing.type === 'hline') {
    const dragStartTime = chart.timeScale().coordinateToTime(x);
    state.drawingDrag = {
      drawingId: drawing.id, type: 'hline',
      startX: x, startY: y,
      origPrice: drawing.price,
      origP1: { time: 0, price: 0 }, origP2: { time: 0, price: 0 },
      startTime: dragStartTime ? (dragStartTime as number) : 0,
      startPrice: 0,
      origStartTime: drawing.startTime ?? 0,
    };
    refs.crosshairLabel.current?.suppress(true);
    chart.applyOptions({ crosshair: { horzLine: { labelVisible: false } } });
  } else if (drawing.type === 'oval') {
    const data = getDataPos(chart, series, x, y);
    if (!data) return;
    state.drawingDrag = {
      drawingId: drawing.id, type: 'oval',
      startX: x, startY: y, origPrice: 0,
      origP1: { ...drawing.p1 }, origP2: { ...drawing.p2 },
      startTime: data.time, startPrice: data.price, origStartTime: 0,
    };
  } else if (drawing.type === 'ruler') {
    const data = getDataPos(chart, series, x, y);
    if (!data) return;
    state.drawingDrag = {
      drawingId: drawing.id, type: 'ruler',
      startX: x, startY: y, origPrice: 0,
      origP1: { ...drawing.p1 }, origP2: { ...drawing.p2 },
      startTime: data.time, startPrice: data.price, origStartTime: 0,
    };
  } else if (drawing.type === 'arrowpath') {
    const data = getDataPos(chart, series, x, y);
    if (!data) return;
    state.drawingDrag = {
      drawingId: drawing.id, type: 'arrowpath',
      startX: x, startY: y, origPrice: 0,
      origP1: { time: 0, price: 0 }, origP2: { time: 0, price: 0 },
      origAnchorTime: drawing.anchorTime,
      origBarOffsets: drawing.points.map((p) => ({ barOffset: p.barOffset, price: p.price })),
      startTime: data.time, startPrice: data.price, origStartTime: 0,
    };
  } else if (drawing.type === 'freedraw') {
    const data = getDataPos(chart, series, x, y);
    if (!data) return;
    state.drawingDrag = {
      drawingId: drawing.id, type: 'freedraw',
      startX: x, startY: y, origPrice: 0,
      origP1: { time: 0, price: 0 }, origP2: { time: 0, price: 0 },
      origAnchorTime: drawing.anchorTime,
      origBarOffsets: drawing.points.map((p) => ({ barOffset: p.barOffset, price: p.price })),
      startTime: data.time, startPrice: data.price, origStartTime: 0,
    };
  }

  st.setSelectedDrawingIds([drawing.id]);
  container.style.cursor = 'grabbing';
  chart.applyOptions({ handleScroll: false, handleScale: false });
  e.preventDefault();
}

/** Mousedown: start oval drag-to-create. */
export function onOvalMouseDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container } = ctx;
  if (state.ovalResize || state.drawingDrag || state.arrowPathNodeDrag || state.arrowPathCreation || state.rulerCreation) return;
  const tool = useStore.getState().activeTool;
  if (tool !== 'oval') return;
  const { x, y } = getMousePos(e, container);
  const data = getDataPos(chart, series, x, y);
  if (!data) return;
  state.ovalDrag = { startX: x, startY: y, startTime: data.time, startPrice: data.price, tool: 'oval' };
  chart.applyOptions({ handleScroll: false, handleScale: false });
  e.stopPropagation();
  e.preventDefault();
}

/** Mousedown: start free draw brush stroke. */
export function onFreeDrawMouseDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container } = ctx;
  if (state.ovalResize || state.drawingDrag || state.arrowPathNodeDrag || state.arrowPathCreation || state.rulerCreation || state.freeDrawCreation) return;
  const tool = useStore.getState().activeTool;
  if (tool !== 'freedraw') return;
  const { x, y } = getMousePos(e, container);
  const price = series.coordinateToPrice(y);
  if (price === null) return;

  // Anchor = nearest bar time (snap is fine for the anchor reference point)
  const anchorTimeRaw = chart.timeScale().coordinateToTime(x);
  if (!anchorTimeRaw) return; // off visible time range — bail out
  const anchorTime = anchorTimeRaw as number;
  const anchorPixelX = chart.timeScale().timeToCoordinate(anchorTimeRaw) ?? x;
  const barSpacing = (chart.timeScale().options() as { barSpacing: number }).barSpacing;

  state.freeDrawCreation = {
    anchorTime,
    anchorPixelX,
    barSpacing,
    points: [{ barOffset: (x - anchorPixelX) / barSpacing, price: price as number }],
    cssPoints: [{ x, y }],
  };
  chart.applyOptions({ handleScroll: false, handleScale: false });

  const fdDef = useStore.getState().drawingDefaults['freedraw'];
  ctx.primitive.setFreeDrawPreview([{ x, y }], fdDef?.color ?? DEFAULT_FREEDRAW_COLOR, fdDef?.strokeWidth ?? 2);

  e.stopPropagation();
  e.preventDefault();
}

// ═══════════════════════════════════════════════════════════════════
// Mouse-move handler (big dispatch)
// ═══════════════════════════════════════════════════════════════════

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
      const price = series.coordinateToPrice(y);
      const currentTime = chart.timeScale().coordinateToTime(x);
      const patch: Record<string, unknown> = {};
      if (price !== null) patch.price = price as number;
      if (currentTime !== null && state.drawingDrag.startTime) {
        const dt = (currentTime as number) - state.drawingDrag.startTime;
        patch.startTime = state.drawingDrag.origStartTime + dt;
      }
      if (Object.keys(patch).length > 0) {
        useStore.getState().updateDrawing(state.drawingDrag.drawingId, patch, true);
      }
    } else if (state.drawingDrag.type === 'oval' || state.drawingDrag.type === 'ruler') {
      const data = getDataPos(chart, series, x, y);
      if (data) {
        const dt = data.time - state.drawingDrag.startTime;
        const dp = data.price - state.drawingDrag.startPrice;
        useStore.getState().updateDrawing(state.drawingDrag.drawingId, {
          p1: { time: state.drawingDrag.origP1.time + dt, price: state.drawingDrag.origP1.price + dp },
          p2: { time: state.drawingDrag.origP2.time + dt, price: state.drawingDrag.origP2.price + dp },
        }, true);
      }
    } else if ((state.drawingDrag.type === 'arrowpath' || state.drawingDrag.type === 'freedraw') && state.drawingDrag.origBarOffsets) {
      const data = getDataPos(chart, series, x, y);
      if (data) {
        const dt = data.time - state.drawingDrag.startTime;
        const dp = data.price - state.drawingDrag.startPrice;
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
    const price = series.coordinateToPrice(y);
    if (price !== null) {
      const anchorX = chart.timeScale().timeToCoordinate(state.arrowPathNodeDrag.anchorTime as unknown as Time);
      if (anchorX !== null) {
        const barSpacing = (chart.timeScale().options() as { barSpacing: number }).barSpacing;
        const barOffset = (x - anchorX) / barSpacing;
        const newPoints = state.arrowPathNodeDrag.origPoints.map((p) => ({ ...p }));
        newPoints[state.arrowPathNodeDrag.nodeIndex] = { barOffset, price: price as number };
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
    const data = getDataPos(chart, series, x, y);
    if (!data) return;

    const { leftTime: lt, rightTime: rt, topPrice: tp, bottomPrice: bp } = state.ovalResize;
    let newP1: { time: number; price: number };
    let newP2: { time: number; price: number };
    const h = state.ovalResize.handle;

    if (h === 'n')       { newP1 = { time: rt, price: bp }; newP2 = { time: data.time, price: data.price }; }
    else if (h === 's')  { newP1 = { time: lt, price: tp }; newP2 = { time: data.time, price: data.price }; }
    else if (h === 'e')  { newP1 = { time: lt, price: tp }; newP2 = { time: data.time, price: data.price }; }
    else if (h === 'w')  { newP1 = { time: rt, price: bp }; newP2 = { time: data.time, price: data.price }; }
    else return;

    useStore.getState().updateDrawing(state.ovalResize.drawingId, { p1: newP1, p2: newP2 }, true);
    e.stopPropagation();
    e.preventDefault();
    return;
  }

  // Arrow path creation preview
  if (state.arrowPathCreation) {
    const { x, y } = getMousePos(e, container);
    primitive.setArrowPathPreview([...state.arrowPathCreation.cssPoints, { x, y }]);
    return;
  }

  // Ruler creation preview
  if (state.rulerCreation) {
    const { x, y } = getMousePos(e, container);
    const data = getDataPos(chart, series, x, y);
    let metrics = null;
    if (data) {
      const p1 = { time: state.rulerCreation.startTime, price: state.rulerCreation.startPrice };
      metrics = computeRulerMetrics(refs.bars.current, p1, data);
    }
    const dec = contract ? (contract.tickSize.toString().split('.')[1]?.length ?? 0) : 2;
    primitive.setRulerDragPreview(state.rulerCreation.startX, state.rulerCreation.startY, x, y, metrics, dec);
    return;
  }

  // Free draw creation: add points as mouse moves
  if (state.freeDrawCreation) {
    const { x, y } = getMousePos(e, container);
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

  // Oval creation drag preview
  if (!state.ovalDrag) return;
  const { x, y } = getMousePos(e, container);
  primitive.setDragPreview(state.ovalDrag.startX, state.ovalDrag.startY, x, y);
}

// ═══════════════════════════════════════════════════════════════════
// Mouse-up handler (big dispatch)
// ═══════════════════════════════════════════════════════════════════

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
      } else if (state.drawingDrag.type === 'oval' || state.drawingDrag.type === 'ruler') {
        prev.p1 = { ...state.drawingDrag.origP1 };
        prev.p2 = { ...state.drawingDrag.origP2 };
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
        const metrics = computeRulerMetrics(refs.bars.current, d.p1, d.p2);
        useStore.getState().updateDrawing(d.id, { metrics });
      }
    }
    refs.crosshairLabel.current?.suppress(false);
    state.drawingDrag = null;
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
    useStore.getState().pushDrawingUndo({
      type: 'update',
      drawingId: state.ovalResize.drawingId,
      previous: { p1: { ...state.ovalResize.origP1 }, p2: { ...state.ovalResize.origP2 } },
    });
    const resized = useStore.getState().drawings.find((d) => d.id === state.ovalResize!.drawingId);
    if (resized && resized.type === 'ruler') {
      const metrics = computeRulerMetrics(refs.bars.current, resized.p1, resized.p2);
      useStore.getState().updateDrawing(resized.id, { metrics });
    }
    state.ovalResize = null;
    resetChartInteraction(ctx);
    return;
  }

  // Free draw creation: mouseup finalizes the stroke
  if (state.freeDrawCreation && e.button === 0) {
    const { x, y } = getMousePos(e, container);
    const price = series.coordinateToPrice(y);
    if (price !== null) {
      const barOffset = (x - state.freeDrawCreation.anchorPixelX) / state.freeDrawCreation.barSpacing;
      state.freeDrawCreation.points.push({ barOffset, price: price as number });
    }
    primitive.clearFreeDrawPreview();
    chart.applyOptions({ handleScroll: true, handleScale: true });
    if (state.freeDrawCreation.points.length >= 2 && contract) {
      const fdDef = useStore.getState().drawingDefaults['freedraw'];
      useStore.getState().addDrawing({
        id: crypto.randomUUID(),
        type: 'freedraw',
        anchorTime: state.freeDrawCreation.anchorTime,
        points: [...state.freeDrawCreation.points],
        color: fdDef?.color ?? DEFAULT_FREEDRAW_COLOR,
        strokeWidth: fdDef?.strokeWidth ?? 2,
        text: null,
        contractId: String(contract.id),
      });
    }
    state.freeDrawCreation = null;
    // Keep freedraw tool active so user can draw multiple strokes
    return;
  }

  // Arrow path creation: left-click adds nodes
  if (useStore.getState().activeTool === 'arrowpath' && e.button === 0) {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height
        && container.contains(e.target as Node)) {
      const price = series.coordinateToPrice(y);
      if (price !== null && contract !== null) {
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
            points: [{ barOffset, price: price as number }],
            cssPoints: [{ x, y }],
          };
          chart.applyOptions({ handleScroll: false, handleScale: false });
        } else {
          const barOffset = (x - state.arrowPathCreation.anchorPixelX) / state.arrowPathCreation.barSpacing;
          state.arrowPathCreation.points.push({ barOffset, price: price as number });
          state.arrowPathCreation.cssPoints.push({ x, y });
        }
        primitive.setArrowPathPreview(state.arrowPathCreation.cssPoints);
      }
    }
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
          state.rulerCreation = { startX: x, startY: y, startTime: data.time, startPrice: data.price };
          chart.applyOptions({ handleScroll: false, handleScale: false });
        } else {
          state.rulerCreation = null;
          state.rulerDisplayActive = true;
          chart.applyOptions({ handleScroll: true, handleScale: true });
          useStore.getState().setActiveTool('select');
        }
      }
    }
    return;
  }

  // Oval creation drag end
  if (!state.ovalDrag) return;
  const { x, y } = getMousePos(e, container);
  const endData = getDataPos(chart, series, x, y);

  primitive.clearDragPreview();
  chart.applyOptions({ handleScroll: true, handleScale: true });

  if (endData && contract) {
    const dx = Math.abs(x - state.ovalDrag.startX);
    const dy = Math.abs(y - state.ovalDrag.startY);
    if (dx > 5 || dy > 5) {
      const ovalDef = useStore.getState().drawingDefaults['oval'];
      useStore.getState().addDrawing({
        id: crypto.randomUUID(),
        type: 'oval',
        p1: { time: state.ovalDrag.startTime, price: state.ovalDrag.startPrice },
        p2: { time: endData.time, price: endData.price },
        color: ovalDef?.color ?? DEFAULT_OVAL_COLOR,
        strokeWidth: ovalDef?.strokeWidth ?? 1,
        text: null,
        contractId: String(contract.id),
      });
    }
  }

  state.ovalDrag = null;
  useStore.getState().setActiveTool('select');
}
