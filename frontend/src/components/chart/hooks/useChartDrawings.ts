import { useEffect } from 'react';
import { CrosshairMode } from 'lightweight-charts';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { DEFAULT_HLINE_COLOR } from '../../../types/drawing';
import { snapPriceToOHLC, snapPriceToOHLCByTime } from '../drawings/magnetSnap';
import type { ChartRefs } from './types';
import { CROSSHAIR_CURSOR, createDrawingState, getMousePos } from './drawingInteraction';
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

    // Declared early — shared by crosshairMoveHandler, applyMagnetCrosshairMode, and handleClick.
    let _activeCrosshairMode: CrosshairMode | null = null;

    // Track crosshair snapped position — used by hline placement when magnet is active.
    // In MagnetOHLC mode the crosshair visually snaps to OHLC; subscribeClick still fires at
    // raw mouse coords, so we capture the snapped price here instead.
    let lastCrosshairSnap: { price: number } | null = null;
    const crosshairMoveHandler = (param: { point?: { x: number; y: number }; time?: number | unknown }) => {
      if (!param.point) { lastCrosshairSnap = null; return; }
      const rawP = series.coordinateToPrice(param.point.y);
      if (rawP === null) return;
      if (_activeCrosshairMode === CrosshairMode.MagnetOHLC) {
        // In MagnetOHLC mode, lightweight-charts resolves param.time to the exact bar the
        // crosshair snapped to. Use that time directly — coordinateToTime(rawMouseX) often
        // lands between candles and causes findBarIndex to return -1, falling back to raw price.
        const snapTime = typeof param.time === 'number' ? param.time : null;
        const snapped = snapTime !== null
          ? snapPriceToOHLCByTime(rawP as number, snapTime, refs.bars.current)
          : snapPriceToOHLC(rawP as number, param.point.x, chart, refs.bars.current);
        lastCrosshairSnap = { price: snapped };
      } else {
        lastCrosshairSnap = { price: rawP as number };
      }
    };
    chart.subscribeCrosshairMove(crosshairMoveHandler);

    // Click handler for hline placement + selection
    const handleClick = (param: { point?: { x: number; y: number }; hoveredObjectId?: unknown }) => {
      if (state.drawingDragOccurred) { state.drawingDragOccurred = false; return; }
      const { activeTool, addDrawing, setActiveTool, setSelectedDrawingIds, drawingDefaults } = useStore.getState();
      if (!param.point) {
        // Click was on the price scale or time scale (outside the main pane).
        // Still deselect any selected drawing so clicking the scales feels like "clicking away".
        if (activeTool === 'select') setSelectedDrawingIds([]);
        return;
      }

      if (activeTool === 'hline') {
        const rawPrice = series.coordinateToPrice(param.point.y);
        const clickTime = chart.timeScale().coordinateToTime(param.point.x);
        if (rawPrice === null || contract === null) return;
        // Use crosshair-snapped price when magnet is active (_activeCrosshairMode is MagnetOHLC).
        // This covers both persistent toggle and Ctrl-hold, since both apply MagnetOHLC mode.
        const magnetOn = _activeCrosshairMode === CrosshairMode.MagnetOHLC;
        const price = magnetOn
          ? (lastCrosshairSnap?.price ?? snapPriceToOHLC(rawPrice as number, param.point.x, chart, refs.bars.current))
          : rawPrice as number;
        const def = drawingDefaults['hline'];
        const id = crypto.randomUUID();
        addDrawing({
          id,
          type: 'hline',
          price,
          color: def?.color ?? DEFAULT_HLINE_COLOR,
          strokeWidth: def?.strokeWidth ?? 1,
          lineStyle: def?.lineStyle ?? 'solid',
          text: null,
          contractId: String(contract.id),
          startTime: clickTime ? (clickTime as number) : 0,
          extendLeft: false,
        });
        setActiveTool('select');
        setSelectedDrawingIds([id]);
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

    // ── Magnet crosshair mode ──
    const applyMagnetCrosshairMode = (magnetOn: boolean) => {
      const mode = magnetOn ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal;
      if (mode === _activeCrosshairMode) return;
      _activeCrosshairMode = mode;
      chart.applyOptions({ crosshair: { mode } });
    };
    applyMagnetCrosshairMode(useStore.getState().magnetEnabled);
    const unsubMagnet = useStore.subscribe((s, prev) => {
      if (s.magnetEnabled !== prev.magnetEnabled) applyMagnetCrosshairMode(s.magnetEnabled);
    });
    const onCtrlDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault(); // prevent browser menu bar from stealing focus on Windows
        useStore.getState().setMagnetHeld(true);
        applyMagnetCrosshairMode(true);
      }
    };
    const onCtrlUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        useStore.getState().setMagnetHeld(false);
        applyMagnetCrosshairMode(useStore.getState().magnetEnabled);
      }
    };
    // Reset if window loses focus (e.g. Alt triggers OS/browser menu despite preventDefault)
    const onWindowBlur = () => {
      useStore.getState().setMagnetHeld(false);
      applyMagnetCrosshairMode(useStore.getState().magnetEnabled);
    };
    window.addEventListener('keydown', onCtrlDown);
    window.addEventListener('keyup', onCtrlUp);
    window.addEventListener('blur', onWindowBlur);

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

    // ── Deselect on empty-space click (fallback for when subscribeClick doesn't fire) ──
    // Runs AFTER other handlers so stopImmediatePropagation from onOverlayHitTest still blocks it.
    const handleDeselectOnEmptyClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (e.ctrlKey || e.shiftKey) return;
      const st = useStore.getState();
      if (st.activeTool !== 'select') return;
      if (st.selectedDrawingIds.length === 0) return;
      const { x, y } = getMousePos(e, container);
      const hit = primitive.hitTest(x, y);
      if (!hit) st.setSelectedDrawingIds([]);
    };
    container.addEventListener('mousedown', handleDeselectOnEmptyClick);

    // ── Double-click + context menu ──
    const handleDbl = (e: MouseEvent) => onDblClick(e, ctx);
    const handleCtx = (e: MouseEvent) => onContextMenu(e, ctx);
    container.addEventListener('dblclick', handleDbl);
    container.addEventListener('contextmenu', handleCtx);

    // ── Global move + up (RAF-throttled to avoid >60fps mousemove storms) ──
    let moveRafId = 0;
    let lastMoveEvent: MouseEvent | null = null;
    const handleMove = (e: MouseEvent) => {
      lastMoveEvent = e;
      if (!moveRafId) {
        moveRafId = requestAnimationFrame(() => {
          moveRafId = 0;
          if (lastMoveEvent) onMouseMove(lastMoveEvent, ctx);
        });
      }
    };
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
      chart.unsubscribeCrosshairMove(crosshairMoveHandler);
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
      unsubMagnet();
      window.removeEventListener('keydown', onCtrlDown);
      window.removeEventListener('keyup', onCtrlUp);
      window.removeEventListener('blur', onWindowBlur);
      chart.applyOptions({ crosshair: { mode: CrosshairMode.Normal } });
      container.removeEventListener('mousedown', handleCtrlSelect);
      container.removeEventListener('mousedown', handleResize);
      container.removeEventListener('mousedown', handleDragDown);
      container.removeEventListener('mousedown', onOverlayHitTest);
      container.removeEventListener('mousedown', handleRectDown);
      container.removeEventListener('mousedown', handleOvalDown);
      container.removeEventListener('mousedown', handleFreeDrawDown);
      container.removeEventListener('mousedown', handleDeselectOnEmptyClick);
      container.removeEventListener('dblclick', handleDbl);
      container.removeEventListener('contextmenu', handleCtx);
      container.removeEventListener('mousemove', handleHover);
      container.removeEventListener('mousedown', onChartPanDown);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('mouseup', onChartPanUp);
      window.removeEventListener('keydown', handleKey);
      if (moveRafId) cancelAnimationFrame(moveRafId);
      container.style.cursor = '';
    };
  }, [contract]);
}
