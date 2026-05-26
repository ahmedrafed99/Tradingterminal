import { useStore } from '../../../store/useStore';
import type { FRVPDrawing } from '../../../types/drawing';
import { DEFAULT_FREEDRAW_COLOR, DEFAULT_FRVP_COLOR, DEFAULT_FIB_COLOR, DEFAULT_FIB_NEG_COLOR, DEFAULT_FIB_LEVELS } from '../../../types/drawing';
import { maybeSnap } from '../drawings/magnetSnap';
import type { DrawingContext } from './drawingInteraction';
import { getMousePos, getDataPos, pixelToAnchoredPoint, pointToPixelX } from './drawingInteraction';

/** Mousedown: Ctrl+drag area selection for multi-select. */
export function onCtrlDragSelectDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, container } = ctx;
  if (!e.ctrlKey || e.button !== 0) return;
  const st = useStore.getState();
  if (st.activeTool !== 'select') return;
  // Don't start if another interaction is in progress
  if (state.drawingDrag || state.ovalResize || state.arrowPathNodeDrag || state.ovalDrag
      || state.arrowPathCreation || state.rectCreation || state.rulerCreation || state.freeDrawCreation || state.frvpCreation) return;

  const { x, y } = getMousePos(e, container);
  state.ctrlDragSelect = { startX: x, startY: y };
  chart.applyOptions({ handleScroll: false, handleScale: false });
  e.stopPropagation();
  e.preventDefault();
}

/** Keyboard: Shift hold activates ruler tool, Shift release restores select. */
export function onShiftRulerKey(e: KeyboardEvent, ctx: DrawingContext): void {
  const { state } = ctx;
  const st = useStore.getState();

  if (e.type === 'keydown' && e.key === 'Shift' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    // Don't activate ruler while typing in an input/textarea
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
    // Don't activate if another interaction is in progress
    if (state.drawingDrag || state.ovalResize || state.arrowPathNodeDrag || state.ovalDrag
        || state.arrowPathCreation || state.rectCreation || state.freeDrawCreation || state.ctrlDragSelect) return;
    // Don't re-activate if a ruler was already drawn in this Shift hold
    if (state.shiftRulerConsumed) return;
    // Only activate from select tool (avoid overriding other tools)
    if (st.activeTool !== 'select' && st.activeTool !== 'ruler') return;
    if (st.activeTool !== 'ruler') {
      st.setActiveTool('ruler');
    }
  }

  if (e.type === 'keyup' && e.key === 'Shift') {
    // Reset consumed flag so next Shift press can activate ruler again
    state.shiftRulerConsumed = false;
    // Only restore if ruler is active and no ruler creation is in progress
    if (st.activeTool === 'ruler' && !state.rulerCreation && !state.rulerDisplayActive) {
      st.setActiveTool('select');
    }
  }
}

/** Mousedown: start oval/ruler resize by handle. */
export function onResizeMouseDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container, primitive } = ctx;
  const st = useStore.getState();
  if (st.activeTool !== 'select' || st.selectedDrawingIds.length !== 1) return;
  const drawing = st.drawings.find((d) => d.id === st.selectedDrawingIds[0]);
  if (!drawing || (drawing.type !== 'rect' && drawing.type !== 'oval' && drawing.type !== 'arrowpath' && drawing.type !== 'ruler' && drawing.type !== 'frvp' && drawing.type !== 'fib')) return;

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

  if (drawing.type !== 'rect' && drawing.type !== 'oval' && drawing.type !== 'ruler' && drawing.type !== 'frvp' && drawing.type !== 'fib') return;

  // Fib: p1/p2 handle drag (reuse ovalResize state to move one endpoint)
  if (drawing.type === 'fib') {
    const handle = hit.handle; // 'p1' or 'p2'
    if (handle !== 'p1' && handle !== 'p2') return;
    const fib = drawing as import('../../../types/drawing').FibDrawing;
    state.ovalResize = {
      drawingId: drawing.id,
      handle,
      fixedCorner: handle === 'p1' ? { ...fib.p2 } : { ...fib.p1 },
      movingCorner: handle === 'p1' ? { ...fib.p1 } : { ...fib.p2 },
      origP1: { ...fib.p1 },
      origP2: { ...fib.p2 },
    };
    container.style.cursor = 'grabbing';
    chart.applyOptions({ handleScroll: false, handleScale: false });
    e.stopPropagation();
    e.preventDefault();
    return;
  }

  // FRVP uses anchorTime/pMin/pMax — handle separately before p1/p2 reading
  if (drawing.type === 'frvp') {
    const handle = hit.handle;
    const frvp = drawing as FRVPDrawing;
    if (frvp.mode === 'range' && frvp.t2 !== undefined) {
      // Range mode: 'w' moves t1, 'e' moves t2
      if (handle !== 'w' && handle !== 'e') return;
      state.ovalResize = {
        drawingId: drawing.id,
        handle: handle,
        fixedCorner: { time: handle === 'w' ? frvp.t2 : frvp.anchorTime, price: frvp.pMax },
        movingCorner: { time: handle === 'w' ? frvp.anchorTime : frvp.t2, price: frvp.pMin },
        origP1: { time: frvp.anchorTime, price: frvp.pMin },
        origP2: { time: frvp.t2, price: frvp.pMax },
      };
    } else {
      // Anchor mode: 'n'/'s' moves price boundaries
      if (handle !== 'n' && handle !== 's') return;
      const fixedPrice = handle === 'n' ? drawing.pMin : drawing.pMax;
      const movingPrice = handle === 'n' ? drawing.pMax : drawing.pMin;
      state.ovalResize = {
        drawingId: drawing.id,
        handle,
        fixedCorner: { time: drawing.anchorTime, price: fixedPrice },
        movingCorner: { time: drawing.anchorTime, price: movingPrice },
        origP1: { time: drawing.anchorTime, price: drawing.pMin },
        origP2: { time: drawing.anchorTime, price: drawing.pMax },
      };
    }
    container.style.cursor = 'grabbing';
    chart.applyOptions({ handleScroll: false, handleScale: false });
    e.stopPropagation();
    e.preventDefault();
    return;
  }

  const p1 = drawing.p1;
  const p2 = drawing.p2;
  const sx1 = pointToPixelX(p1, chart);
  const sy1 = series.priceToCoordinate(p1.price);
  const sx2 = pointToPixelX(p2, chart);
  const sy2 = series.priceToCoordinate(p2.price);
  if (sx1 === null || sy1 === null || sx2 === null || sy2 === null) return;

  // Determine which original point provides X data and which provides Y data for the fixed corner
  const leftPt = sx1 < sx2 ? p1 : p2;
  const rightPt = sx1 < sx2 ? p2 : p1;
  const topPt = sy1 < sy2 ? p1 : p2;
  const bottomPt = sy1 < sy2 ? p2 : p1;
  const handle = hit.handle;

  // Fixed corner: take X-axis data (anchorTime/barOffset/time) from one point, price from another
  // Moving corner: the original corner opposite to fixedCorner (used to constrain cardinal handles)
  let fixedCorner: { time: number; price: number; anchorTime?: number; barOffset?: number };
  let movingCorner: { time: number; price: number; anchorTime?: number; barOffset?: number };
  if (handle === 'n' || handle === 'nw' || handle === 'w') {
    fixedCorner = { ...rightPt, price: bottomPt.price };
    movingCorner = { ...leftPt, price: topPt.price };
  } else if (handle === 'ne') {
    fixedCorner = { ...leftPt, price: bottomPt.price };
    movingCorner = { ...rightPt, price: topPt.price };
  } else if (handle === 'sw') {
    fixedCorner = { ...rightPt, price: topPt.price };
    movingCorner = { ...leftPt, price: bottomPt.price };
  } else {
    // se, s, e
    fixedCorner = { ...leftPt, price: topPt.price };
    movingCorner = { ...rightPt, price: bottomPt.price };
  }

  state.ovalResize = {
    drawingId: drawing.id,
    handle: handle,
    fixedCorner,
    movingCorner,
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
  } else if (drawing.type === 'rect') {
    const data = getDataPos(chart, series, x, y);
    if (!data) return;
    state.drawingDrag = {
      drawingId: drawing.id, type: 'rect',
      startX: x, startY: y, origPrice: 0,
      origP1: { ...drawing.p1 }, origP2: { ...drawing.p2 },
      startTime: data.time, startPrice: data.price, origStartTime: 0,
    };
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
      origBarOffsets: drawing.points.map((pt) => ({ barOffset: pt.barOffset, price: pt.price })),
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
      origBarOffsets: drawing.points.map((pt) => ({ barOffset: pt.barOffset, price: pt.price })),
      startTime: data.time, startPrice: data.price, origStartTime: 0,
    };
  } else if (drawing.type === 'frvp') {
    const data = getDataPos(chart, series, x, y);
    if (!data) return;
    // Store t2 in origP2.time for range-mode drawings (differs from origP1.time when range mode)
    const origT2 = (drawing as FRVPDrawing).mode === 'range' && (drawing as FRVPDrawing).t2 !== undefined
      ? (drawing as FRVPDrawing).t2!
      : drawing.anchorTime;
    state.drawingDrag = {
      drawingId: drawing.id, type: 'frvp',
      startX: x, startY: y, origPrice: 0,
      origP1: { time: drawing.anchorTime, price: drawing.pMin },
      origP2: { time: origT2, price: drawing.pMax },
      startTime: data.time, startPrice: data.price, origStartTime: 0,
    };
  } else if (drawing.type === 'fib') {
    const data = getDataPos(chart, series, x, y);
    if (!data) return;
    const fib = drawing as import('../../../types/drawing').FibDrawing;
    state.drawingDrag = {
      drawingId: drawing.id, type: 'fib',
      startX: x, startY: y, origPrice: 0,
      origP1: { ...fib.p1 }, origP2: { ...fib.p2 },
      startTime: data.time, startPrice: data.price, origStartTime: 0,
    };
  }

  st.setSelectedDrawingIds([drawing.id]);
  state.drawingJustSelected = true;
  container.style.cursor = 'grabbing';
  chart.applyOptions({ handleScroll: false, handleScale: false });
  e.preventDefault();
}

/** Mousedown: start rect creation on first click, or capture for second click. */
export function onRectMouseDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container, refs } = ctx;
  if (state.ovalResize || state.drawingDrag || state.arrowPathNodeDrag || state.arrowPathCreation || state.rulerCreation || state.freeDrawCreation || state.frvpCreation) return;
  const tool = useStore.getState().activeTool;
  if (tool !== 'rect') return;
  const { x, y } = getMousePos(e, container);
  const data = pixelToAnchoredPoint(chart, series, x, y);
  if (!data) return;

  chart.applyOptions({ handleScroll: false, handleScale: false });
  e.stopPropagation();
  e.preventDefault();

  // First click: start creation
  if (!state.rectCreation) {
    const startPrice = maybeSnap(e, data.price, x, chart, refs.bars.current);
    state.rectCreation = {
      startX: x, startY: startPrice !== data.price ? (series.priceToCoordinate(startPrice) ?? y) : y,
      startRawY: y,
      startTime: data.time, startPrice,
      startAnchorTime: data.anchorTime, startBarOffset: data.barOffset,
    };
  }
}

/** Mousedown: start oval drag-to-create. */
export function onOvalMouseDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container, refs } = ctx;
  if (state.ovalResize || state.drawingDrag || state.arrowPathNodeDrag || state.arrowPathCreation || state.rectCreation || state.rulerCreation || state.frvpCreation) return;
  const tool = useStore.getState().activeTool;
  if (tool !== 'oval') return;
  const { x, y } = getMousePos(e, container);
  const data = pixelToAnchoredPoint(chart, series, x, y);
  if (!data) return;
  const ovalStartPrice = maybeSnap(e, data.price, x, chart, refs.bars.current);
  const ovalStartY = ovalStartPrice !== data.price ? (series.priceToCoordinate(ovalStartPrice) ?? y) : y;
  state.ovalDrag = { startX: x, startY: ovalStartY, startTime: data.time, startPrice: ovalStartPrice, startAnchorTime: data.anchorTime, startBarOffset: data.barOffset, tool: 'oval' };
  chart.applyOptions({ handleScroll: false, handleScale: false });
  e.stopPropagation();
  e.preventDefault();
}

/** Mousedown: start free draw brush stroke. */
export function onFreeDrawMouseDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container } = ctx;
  if (state.ovalResize || state.drawingDrag || state.arrowPathNodeDrag || state.arrowPathCreation || state.rectCreation || state.rulerCreation || state.freeDrawCreation || state.frvpCreation) return;
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

/** Mousedown: start Fibonacci click-move-click creation. */
export function onFibMouseDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container, refs, contract } = ctx;
  if (state.ovalResize || state.drawingDrag || state.arrowPathNodeDrag || state.arrowPathCreation
      || state.rectCreation || state.rulerCreation || state.freeDrawCreation || state.frvpCreation || state.fibCreation) return;
  const tool = useStore.getState().activeTool;
  if (tool !== 'fib') return;

  const { x, y } = getMousePos(e, container);
  const anchorTimeRaw = chart.timeScale().coordinateToTime(x);
  if (!anchorTimeRaw) return;

  const rawPrice = series.coordinateToPrice(y);
  if (rawPrice === null) return;
  const startPrice = maybeSnap(e, rawPrice as number, x, chart, refs.bars.current);
  const startY = startPrice !== (rawPrice as number) ? (series.priceToCoordinate(startPrice) ?? y) : y;

  // Sub-bar precision anchor
  const snappedTime = anchorTimeRaw as number;
  const anchorX = chart.timeScale().timeToCoordinate(anchorTimeRaw) ?? x;
  const barSpacing = (chart.timeScale().options() as { barSpacing: number }).barSpacing;
  const barOffset = (x - anchorX) / barSpacing;

  state.fibCreation = {
    startX: x, startY,
    startTime: snappedTime, startPrice,
    startAnchorTime: snappedTime, startBarOffset: barOffset,
  };

  const fibDef = useStore.getState().drawingDefaults['fib'];
  const dec = contract ? (contract.tickSize.toString().split('.')[1]?.length ?? 0) : 2;
  ctx.primitive.setFibPreview({
    x1: x, y1: startY, x2: x, y2: startY,
    startPrice, endPrice: startPrice,
    levels: fibDef?.levels ?? DEFAULT_FIB_LEVELS.map((l) => ({ ...l })),
    color: fibDef?.color ?? DEFAULT_FIB_COLOR,
    negativeMasterColor: fibDef?.negativeMasterColor ?? DEFAULT_FIB_NEG_COLOR,
    strokeWidth: fibDef?.strokeWidth ?? 1,
    showNegative: fibDef?.showNegative ?? false,
    extendRight: fibDef?.extendRight ?? false,
    decimals: dec,
  });

  chart.applyOptions({ handleScroll: false, handleScale: false });
  e.stopPropagation();
  e.preventDefault();
}

/** Mousedown: start FRVP drag-to-create. */
export function onFRVPMouseDown(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, series, container, refs } = ctx;
  if (state.ovalResize || state.drawingDrag || state.arrowPathNodeDrag || state.arrowPathCreation
      || state.rectCreation || state.rulerCreation || state.freeDrawCreation || state.frvpCreation) return;
  const tool = useStore.getState().activeTool;
  if (tool !== 'frvp') return;
  const { x, y } = getMousePos(e, container);
  const anchorTimeRaw = chart.timeScale().coordinateToTime(x);
  if (!anchorTimeRaw) return;
  const frvpDef = useStore.getState().drawingDefaults['frvp'];
  const creationMode: 'anchor' | 'range' = frvpDef?.mode ?? 'anchor';

  if (creationMode === 'range') {
    // Range mode: horizontal drag selects t1→t2; price range is auto-computed from candles
    state.frvpCreation = {
      startX: x, startY: y,
      startTime: anchorTimeRaw as number, startPrice: 0,
      mode: 'range',
    };
    ctx.primitive.setFRVPRangePreview(x, y, x, y, 'rgba(180,180,180,0.7)');
  } else {
    // Anchor mode: vertical drag sets the price range on a single time anchor
    const rawPrice = series.coordinateToPrice(y);
    if (rawPrice === null) return;
    const startPrice = maybeSnap(e, rawPrice as number, x, chart, refs.bars.current);
    const startY = startPrice !== (rawPrice as number) ? (series.priceToCoordinate(startPrice) ?? y) : y;
    state.frvpCreation = {
      startX: x, startY,
      startTime: anchorTimeRaw as number, startPrice,
      mode: 'anchor',
    };
    ctx.primitive.setFRVPPreview(x, startY, startY, 'rgba(180,180,180,0.7)');
  }
  chart.applyOptions({ handleScroll: false, handleScale: false });
  e.stopPropagation();
  e.preventDefault();
}
