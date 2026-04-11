import { useStore } from '../../../store/useStore';
import { DEFAULT_ARROWPATH_COLOR } from '../../../types/drawing';
import { matchesShortcut, getEffectiveShortcuts } from '../../../constants/shortcuts';
import type { DrawingContext } from './drawingInteraction';
import { CROSSHAIR_CURSOR, getMousePos, getDataPos, resetChartInteraction } from './drawingInteraction';
import { CLOSE_BG, CLOSE_BG_HOVER } from './labelUtils';

// ─── Close-cell hover tracking ───
let _hoveredCloseCell: HTMLElement | null = null;

// ─── Throttle for hover hit testing ───
let _hoverRafPending = false;
let _lastCursor = '';

function clearCloseHover(): void {
  if (_hoveredCloseCell) {
    _hoveredCloseCell.style.background = CLOSE_BG;
    _hoveredCloseCell = null;
  }
}

// ─── Resize handle cursor ───
const HANDLE_CURSOR_MAP: Record<string, string> = {
  nw: 'nw-resize', ne: 'ne-resize', sw: 'sw-resize', se: 'se-resize',
  n: 'n-resize', s: 's-resize', w: 'w-resize', e: 'e-resize',
};

function getHandleCursor(handle: string): string {
  return HANDLE_CURSOR_MAP[handle] ?? 'grab';
}

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
    const { x, y: rawY } = getMousePos(e, container);
    // Ctrl = snap to horizontal (lock Y to last placed node)
    const y = e.ctrlKey
      ? state.arrowPathCreation.cssPoints[state.arrowPathCreation.cssPoints.length - 1].y
      : rawY;
    const price = series.coordinateToPrice(y);
    if (price !== null) {
      const barOffset = (x - state.arrowPathCreation.anchorPixelX) / state.arrowPathCreation.barSpacing;
      const last = state.arrowPathCreation.points[state.arrowPathCreation.points.length - 1];
      const dbo = Math.abs(barOffset - last.barOffset);
      const dp = Math.abs((price as number) - last.price);
      if (dbo > 0.01 || dp > 0.0001) {
        state.arrowPathCreation.points.push({ barOffset, price: price as number });
      }
    }

    const { addDrawing, setSelectedDrawingIds, drawingDefaults: ctxDef } = useStore.getState();
    const apDef = ctxDef['arrowpath'];
    let createdId: string | null = null;
    if (state.arrowPathCreation.points.length >= 2 && contract) {
      createdId = crypto.randomUUID();
      addDrawing({
        id: createdId,
        type: 'arrowpath',
        anchorTime: state.arrowPathCreation.anchorTime,
        points: [...state.arrowPathCreation.points],
        color: apDef?.color ?? DEFAULT_ARROWPATH_COLOR,
        strokeWidth: apDef?.strokeWidth ?? 2,
        lineStyle: apDef?.lineStyle ?? 'solid',
        text: null,
        contractId: String(contract.id),
      });
    }
    state.arrowPathCreation = null;
    primitive.clearArrowPathPreview();
    resetChartInteraction(ctx);
    setActiveTool('select');
    if (createdId) setSelectedDrawingIds([createdId]);
    return;
  }

  // Rect in progress: cancel
  if (state.rectCreation) {
    state.rectCreation = null;
    primitive.clearRectPreview();
    resetChartInteraction(ctx);
    setActiveTool('select');
    return;
  }

  // Free draw in progress: cancel
  if (state.freeDrawCreation) {
    state.freeDrawCreation = null;
    primitive.clearFreeDrawPreview();
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
    if (Math.abs(last.barOffset - prev.barOffset) < 0.01 && Math.abs(last.price - prev.price) < 0.0001) {
      pts.pop();
      state.arrowPathCreation.cssPoints.pop();
    }
  }

  const { addDrawing, setActiveTool, setSelectedDrawingIds, drawingDefaults: dblDef } = useStore.getState();
  const dblApDef = dblDef['arrowpath'];
  let createdId: string | null = null;
  if (state.arrowPathCreation.points.length >= 2 && contract) {
    createdId = crypto.randomUUID();
    addDrawing({
      id: createdId,
      type: 'arrowpath',
      anchorTime: state.arrowPathCreation.anchorTime,
      points: [...state.arrowPathCreation.points],
      color: dblApDef?.color ?? DEFAULT_ARROWPATH_COLOR,
      strokeWidth: dblApDef?.strokeWidth ?? 2,
      lineStyle: dblApDef?.lineStyle ?? 'solid',
      text: null,
      contractId: String(contract.id),
    });
  }
  state.arrowPathCreation = null;
  primitive.clearArrowPathPreview();
  chart.applyOptions({ handleScroll: true, handleScale: true });
  setActiveTool('select');
  if (createdId) setSelectedDrawingIds([createdId]);
}

// ═══════════════════════════════════════════════════════════════════
// Keyboard handler (Escape / Delete / Ctrl+Z)
// ═══════════════════════════════════════════════════════════════════

export function onKeyDown(e: KeyboardEvent, ctx: DrawingContext): void {
  const { state, chart, container, primitive } = ctx;
  const shortcuts = getEffectiveShortcuts(useStore.getState().customShortcuts);

  if (matchesShortcut(e, shortcuts['drawing.cancel'])) {
    if (state.ctrlDragSelect) {
      state.ctrlDragSelect = null;
      primitive.clearSelectionRect();
      resetChartInteraction(ctx);
      return;
    }
    if (state.rectCreation) {
      state.rectCreation = null;
      primitive.clearRectPreview();
      resetChartInteraction(ctx);
      useStore.getState().setActiveTool('select');
      return;
    }
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
    if (state.freeDrawCreation) {
      state.freeDrawCreation = null;
      primitive.clearFreeDrawPreview();
      resetChartInteraction(ctx);
      useStore.getState().setActiveTool('select');
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
        points: [...state.arrowPathNodeDrag.origPoints],
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
      } else if ((state.drawingDrag.type === 'arrowpath' || state.drawingDrag.type === 'freedraw') && state.drawingDrag.origBarOffsets) {
        useStore.getState().updateDrawing(state.drawingDrag.drawingId, {
          anchorTime: state.drawingDrag.origAnchorTime,
          points: state.drawingDrag.origBarOffsets.map((p) => ({ ...p })),
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
    } else if (s.selectedDrawingIds.length > 0) {
      s.setSelectedDrawingIds([]);
    }
  }

  if (matchesShortcut(e, shortcuts['drawing.delete'])) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const s = useStore.getState();
    if (s.selectedDrawingIds.length > 0) {
      if (s.selectedDrawingIds.length === 1) {
        s.removeDrawing(s.selectedDrawingIds[0]);
      } else {
        s.removeDrawings(s.selectedDrawingIds);
      }
      s.setSelectedDrawingIds([]);
    }
  }

  if (matchesShortcut(e, shortcuts['drawing.undo'])) {
    if (e.defaultPrevented) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    useStore.getState().undoDrawing();
  }

  if (matchesShortcut(e, shortcuts['drawing.toggleMagnet'])) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
    useStore.getState().toggleMagnet();
  }
}

// ═══════════════════════════════════════════════════════════════════
// Cursor / hover management
// ═══════════════════════════════════════════════════════════════════

function setCursor(container: HTMLElement, cursor: string): void {
  if (_lastCursor !== cursor) {
    _lastCursor = cursor;
    container.style.cursor = cursor;
  }
}

export function onHandleHover(e: MouseEvent, ctx: DrawingContext): void {
  const { state, container, refs } = ctx;

  // Re-assert grabbing during ANY drag operation (cheap checks, no throttle needed)
  if (state.ctrlDragSelect) {
    setCursor(container, 'crosshair');
    return;
  }
  if (state.ovalResize || state.ovalDrag || state.drawingDrag || state.arrowPathNodeDrag || state.rectCreation || state.freeDrawCreation || state.chartPanning
      || refs.orderDragState.current || refs.previewDragState.current || refs.posDrag.current) {
    setCursor(container, 'grabbing');
    return;
  }

  // Throttle the expensive part (hit testing, getBoundingClientRect) to once per frame
  if (_hoverRafPending) return;
  _hoverRafPending = true;

  // Only capture cheap client coords here — defer getBoundingClientRect to inside RAF
  const mx = e.clientX;
  const my = e.clientY;

  requestAnimationFrame(() => {
    _hoverRafPending = false;
    const { primitive } = ctx;
    const st = useStore.getState();
    const isSelect = st.activeTool === 'select';

    // Drawing hit-testing only needed in select mode
    if (isSelect) {
      const containerRect = container.getBoundingClientRect();
      const localX = mx - containerRect.left;
      const localY = my - containerRect.top;

      // Resize handles (only with single selection)
      if (st.selectedDrawingIds.length === 1) {
        const hit = primitive.getHandleAt(localX, localY);
        if (hit) {
          setCursor(container, getHandleCursor(hit.handle));
          return;
        }
      }

      // Drawing body → pointer
      const bodyHit = primitive.hitTest(localX, localY);
      if (bodyHit && typeof bodyHit.externalId === 'string') {
        setCursor(container, 'pointer');
        return;
      }
    }

    // Overlay label hit targets (use getBoundingClientRect — overlay has pointer-events:none
    // so elementFromPoint cannot see its children)
    const targets = refs.hitTargets.current;
    let overLabel = false;
    let hoveredEl: HTMLElement | null = null;
    if (targets.length > 0) {
      // Check highest-priority (lowest number) targets first
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const el = target.el;
        if (el.offsetParent === null) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
          setCursor(container, target.priority >= 2 ? 'grab' : 'pointer');
          overLabel = true;
          hoveredEl = el;
          break;
        }
      }
    }

    // Close-cell (✕) hover effect
    const isClose = hoveredEl && hoveredEl.textContent === '\u2715';
    if (isClose && hoveredEl !== _hoveredCloseCell) {
      clearCloseHover();
      _hoveredCloseCell = hoveredEl;
      hoveredEl!.style.transition = 'background 0.15s';
      hoveredEl!.style.background = CLOSE_BG_HOVER;
    } else if (!isClose) {
      clearCloseHover();
    }

    // Hide quick-order button while hovering a label
    refs.labelHovered.current = overLabel;
    const qoEl = refs.quickOrder.current;
    if (qoEl) qoEl.style.display = overLabel ? 'none' : '';

    if (overLabel) return;

    // Default: crosshair
    setCursor(container, CROSSHAIR_CURSOR);
  });
}
