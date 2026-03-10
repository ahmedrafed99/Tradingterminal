import { useStore } from '../../../store/useStore';
import { DEFAULT_ARROWPATH_COLOR } from '../../../types/drawing';
import type { DrawingContext } from './drawingInteraction';
import { CROSSHAIR_CURSOR, getMousePos, getDataPos, resetChartInteraction } from './drawingInteraction';

// ─── Resize handle cursor ───
const HANDLE_CURSOR = 'grab';

// ═══════════════════════════════════════════════════════════════════
// Context menu (right-click cancel / finalize arrow path)
// ═══════════════════════════════════════════════════════════════════

export function onContextMenu(e: MouseEvent, ctx: DrawingContext): void {
  e.preventDefault();
  const { state, chart, series, container, primitive, contract } = ctx;
  const { activeTool, setActiveTool } = useStore.getState();

  // Arrow path in progress: finalize it
  if (state.arrowPathCreation) {
    e.stopPropagation();
    const { x, y } = getMousePos(e, container);
    const data = getDataPos(chart, series, x, y);
    if (data) {
      const last = state.arrowPathCreation.points[state.arrowPathCreation.points.length - 1];
      const dx = Math.abs(data.time - last.time);
      const dy = Math.abs(data.price - last.price);
      if (dx > 0.0001 || dy > 0.0001) {
        state.arrowPathCreation.points.push(data);
      }
    }

    const { addDrawing, drawingDefaults: ctxDef } = useStore.getState();
    const apDef = ctxDef['arrowpath'];
    if (state.arrowPathCreation.points.length >= 2 && contract) {
      addDrawing({
        id: crypto.randomUUID(),
        type: 'arrowpath',
        points: [...state.arrowPathCreation.points],
        color: apDef?.color ?? DEFAULT_ARROWPATH_COLOR,
        strokeWidth: apDef?.strokeWidth ?? 2,
        text: null,
        contractId: String(contract.id),
      });
    }
    state.arrowPathCreation = null;
    primitive.clearArrowPathPreview();
    resetChartInteraction(ctx);
    setActiveTool('select');
    return;
  }

  // Ruler in progress: cancel
  if (state.rulerCreation) {
    state.rulerCreation = null;
    primitive.clearRulerDragPreview();
    resetChartInteraction(ctx);
    setActiveTool('select');
    return;
  }

  // Any other drawing tool active: cancel to select
  if (activeTool !== 'select') {
    setActiveTool('select');
  }
}

// ═══════════════════════════════════════════════════════════════════
// Double-click (finalize arrow path)
// ═══════════════════════════════════════════════════════════════════

export function onDblClick(e: MouseEvent, ctx: DrawingContext): void {
  const { state, chart, primitive, contract } = ctx;
  if (!state.arrowPathCreation) return;
  e.stopPropagation();
  e.preventDefault();

  // Remove duplicate last point from double-click
  const pts = state.arrowPathCreation.points;
  if (pts.length >= 2) {
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    if (Math.abs(last.time - prev.time) < 0.0001 && Math.abs(last.price - prev.price) < 0.0001) {
      pts.pop();
      state.arrowPathCreation.cssPoints.pop();
    }
  }

  const { addDrawing, setActiveTool, drawingDefaults: dblDef } = useStore.getState();
  const dblApDef = dblDef['arrowpath'];
  if (state.arrowPathCreation.points.length >= 2 && contract) {
    addDrawing({
      id: crypto.randomUUID(),
      type: 'arrowpath',
      points: [...state.arrowPathCreation.points],
      color: dblApDef?.color ?? DEFAULT_ARROWPATH_COLOR,
      strokeWidth: dblApDef?.strokeWidth ?? 2,
      text: null,
      contractId: String(contract.id),
    });
  }
  state.arrowPathCreation = null;
  primitive.clearArrowPathPreview();
  chart.applyOptions({ handleScroll: true, handleScale: true });
  setActiveTool('select');
}

// ═══════════════════════════════════════════════════════════════════
// Keyboard handler (Escape / Delete / Ctrl+Z)
// ═══════════════════════════════════════════════════════════════════

export function onKeyDown(e: KeyboardEvent, ctx: DrawingContext): void {
  const { state, chart, container, primitive } = ctx;

  if (e.key === 'Escape') {
    if (state.rulerCreation) {
      state.rulerCreation = null;
      primitive.clearRulerDragPreview();
      resetChartInteraction(ctx);
      useStore.getState().setActiveTool('select');
      return;
    }
    if (state.rulerDisplayActive) {
      state.rulerDisplayActive = false;
      primitive.clearRulerDragPreview();
      return;
    }
    if (state.arrowPathCreation) {
      state.arrowPathCreation = null;
      primitive.clearArrowPathPreview();
      resetChartInteraction(ctx);
      useStore.getState().setActiveTool('select');
      return;
    }
    if (state.arrowPathNodeDrag) {
      useStore.getState().updateDrawing(state.arrowPathNodeDrag.drawingId, {
        points: state.arrowPathNodeDrag.origPoints,
      }, true);
      state.arrowPathNodeDrag = null;
      resetChartInteraction(ctx);
      return;
    }
    if (state.drawingDrag) {
      if (state.drawingDrag.type === 'hline') {
        useStore.getState().updateDrawing(state.drawingDrag.drawingId, {
          price: state.drawingDrag.origPrice, startTime: state.drawingDrag.origStartTime,
        }, true);
      } else if (state.drawingDrag.type === 'arrowpath' && state.drawingDrag.origPoints) {
        useStore.getState().updateDrawing(state.drawingDrag.drawingId, {
          points: state.drawingDrag.origPoints,
        }, true);
      } else {
        useStore.getState().updateDrawing(state.drawingDrag.drawingId, {
          p1: state.drawingDrag.origP1, p2: state.drawingDrag.origP2,
        }, true);
      }
      state.drawingDrag = null;
      state.drawingDragOccurred = false;
      resetChartInteraction(ctx);
      return;
    }
    if (state.ovalResize) {
      useStore.getState().updateDrawing(state.ovalResize.drawingId, {
        p1: state.ovalResize.origP1, p2: state.ovalResize.origP2,
      }, true);
      state.ovalResize = null;
      resetChartInteraction(ctx);
      return;
    }
    const s = useStore.getState();
    if (s.activeTool !== 'select') {
      s.setActiveTool('select');
      if (state.ovalDrag) {
        primitive.clearDragPreview();
        state.ovalDrag = null;
        chart.applyOptions({ handleScroll: true, handleScale: true });
      }
    } else if (s.selectedDrawingId) {
      s.setSelectedDrawingId(null);
    }
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const s = useStore.getState();
    if (s.selectedDrawingId) {
      s.removeDrawing(s.selectedDrawingId);
      s.setSelectedDrawingId(null);
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    if (e.defaultPrevented) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    useStore.getState().undoDrawing();
  }
}

// ═══════════════════════════════════════════════════════════════════
// Cursor / hover management
// ═══════════════════════════════════════════════════════════════════

export function onHandleHover(e: MouseEvent, ctx: DrawingContext): void {
  const { state, container, primitive, refs } = ctx;

  // Re-assert grabbing during ANY drag operation
  if (state.ovalResize || state.ovalDrag || state.drawingDrag || state.arrowPathNodeDrag || state.chartPanning
      || refs.orderDragState.current || refs.previewDragState.current || refs.posDrag.current) {
    container.style.cursor = 'grabbing';
    return;
  }

  const st = useStore.getState();
  const { x, y } = getMousePos(e, container);

  // Resize handles (only in select mode with selection)
  if (st.activeTool === 'select' && st.selectedDrawingId) {
    const hit = primitive.getHandleAt(x, y);
    if (hit) {
      container.style.cursor = HANDLE_CURSOR;
      return;
    }
  }

  // Drawing body → pointer
  if (st.activeTool === 'select') {
    const bodyHit = primitive.hitTest(x, y);
    if (bodyHit && typeof bodyHit.externalId === 'string') {
      container.style.cursor = 'pointer';
      return;
    }
  }

  // Overlay label hit targets
  const mx = e.clientX;
  const my = e.clientY;
  const sortedTargets = refs.hitTargets.current.slice().sort((a, b) => a.priority - b.priority);
  let overLabel = false;
  for (const target of sortedTargets) {
    const el = target.el;
    if (el.offsetParent === null) continue;
    const tRect = el.getBoundingClientRect();
    if (tRect.width === 0 || tRect.height === 0) continue;
    if (mx >= tRect.left && mx <= tRect.right && my >= tRect.top && my <= tRect.bottom) {
      container.style.cursor = target.priority >= 2 ? 'grab' : 'pointer';
      overLabel = true;
      break;
    }
  }

  // Hide quick-order button while hovering a label
  refs.labelHovered.current = overLabel;
  const qoEl = refs.quickOrder.current;
  if (qoEl) qoEl.style.display = overLabel ? 'none' : '';

  if (overLabel) return;

  // Default: crosshair
  container.style.cursor = CROSSHAIR_CURSOR;
}
