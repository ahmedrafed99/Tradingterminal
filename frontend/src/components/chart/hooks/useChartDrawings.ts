import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { LineStyle } from 'lightweight-charts';
import type { Time } from 'lightweight-charts';
import { showToast, errorMessage } from '../../../utils/toast';
import { DEFAULT_HLINE_COLOR, DEFAULT_OVAL_COLOR, DEFAULT_ARROWPATH_COLOR } from '../../../types/drawing';
import { computeRulerMetrics } from '../drawings/rulerMetrics';
import type { ChartRefs } from './types';

// Custom white crosshair cursor (24x24 SVG, hotspot at center)
const CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cline x1='12' y1='0' x2='12' y2='24' stroke='%23ffffff' stroke-width='2'/%3E%3Cline x1='0' y1='12' x2='24' y2='12' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`;

export function useChartDrawings(refs: ChartRefs, contract: Contract | null): void {
  // -- Drawings: sync store → primitive + click handling --
  useEffect(() => {
    const chart = refs.chart.current;
    const series = refs.series.current;
    const primitive = refs.drawingsPrimitive.current;
    if (!chart || !series || !primitive) return;

    // Sync drawings from store on every render
    const state = useStore.getState();
    const contractId = contract?.id;
    const filtered = contractId != null
      ? state.drawings.filter((d) => String(d.contractId) === String(contractId))
      : [];
    primitive.setDrawings(filtered, state.selectedDrawingId);

    // Subscribe to store changes for live sync
    const unsub = useStore.subscribe((s, prev) => {
      if (s.drawings !== prev.drawings || s.selectedDrawingId !== prev.selectedDrawingId) {
        const cid = contract?.id;
        const f = cid != null
          ? s.drawings.filter((d) => String(d.contractId) === String(cid))
          : [];
        primitive.setDrawings(f, s.selectedDrawingId);
      }
    });

    // Click handler for placement + selection
    const handleClick = (param: { point?: { x: number; y: number }; hoveredObjectId?: unknown }) => {
      if (!param.point) return;
      // Suppress click after a drag-to-move
      if (drawingDragOccurred) { drawingDragOccurred = false; return; }
      const { activeTool, addDrawing, setActiveTool, setSelectedDrawingId } = useStore.getState();

      if (activeTool === 'hline') {
        const price = series.coordinateToPrice(param.point.y);
        const clickTime = chart.timeScale().coordinateToTime(param.point.x);
        if (price === null || contract === null) return;
        addDrawing({
          id: crypto.randomUUID(),
          type: 'hline',
          price: price as number,
          color: DEFAULT_HLINE_COLOR,
          strokeWidth: 1,
          text: null,
          contractId: String(contract.id),
          startTime: clickTime ? (clickTime as number) : 0,
          extendLeft: false,
        });
        setActiveTool('select');
        return;
      }

      // Arrow path creation is handled via native mouseup (not subscribeClick)
      // to avoid LWC's subscribeClick being unreliable after handleScroll toggles.

      if (activeTool === 'select') {
        if (param.hoveredObjectId && typeof param.hoveredObjectId === 'string') {
          setSelectedDrawingId(param.hoveredObjectId);
        } else {
          setSelectedDrawingId(null);
        }
      }
    };

    chart.subscribeClick(handleClick);

    // -- Oval drag-to-create --
    const container = refs.container.current!;
    let ovalDrag: { startX: number; startY: number; startTime: number; startPrice: number; tool: 'oval' } | null = null;

    // -- Ruler click-move-click creation state --
    let rulerCreation: {
      startX: number; startY: number;
      startTime: number; startPrice: number;
    } | null = null;
    let rulerDisplayActive = false;

    // -- Oval resize drag state --
    let ovalResize: {
      drawingId: string;
      handle: string;
      // Original bounding box edges in data coordinates
      leftTime: number;
      rightTime: number;
      topPrice: number;    // higher price (top of screen)
      bottomPrice: number; // lower price (bottom of screen)
      // Original p1/p2 for Escape revert
      origP1: { time: number; price: number };
      origP2: { time: number; price: number };
    } | null = null;

    // -- Drawing drag-to-move state --
    let drawingDrag: {
      drawingId: string;
      type: 'hline' | 'oval' | 'arrowpath' | 'ruler';
      startX: number;
      startY: number;
      origPrice: number;
      origP1: { time: number; price: number };
      origP2: { time: number; price: number };
      origPoints?: { time: number; price: number }[];
      startTime: number;
      startPrice: number;
      origStartTime: number; // hline: original startTime for horizontal drag
    } | null = null;
    let drawingDragOccurred = false;

    // -- Arrow path creation state --
    let arrowPathCreation: {
      points: { time: number; price: number }[];
      cssPoints: { x: number; y: number }[];
    } | null = null;

    // -- Arrow path node drag state --
    let arrowPathNodeDrag: {
      drawingId: string;
      nodeIndex: number;
      origPoints: { time: number; price: number }[];
    } | null = null;

    // Cursor for resize handle hover (grab → grabbing on actual resize)
    const HANDLE_CURSOR = 'grab';

    const onResizeMouseDown = (e: MouseEvent) => {
      const st = useStore.getState();
      if (st.activeTool !== 'select' || !st.selectedDrawingId) return;
      const drawing = st.drawings.find((d) => d.id === st.selectedDrawingId);
      if (!drawing || (drawing.type !== 'oval' && drawing.type !== 'arrowpath' && drawing.type !== 'ruler')) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const hit = primitive.getHandleAt(x, y);
      if (!hit || hit.drawingId !== drawing.id) return;

      // Arrow path node drag
      if (drawing.type === 'arrowpath' && hit.handle.startsWith('node-')) {
        const nodeIndex = parseInt(hit.handle.replace('node-', ''), 10);
        if (!isNaN(nodeIndex)) {
          arrowPathNodeDrag = {
            drawingId: drawing.id,
            nodeIndex,
            origPoints: drawing.points.map(p => ({ ...p })),
          };
          container.style.cursor = 'grabbing';
          chart.applyOptions({ handleScroll: false, handleScale: false });
          e.stopPropagation();
          e.preventDefault();
          return;
        }
      }

      if (drawing.type !== 'oval' && drawing.type !== 'ruler') return;

      const h = hit.handle;
      const p1 = drawing.p1;
      const p2 = drawing.p2;

      // Convert to screen to figure out which p is left/right/top/bottom
      const sx1 = chart.timeScale().timeToCoordinate(p1.time as unknown as Time);
      const sy1 = series.priceToCoordinate(p1.price);
      const sx2 = chart.timeScale().timeToCoordinate(p2.time as unknown as Time);
      const sy2 = series.priceToCoordinate(p2.price);
      if (sx1 === null || sy1 === null || sx2 === null || sy2 === null) return;

      // Identify which point has the left/right time and top/bottom price
      const leftTime = sx1 < sx2 ? p1.time : p2.time;
      const rightTime = sx1 < sx2 ? p2.time : p1.time;
      const topPrice = sy1 < sy2 ? p1.price : p2.price; // smaller y = top of screen = higher price
      const bottomPrice = sy1 < sy2 ? p2.price : p1.price;

      ovalResize = {
        drawingId: drawing.id,
        handle: h,
        leftTime, rightTime, topPrice, bottomPrice,
        origP1: { ...p1 },
        origP2: { ...p2 },
      };

      container.style.cursor = 'grabbing';
      chart.applyOptions({ handleScroll: false, handleScale: false });
      e.stopPropagation();
      e.preventDefault();
    };

    const onDrawingDragMouseDown = (e: MouseEvent) => {
      if (ovalResize || arrowPathNodeDrag) return; // resize/node drag takes priority
      const st = useStore.getState();
      if (st.activeTool !== 'select') return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const hit = primitive.hitTest(x, y);
      if (!hit || typeof hit.externalId !== 'string') return;

      const drawing = st.drawings.find((d) => d.id === hit.externalId);
      if (!drawing) return;

      if (drawing.type === 'hline') {
        const dragStartTime = chart.timeScale().coordinateToTime(x);
        drawingDrag = {
          drawingId: drawing.id,
          type: 'hline',
          startX: x, startY: y,
          origPrice: drawing.price,
          origP1: { time: 0, price: 0 },
          origP2: { time: 0, price: 0 },
          startTime: dragStartTime ? (dragStartTime as number) : 0,
          startPrice: 0,
          origStartTime: drawing.startTime ?? 0,
        };
      } else if (drawing.type === 'oval') {
        const startTime = chart.timeScale().coordinateToTime(x);
        const startPrice = series.coordinateToPrice(y);
        if (startTime === null || startPrice === null) return;
        drawingDrag = {
          drawingId: drawing.id,
          type: 'oval',
          startX: x, startY: y,
          origPrice: 0,
          origP1: { ...drawing.p1 },
          origP2: { ...drawing.p2 },
          startTime: startTime as number,
          startPrice: startPrice as number,
          origStartTime: 0,
        };
      } else if (drawing.type === 'ruler') {
        const startTime = chart.timeScale().coordinateToTime(x);
        const startPrice = series.coordinateToPrice(y);
        if (startTime === null || startPrice === null) return;
        drawingDrag = {
          drawingId: drawing.id,
          type: 'ruler',
          startX: x, startY: y,
          origPrice: 0,
          origP1: { ...drawing.p1 },
          origP2: { ...drawing.p2 },
          startTime: startTime as number,
          startPrice: startPrice as number,
          origStartTime: 0,
        };
      } else if (drawing.type === 'arrowpath') {
        const startTime = chart.timeScale().coordinateToTime(x);
        const startPrice = series.coordinateToPrice(y);
        if (startTime === null || startPrice === null) return;
        drawingDrag = {
          drawingId: drawing.id,
          type: 'arrowpath',
          startX: x, startY: y,
          origPrice: 0,
          origP1: { time: 0, price: 0 },
          origP2: { time: 0, price: 0 },
          origPoints: drawing.points.map(p => ({ ...p })),
          startTime: startTime as number,
          startPrice: startPrice as number,
          origStartTime: 0,
        };
      }

      st.setSelectedDrawingId(drawing.id);
      container.style.cursor = 'grabbing';
      chart.applyOptions({ handleScroll: false, handleScale: false });
      e.preventDefault();
    };

    const onOvalMouseDown = (e: MouseEvent) => {
      if (ovalResize || drawingDrag || arrowPathNodeDrag || arrowPathCreation || rulerCreation) return;
      const tool = useStore.getState().activeTool;
      if (tool !== 'oval') return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const time = chart.timeScale().coordinateToTime(x);
      const price = series.coordinateToPrice(y);
      if (time === null || price === null) return;
      ovalDrag = { startX: x, startY: y, startTime: time as number, startPrice: price as number, tool: 'oval' };
      // Disable chart scrolling during drag
      chart.applyOptions({ handleScroll: false, handleScale: false });
      e.stopPropagation();
      e.preventDefault();
    };

    const onOvalMouseMove = (e: MouseEvent) => {
      // Handle drawing drag-to-move
      if (drawingDrag) {
        container.style.cursor = 'grabbing';
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = Math.abs(x - drawingDrag.startX);
        const dy = Math.abs(y - drawingDrag.startY);
        if (dx < 3 && dy < 3) return; // not a drag yet
        drawingDragOccurred = true;

        if (drawingDrag.type === 'hline') {
          const price = series.coordinateToPrice(y);
          const currentTime = chart.timeScale().coordinateToTime(x);
          const patch: Record<string, unknown> = {};
          if (price !== null) patch.price = price as number;
          if (currentTime !== null && drawingDrag.startTime) {
            const dt = (currentTime as number) - drawingDrag.startTime;
            patch.startTime = drawingDrag.origStartTime + dt;
          }
          if (Object.keys(patch).length > 0) {
            useStore.getState().updateDrawing(drawingDrag.drawingId, patch, true);
          }
        } else if (drawingDrag.type === 'oval' || drawingDrag.type === 'ruler') {
          const currentTime = chart.timeScale().coordinateToTime(x);
          const currentPrice = series.coordinateToPrice(y);
          if (currentTime !== null && currentPrice !== null) {
            const dt = (currentTime as number) - drawingDrag.startTime;
            const dp = (currentPrice as number) - drawingDrag.startPrice;
            useStore.getState().updateDrawing(drawingDrag.drawingId, {
              p1: { time: drawingDrag.origP1.time + dt, price: drawingDrag.origP1.price + dp },
              p2: { time: drawingDrag.origP2.time + dt, price: drawingDrag.origP2.price + dp },
            }, true);
          }
        } else if (drawingDrag.type === 'arrowpath' && drawingDrag.origPoints) {
          const currentTime = chart.timeScale().coordinateToTime(x);
          const currentPrice = series.coordinateToPrice(y);
          if (currentTime !== null && currentPrice !== null) {
            const dt = (currentTime as number) - drawingDrag.startTime;
            const dp = (currentPrice as number) - drawingDrag.startPrice;
            useStore.getState().updateDrawing(drawingDrag.drawingId, {
              points: drawingDrag.origPoints.map(p => ({
                time: p.time + dt,
                price: p.price + dp,
              })),
            }, true);
          }
        }
        e.stopPropagation();
        e.preventDefault();
        return;
      }

      // Handle arrow path node drag
      if (arrowPathNodeDrag) {
        container.style.cursor = 'grabbing';
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const time = chart.timeScale().coordinateToTime(x);
        const price = series.coordinateToPrice(y);
        if (time !== null && price !== null) {
          const newPoints = arrowPathNodeDrag.origPoints.map(p => ({ ...p }));
          newPoints[arrowPathNodeDrag.nodeIndex] = { time: time as number, price: price as number };
          useStore.getState().updateDrawing(arrowPathNodeDrag.drawingId, { points: newPoints }, true);
        }
        e.stopPropagation();
        e.preventDefault();
        return;
      }

      // Handle resize drag
      if (ovalResize) {
        container.style.cursor = 'grabbing';
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const mouseTime = chart.timeScale().coordinateToTime(x);
        const mousePrice = series.coordinateToPrice(y);
        if (mouseTime === null || mousePrice === null) return;

        const mt = mouseTime as number;
        const mp = mousePrice as number;
        const { leftTime: lt, rightTime: rt, topPrice: tp, bottomPrice: bp } = ovalResize;

        // Each handle: opposite point stays fixed, dragged point follows mouse freely
        let newP1: { time: number; price: number };
        let newP2: { time: number; price: number };
        const h = ovalResize.handle;

        if (h === 'n')       { newP1 = { time: rt, price: bp }; newP2 = { time: mt, price: mp }; }
        else if (h === 's')  { newP1 = { time: lt, price: tp }; newP2 = { time: mt, price: mp }; }
        else if (h === 'e')  { newP1 = { time: lt, price: tp }; newP2 = { time: mt, price: mp }; }
        else if (h === 'w')  { newP1 = { time: rt, price: bp }; newP2 = { time: mt, price: mp }; }
        else return;

        useStore.getState().updateDrawing(ovalResize.drawingId, { p1: newP1, p2: newP2 }, true);
        e.stopPropagation();
        e.preventDefault();
        return;
      }

      // Handle arrow path creation preview (rubber-band line from last node to cursor)
      if (arrowPathCreation) {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        primitive.setArrowPathPreview([...arrowPathCreation.cssPoints, { x, y }]);
        return;
      }

      // Handle ruler creation preview (click-move-click)
      if (rulerCreation) {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const endTime = chart.timeScale().coordinateToTime(x);
        const endPrice = series.coordinateToPrice(y);
        let metrics = null;
        if (endTime !== null && endPrice !== null) {
          const p1 = { time: rulerCreation.startTime, price: rulerCreation.startPrice };
          const p2 = { time: endTime as number, price: endPrice as number };
          metrics = computeRulerMetrics(refs.bars.current, p1, p2);
        }
        const dec = contract ? (contract.tickSize.toString().split('.')[1]?.length ?? 0) : 2;
        primitive.setRulerDragPreview(rulerCreation.startX, rulerCreation.startY, x, y, metrics, dec);
        return;
      }

      // Handle oval creation drag
      if (!ovalDrag) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      primitive.setDragPreview(ovalDrag.startX, ovalDrag.startY, x, y);
    };

    const onOvalMouseUp = (e: MouseEvent) => {
      // Dismiss ephemeral ruler on any left click after it's shown
      if (rulerDisplayActive && e.button === 0) {
        rulerDisplayActive = false;
        primitive.clearRulerDragPreview();
        return;
      }

      // Handle drawing drag-to-move end
      if (drawingDrag) {
        if (drawingDragOccurred) {
          const prev: Record<string, unknown> = {};
          if (drawingDrag.type === 'hline') {
            prev.price = drawingDrag.origPrice;
            prev.startTime = drawingDrag.origStartTime;
          } else if (drawingDrag.type === 'oval' || drawingDrag.type === 'ruler') {
            prev.p1 = { ...drawingDrag.origP1 };
            prev.p2 = { ...drawingDrag.origP2 };
          } else if (drawingDrag.type === 'arrowpath' && drawingDrag.origPoints) {
            prev.points = drawingDrag.origPoints.map(p => ({ ...p }));
          }
          useStore.getState().pushDrawingUndo({ type: 'update', drawingId: drawingDrag.drawingId, previous: prev });
        }
        // Recompute ruler metrics after move
        if (drawingDrag.type === 'ruler' && drawingDragOccurred) {
          const d = useStore.getState().drawings.find((d) => d.id === drawingDrag!.drawingId);
          if (d && d.type === 'ruler') {
            const metrics = computeRulerMetrics(refs.bars.current, d.p1, d.p2);
            useStore.getState().updateDrawing(d.id, { metrics });
          }
        }
        drawingDrag = null;
        container.style.cursor = CROSSHAIR_CURSOR;
        chart.applyOptions({ handleScroll: true, handleScale: true });
        return;
      }

      // Handle arrow path node drag end
      if (arrowPathNodeDrag) {
        useStore.getState().pushDrawingUndo({
          type: 'update',
          drawingId: arrowPathNodeDrag.drawingId,
          previous: { points: arrowPathNodeDrag.origPoints.map(p => ({ ...p })) },
        });
        arrowPathNodeDrag = null;
        container.style.cursor = CROSSHAIR_CURSOR;
        chart.applyOptions({ handleScroll: true, handleScale: true });
        return;
      }

      // Handle resize drag end
      if (ovalResize) {
        useStore.getState().pushDrawingUndo({
          type: 'update',
          drawingId: ovalResize.drawingId,
          previous: { p1: { ...ovalResize.origP1 }, p2: { ...ovalResize.origP2 } },
        });
        // Recompute ruler metrics after resize
        const resizedDrawing = useStore.getState().drawings.find((d) => d.id === ovalResize!.drawingId);
        if (resizedDrawing && resizedDrawing.type === 'ruler') {
          const metrics = computeRulerMetrics(refs.bars.current, resizedDrawing.p1, resizedDrawing.p2);
          useStore.getState().updateDrawing(resizedDrawing.id, { metrics });
        }
        ovalResize = null;
        container.style.cursor = CROSSHAIR_CURSOR;
        chart.applyOptions({ handleScroll: true, handleScale: true });
        return;
      }

      // Arrow path creation: left-click adds nodes (native mouseup avoids LWC subscribeClick issues)
      if (useStore.getState().activeTool === 'arrowpath' && e.button === 0) {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Only respond to clicks within the chart container
        if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height
            && container.contains(e.target as Node)) {
          const time = chart.timeScale().coordinateToTime(x);
          const price = series.coordinateToPrice(y);
          if (time !== null && price !== null && contract !== null) {
            if (!arrowPathCreation) {
              // First click → start creation
              arrowPathCreation = {
                points: [{ time: time as number, price: price as number }],
                cssPoints: [{ x, y }],
              };
              chart.applyOptions({ handleScroll: false, handleScale: false });
            } else {
              // Subsequent click → add node
              arrowPathCreation.points.push({ time: time as number, price: price as number });
              arrowPathCreation.cssPoints.push({ x, y });
            }
            primitive.setArrowPathPreview(arrowPathCreation.cssPoints);
          }
        }
        return;
      }

      // Ruler click-move-click: first click starts, second click finishes
      if (useStore.getState().activeTool === 'ruler' && e.button === 0) {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height
            && container.contains(e.target as Node)) {
          const time = chart.timeScale().coordinateToTime(x);
          const price = series.coordinateToPrice(y);
          if (time !== null && price !== null && contract !== null) {
            if (!rulerCreation) {
              // First click → start ruler
              rulerCreation = {
                startX: x, startY: y,
                startTime: time as number, startPrice: price as number,
              };
              chart.applyOptions({ handleScroll: false, handleScale: false });
            } else {
              // Second click → finish ruler (keep preview visible, dismiss on next click)
              rulerCreation = null;
              rulerDisplayActive = true;
              chart.applyOptions({ handleScroll: true, handleScale: true });
              useStore.getState().setActiveTool('select');
            }
          }
        }
        return;
      }

      // Handle oval creation drag end
      if (!ovalDrag) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const endTime = chart.timeScale().coordinateToTime(x);
      const endPrice = series.coordinateToPrice(y);

      primitive.clearDragPreview();
      // Re-enable chart scrolling
      chart.applyOptions({ handleScroll: true, handleScale: true });

      if (endTime !== null && endPrice !== null && contract) {
        // Only create if the user actually dragged (not a tiny click)
        const dx = Math.abs(x - ovalDrag.startX);
        const dy = Math.abs(y - ovalDrag.startY);
        if (dx > 5 || dy > 5) {
          useStore.getState().addDrawing({
            id: crypto.randomUUID(),
            type: 'oval',
            p1: { time: ovalDrag.startTime, price: ovalDrag.startPrice },
            p2: { time: endTime as number, price: endPrice as number },
            color: DEFAULT_OVAL_COLOR,
            strokeWidth: 1,
            text: null,
            contractId: String(contract.id),
          });
        }
      }

      ovalDrag = null;
      useStore.getState().setActiveTool('select');
    };

    // Right-click: cancel active drawing tool, or finalize arrow path
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const { activeTool, setActiveTool } = useStore.getState();

      // Arrow path in progress: finalize it
      if (arrowPathCreation) {
        e.stopPropagation();

        // Add the current mouse position as the final point (arrow tip),
        // but skip if it's the same as the last placed node (no-move right-click)
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const time = chart.timeScale().coordinateToTime(x);
        const price = series.coordinateToPrice(y);
        if (time !== null && price !== null) {
          const last = arrowPathCreation.points[arrowPathCreation.points.length - 1];
          const dx = Math.abs((time as number) - last.time);
          const dy = Math.abs((price as number) - last.price);
          if (dx > 0.0001 || dy > 0.0001) {
            arrowPathCreation.points.push({ time: time as number, price: price as number });
          }
        }

        const { addDrawing } = useStore.getState();
        if (arrowPathCreation.points.length >= 2 && contract) {
          addDrawing({
            id: crypto.randomUUID(),
            type: 'arrowpath',
            points: [...arrowPathCreation.points],
            color: DEFAULT_ARROWPATH_COLOR,
            strokeWidth: 2,
            text: null,
            contractId: String(contract.id),
          });
        }
        arrowPathCreation = null;
        primitive.clearArrowPathPreview();
        chart.applyOptions({ handleScroll: true, handleScale: true });
        setActiveTool('select');
        return;
      }

      // Ruler in progress: cancel it
      if (rulerCreation) {
        rulerCreation = null;
        primitive.clearRulerDragPreview();
        chart.applyOptions({ handleScroll: true, handleScale: true });
        setActiveTool('select');
        return;
      }

      // Any other drawing tool active (hline, oval): cancel back to select
      if (activeTool !== 'select') {
        setActiveTool('select');
      }
    };

    // Resize handler must fire before drawing-drag, which fires before oval-creation
    container.addEventListener('mousedown', onResizeMouseDown);
    container.addEventListener('mousedown', onDrawingDragMouseDown);
    container.addEventListener('mousedown', onOvalMouseDown);

    // Overlay label hit testing — fires after drawing handlers, before chart pan.
    // Labels are pointer-events:none so LWC crosshair stays visible;
    // this handler detects clicks on labels via bounding-rect checks.
    let overlayHitCaptured = false;
    const onOverlayHitTest = (e: MouseEvent) => {
      if (e.button !== 0) return;
      overlayHitCaptured = false;
      const targets = refs.hitTargets.current;
      if (targets.length === 0) return;
      const mx = e.clientX;
      const my = e.clientY;
      // Check in priority order (0=buttons, 1=entry-click, 2=row-drag)
      const sorted = targets.slice().sort((a, b) => a.priority - b.priority);
      for (const target of sorted) {
        const el = target.el;
        if (el.offsetParent === null) continue; // hidden
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
          e.stopPropagation();
          e.preventDefault();
          overlayHitCaptured = true;
          target.handler(e);
          return;
        }
      }
    };
    container.addEventListener('mousedown', onOverlayHitTest);

    container.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('mousemove', onOvalMouseMove);
    window.addEventListener('mouseup', onOvalMouseUp);

    // Chart pan cursor: fires last — if no drawing interaction captured the mousedown,
    // the user is panning the chart via LWC's internal scroll handler.
    let chartPanning = false;
    const onChartPanDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // only left click
      // Check after a microtask to let other handlers set their state first
      queueMicrotask(() => {
        if (!drawingDrag && !ovalResize && !ovalDrag && !arrowPathNodeDrag && !arrowPathCreation && !rulerCreation && !overlayHitCaptured) {
          chartPanning = true;
          container.style.cursor = 'grabbing';
        }
        overlayHitCaptured = false;
      });
    };
    const onChartPanUp = () => {
      if (chartPanning) {
        chartPanning = false;
        container.style.cursor = CROSSHAIR_CURSOR;
      }
    };
    container.addEventListener('mousedown', onChartPanDown);
    window.addEventListener('mouseup', onChartPanUp);

    // -- Cursor + keyboard shortcuts --
    const updateCursor = () => {
      container.style.cursor = CROSSHAIR_CURSOR;
    };
    updateCursor();

    // Track handle hover + drawing hover for cursor feedback
    const onHandleHover = (e: MouseEvent) => {
      // Re-assert grabbing during ANY drag operation
      if (ovalResize || ovalDrag || drawingDrag || arrowPathNodeDrag || chartPanning
          || refs.orderDragState.current || refs.previewDragState.current || refs.posDrag.current) {
        container.style.cursor = 'grabbing';
        return;
      }
      const st = useStore.getState();
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check resize handles first (only in select mode with a selected drawing)
      if (st.activeTool === 'select' && st.selectedDrawingId) {
        const hit = primitive.getHandleAt(x, y);
        if (hit) {
          container.style.cursor = HANDLE_CURSOR;
          return;
        }
      }

      // Check if hovering over a drawing body → pointer
      if (st.activeTool === 'select') {
        const bodyHit = primitive.hitTest(x, y);
        if (bodyHit && typeof bodyHit.externalId === 'string') {
          container.style.cursor = 'pointer';
          return;
        }
      }

      // Check if hovering over an overlay label hit target → pointer
      const mx = e.clientX;
      const my = e.clientY;
      for (const target of refs.hitTargets.current) {
        const el = target.el;
        if (el.offsetParent === null) continue;
        const tRect = el.getBoundingClientRect();
        if (tRect.width === 0 || tRect.height === 0) continue;
        if (mx >= tRect.left && mx <= tRect.right && my >= tRect.top && my <= tRect.bottom) {
          container.style.cursor = 'pointer';
          return;
        }
      }

      // Default: crosshair
      container.style.cursor = CROSSHAIR_CURSOR;
    };
    container.addEventListener('mousemove', onHandleHover);

    const unsubCursor = useStore.subscribe((s, prev) => {
      if (s.activeTool !== prev.activeTool) updateCursor();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Cancel ruler creation
        if (rulerCreation) {
          rulerCreation = null;
          primitive.clearRulerDragPreview();
          chart.applyOptions({ handleScroll: true, handleScale: true });
          useStore.getState().setActiveTool('select');
          return;
        }
        // Dismiss ephemeral ruler
        if (rulerDisplayActive) {
          rulerDisplayActive = false;
          primitive.clearRulerDragPreview();
          return;
        }
        // Cancel arrow path creation
        if (arrowPathCreation) {
          arrowPathCreation = null;
          primitive.clearArrowPathPreview();
          chart.applyOptions({ handleScroll: true, handleScale: true });
          useStore.getState().setActiveTool('select');
          return;
        }
        // Cancel arrow path node drag
        if (arrowPathNodeDrag) {
          useStore.getState().updateDrawing(arrowPathNodeDrag.drawingId, {
            points: arrowPathNodeDrag.origPoints,
          }, true);
          arrowPathNodeDrag = null;
          container.style.cursor = CROSSHAIR_CURSOR;
          chart.applyOptions({ handleScroll: true, handleScale: true });
          return;
        }
        // Cancel in-progress drawing drag
        if (drawingDrag) {
          if (drawingDrag.type === 'hline') {
            useStore.getState().updateDrawing(drawingDrag.drawingId, { price: drawingDrag.origPrice, startTime: drawingDrag.origStartTime }, true);
          } else if (drawingDrag.type === 'arrowpath' && drawingDrag.origPoints) {
            useStore.getState().updateDrawing(drawingDrag.drawingId, {
              points: drawingDrag.origPoints,
            }, true);
          } else {
            useStore.getState().updateDrawing(drawingDrag.drawingId, {
              p1: drawingDrag.origP1,
              p2: drawingDrag.origP2,
            }, true);
          }
          drawingDrag = null;
          drawingDragOccurred = false;
          container.style.cursor = CROSSHAIR_CURSOR;
          chart.applyOptions({ handleScroll: true, handleScale: true });
          return;
        }
        // Cancel in-progress resize
        if (ovalResize) {
          // Revert to original points
          useStore.getState().updateDrawing(ovalResize.drawingId, {
            p1: ovalResize.origP1,
            p2: ovalResize.origP2,
          }, true);
          ovalResize = null;
          container.style.cursor = CROSSHAIR_CURSOR;
          chart.applyOptions({ handleScroll: true, handleScale: true });
          return;
        }
        const s = useStore.getState();
        if (s.activeTool !== 'select') {
          s.setActiveTool('select');
          // Cancel in-progress oval drag
          if (ovalDrag) {
            primitive.clearDragPreview();
            ovalDrag = null;
            chart.applyOptions({ handleScroll: true, handleScale: true });
          }
        } else if (s.selectedDrawingId) {
          s.setSelectedDrawingId(null);
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Only if not typing in an input
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const s = useStore.getState();
        if (s.selectedDrawingId) {
          s.removeDrawing(s.selectedDrawingId);
          s.setSelectedDrawingId(null);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.defaultPrevented) return; // already handled by another chart instance
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        useStore.getState().undoDrawing();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      unsub();
      unsubCursor();
      arrowPathCreation = null;
      arrowPathNodeDrag = null;
      rulerCreation = null;
      rulerDisplayActive = false;
      chart.unsubscribeClick(handleClick);
      container.removeEventListener('mousedown', onResizeMouseDown);
      container.removeEventListener('mousedown', onDrawingDragMouseDown);
      container.removeEventListener('mousedown', onOverlayHitTest);
      container.removeEventListener('mousedown', onOvalMouseDown);
      container.removeEventListener('contextmenu', onContextMenu);
      container.removeEventListener('mousemove', onHandleHover);
      container.removeEventListener('mousedown', onChartPanDown);
      window.removeEventListener('mousemove', onOvalMouseMove);
      window.removeEventListener('mouseup', onOvalMouseUp);
      window.removeEventListener('mouseup', onChartPanUp);
      window.removeEventListener('keydown', onKeyDown);
      container.style.cursor = '';
    };
  }, [contract]);
}
