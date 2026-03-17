import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { DEFAULT_HLINE_COLOR } from '../../../types/drawing';
import type { ChartRefs } from './types';
import { CROSSHAIR_CURSOR, createDrawingState } from './drawingInteraction';
import type { DrawingContext } from './drawingInteraction';
import {
  onShiftRulerKey,
  onCtrlDragSelectDown,
  onResizeMouseDown,
  onDrawingDragMouseDown,
  onRectMouseDown,
  onOvalMouseDown,
  onFreeDrawMouseDown,
  onMouseMove,
  onMouseUp,
} from './drawingHandlers';
import {
  onContextMenu,
  onDblClick,
  onKeyDown,
  onHandleHover,
} from './drawingInputHandlers';

export function useChartDrawings(refs: ChartRefs, contract: Contract | null): void {
  // -- Drawings: sync store → primitive + click handling --
  useEffect(() => {
    const chart = refs.chart.current;
    const series = refs.series.current;
    const primitive = refs.drawingsPrimitive.current;
    if (!chart || !series || !primitive) return;

    // Shared mutable interaction state
    const state = createDrawingState();
    const container = refs.container.current!;

    const ctx: DrawingContext = { chart, series, container, primitive, contract, refs, state };

    // Sync drawings from store on every render
    const storeState = useStore.getState();
    const contractId = contract?.id;
    const filtered = contractId != null
      ? storeState.drawings.filter((d) => String(d.contractId) === String(contractId))
      : [];
    primitive.setDrawings(filtered, storeState.selectedDrawingIds);

    // Subscribe to store changes for live sync
    const unsub = useStore.subscribe((s, prev) => {
      if (s.drawings !== prev.drawings || s.selectedDrawingIds !== prev.selectedDrawingIds) {
        const cid = contract?.id;
        const f = cid != null
          ? s.drawings.filter((d) => String(d.contractId) === String(cid))
          : [];
        primitive.setDrawings(f, s.selectedDrawingIds);
      }
    });

    // Click handler for hline placement + selection
    const handleClick = (param: { point?: { x: number; y: number }; hoveredObjectId?: unknown }) => {
      if (!param.point) return;
      if (state.drawingDragOccurred) { state.drawingDragOccurred = false; return; }
      const { activeTool, addDrawing, setActiveTool, setSelectedDrawingIds, drawingDefaults } = useStore.getState();

      if (activeTool === 'hline') {
        const price = series.coordinateToPrice(param.point.y);
        const clickTime = chart.timeScale().coordinateToTime(param.point.x);
        if (price === null || contract === null) return;
        const def = drawingDefaults['hline'];
        const id = crypto.randomUUID();
        addDrawing({
          id,
          type: 'hline',
          price: price as number,
          color: def?.color ?? DEFAULT_HLINE_COLOR,
          strokeWidth: def?.strokeWidth ?? 1,
          text: null,
          contractId: String(contract.id),
          startTime: clickTime ? (clickTime as number) : 0,
          extendLeft: false,
        });
        setSelectedDrawingIds([id]);
        setActiveTool('select');
        return;
      }

      if (activeTool === 'select') {
        if (param.hoveredObjectId && typeof param.hoveredObjectId === 'string') {
          setSelectedDrawingIds([param.hoveredObjectId]);
        } else {
          setSelectedDrawingIds([]);
        }
      }
    };

    chart.subscribeClick(handleClick);

    // ── Shift-hold ruler activation ──
    const handleShiftKey = (e: KeyboardEvent) => onShiftRulerKey(e, ctx);
    window.addEventListener('keydown', handleShiftKey);
    window.addEventListener('keyup', handleShiftKey);

    // ── Overlay label hit testing (must be BEFORE drawing handlers) ──
    const onOverlayHitTest = (e: MouseEvent) => {
      if (e.button !== 0) return;
      state.overlayHitCaptured = false;
      const targets = refs.hitTargets.current;
      if (targets.length === 0) return;
      const mx = e.clientX;
      const my = e.clientY;
      const sorted = targets.slice().sort((a, b) => a.priority - b.priority);
      for (const target of sorted) {
        const el = target.el;
        if (el.offsetParent === null) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
          e.stopImmediatePropagation();
          e.preventDefault();
          state.overlayHitCaptured = true;
          target.handler(e);
          return;
        }
      }
    };
    container.addEventListener('mousedown', onOverlayHitTest);

    // ── Mousedown handlers (ordered by priority) ──
    const handleCtrlSelect = (e: MouseEvent) => onCtrlDragSelectDown(e, ctx);
    const handleResize = (e: MouseEvent) => onResizeMouseDown(e, ctx);
    const handleDragDown = (e: MouseEvent) => onDrawingDragMouseDown(e, ctx);
    const handleRectDown = (e: MouseEvent) => onRectMouseDown(e, ctx);
    const handleOvalDown = (e: MouseEvent) => onOvalMouseDown(e, ctx);
    const handleFreeDrawDown = (e: MouseEvent) => onFreeDrawMouseDown(e, ctx);

    container.addEventListener('mousedown', handleCtrlSelect);
    container.addEventListener('mousedown', handleResize);
    container.addEventListener('mousedown', handleDragDown);
    container.addEventListener('mousedown', handleRectDown);
    container.addEventListener('mousedown', handleOvalDown);
    container.addEventListener('mousedown', handleFreeDrawDown);

    // ── Double-click + context menu ──
    const handleDbl = (e: MouseEvent) => onDblClick(e, ctx);
    const handleCtx = (e: MouseEvent) => onContextMenu(e, ctx);
    container.addEventListener('dblclick', handleDbl);
    container.addEventListener('contextmenu', handleCtx);

    // ── Global move + up ──
    const handleMove = (e: MouseEvent) => onMouseMove(e, ctx);
    const handleUp = (e: MouseEvent) => onMouseUp(e, ctx);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    // ── Chart pan cursor ──
    const onChartPanDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      queueMicrotask(() => {
        if (!state.drawingDrag && !state.ovalResize && !state.ovalDrag
            && !state.arrowPathNodeDrag && !state.arrowPathCreation
            && !state.rectCreation && !state.rulerCreation && !state.freeDrawCreation && !state.overlayHitCaptured
            && !state.ctrlDragSelect) {
          state.chartPanning = true;
          container.style.cursor = 'grabbing';
        }
        state.overlayHitCaptured = false;
      });
    };
    const onChartPanUp = () => {
      if (state.chartPanning) {
        state.chartPanning = false;
        container.style.cursor = CROSSHAIR_CURSOR;
      }
    };
    container.addEventListener('mousedown', onChartPanDown);
    window.addEventListener('mouseup', onChartPanUp);

    // ── Cursor + keyboard ──
    container.style.cursor = CROSSHAIR_CURSOR;

    const handleHover = (e: MouseEvent) => onHandleHover(e, ctx);
    container.addEventListener('mousemove', handleHover);

    const unsubCursor = useStore.subscribe((s, prev) => {
      if (s.activeTool !== prev.activeTool) {
        container.style.cursor = CROSSHAIR_CURSOR;
      }
    });

    const handleKey = (e: KeyboardEvent) => onKeyDown(e, ctx);
    window.addEventListener('keydown', handleKey);

    return () => {
      unsub();
      unsubCursor();
      state.arrowPathCreation = null;
      state.arrowPathNodeDrag = null;
      state.rectCreation = null;
      state.freeDrawCreation = null;
      state.rulerCreation = null;
      state.rulerDisplayActive = false;
      state.ctrlDragSelect = null;
      chart.unsubscribeClick(handleClick);
      window.removeEventListener('keydown', handleShiftKey);
      window.removeEventListener('keyup', handleShiftKey);
      container.removeEventListener('mousedown', handleCtrlSelect);
      container.removeEventListener('mousedown', handleResize);
      container.removeEventListener('mousedown', handleDragDown);
      container.removeEventListener('mousedown', onOverlayHitTest);
      container.removeEventListener('mousedown', handleRectDown);
      container.removeEventListener('mousedown', handleOvalDown);
      container.removeEventListener('mousedown', handleFreeDrawDown);
      container.removeEventListener('dblclick', handleDbl);
      container.removeEventListener('contextmenu', handleCtx);
      container.removeEventListener('mousemove', handleHover);
      container.removeEventListener('mousedown', onChartPanDown);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('mouseup', onChartPanUp);
      window.removeEventListener('keydown', handleKey);
      container.style.cursor = '';
    };
  }, [contract]);
}
