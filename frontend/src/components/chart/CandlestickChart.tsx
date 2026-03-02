import { memo, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, CandlestickData, UTCTimestamp, Time } from 'lightweight-charts';
import type { Contract, Bar } from '../../services/marketDataService';
import type { Timeframe } from '../../store/useStore';
import { TICKS_PER_POINT } from '../../types/bracket';
import type { BracketConfig } from '../../types/bracket';
import { useStore } from '../../store/useStore';
import { marketDataService } from '../../services/marketDataService';
import { realtimeService, type GatewayQuote, type DepthEntry } from '../../services/realtimeService';
import { authService } from '../../services/authService';
import { orderService, type Order, type PlaceOrderParams } from '../../services/orderService';
import { bracketEngine } from '../../services/bracketEngine';
import { showToast, errorMessage } from '../../utils/toast';
import { CHART_OPTIONS, CANDLESTICK_OPTIONS } from './chartTheme';
import {
  barToCandle,
  sortBarsAscending,
  computeStartTime,
  getCandlePeriodSeconds,
  floorToCandlePeriod,
  generateWhitespace,
} from './barUtils';
import { DrawingEditToolbar } from './DrawingEditToolbar';
import { DrawingsPrimitive } from './drawings/DrawingsPrimitive';
import { CountdownPrimitive } from './CountdownPrimitive';
import { CrosshairLabelPrimitive } from './CrosshairLabelPrimitive';
import { DEFAULT_HLINE_COLOR, DEFAULT_OVAL_COLOR, DEFAULT_ARROWPATH_COLOR } from '../../types/drawing';
import { computeRulerMetrics } from './drawings/rulerMetrics';
import { registerChart, unregisterChart } from './screenshot/chartRegistry';
import { TradeZonePrimitive, matchTrades } from './TradeZonePrimitive';
import { VolumeProfilePrimitive } from './VolumeProfilePrimitive';

// Custom white crosshair cursor (24x24 SVG, hotspot at center)
const CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cline x1='12' y1='0' x2='12' y2='24' stroke='%23ffffff' stroke-width='2'/%3E%3Cline x1='0' y1='12' x2='24' y2='12' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`;

export interface CandlestickChartProps {
  chartId: 'left' | 'right';
  contract: Contract | null;
  timeframe: Timeframe;
}

export interface CandlestickChartHandle {
  getChartApi: () => IChartApi | null;
  getSeriesApi: () => ISeriesApi<'Candlestick'> | null;
  getDataMap: () => Map<number, number>;
  isQoHovered: () => boolean;
}

export const CandlestickChart = memo(forwardRef<CandlestickChartHandle, CandlestickChartProps>(
  function CandlestickChart({ chartId, contract, timeframe }, ref) {

  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lastBarRef = useRef<CandlestickData<UTCTimestamp> | null>(null);
  const dataMapRef = useRef<Map<number, number>>(new Map());
  const barsRef = useRef<Bar[]>([]);
  // Persistent P&L cache — survives overlay effect rebuilds so labels never flash $0
  const lastPnlCache = useRef<{ text: string; bg: string }>({ text: '', bg: '' });
  const drawingsPrimitiveRef = useRef<DrawingsPrimitive | null>(null);
  const countdownRef = useRef<CountdownPrimitive | null>(null);
  const crosshairLabelRef = useRef<CrosshairLabelPrimitive | null>(null);
  const whitespaceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const tradeZonePrimitiveRef = useRef<TradeZonePrimitive | null>(null);
  const vpPrimitiveRef = useRef<VolumeProfilePrimitive | null>(null);
  const ohlcRef = useRef<HTMLDivElement>(null);
  const instrumentLabelRef = useRef<HTMLDivElement>(null);
  const quickOrderRef = useRef<HTMLDivElement>(null);
  // Shared flag: true while the quick-order (+) button is hovered so the
  // crosshair label primitive doesn't clear itself during the transition.
  const qoHoveredRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getChartApi: () => chartRef.current,
    getSeriesApi: () => seriesRef.current,
    getDataMap: () => dataMapRef.current,
    isQoHovered: () => qoHoveredRef.current,
  }));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollBtnShownRef = useRef(false);
  const [scrollBtnPos, setScrollBtnPos] = useState({ right: 80, bottom: 40 });

  // -- Chart initialization (runs once) --
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, CHART_OPTIONS);
    const series = chart.addSeries(CandlestickSeries, CANDLESTICK_OPTIONS);

    chartRef.current = chart;
    seriesRef.current = series;

    // Invisible series whose sole job is to hold future whitespace timestamps
    // so the time scale extends and the crosshair time label stays visible
    // beyond the last real candle. Kept separate so series.update() still works.
    const wsSeries = chart.addSeries(LineSeries, {
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceScaleId: '',
    });
    whitespaceSeriesRef.current = wsSeries;

    // Attach countdown (price + bar-close timer) primitive — attached first so
    // DrawingsPrimitive's priceAxisPaneViews renders on top of it
    const countdown = new CountdownPrimitive();
    series.attachPrimitive(countdown);
    countdownRef.current = countdown;

    // Attach volume profile primitive — renders behind everything else
    const vpPrimitive = new VolumeProfilePrimitive();
    series.attachPrimitive(vpPrimitive);
    vpPrimitiveRef.current = vpPrimitive;

    // Attach trade zone primitive — renders entry/exit rectangles behind everything
    const tradeZonePrimitive = new TradeZonePrimitive();
    series.attachPrimitive(tradeZonePrimitive);
    tradeZonePrimitiveRef.current = tradeZonePrimitive;

    // Attach drawings primitive — selected drawing's price label paints over current-price
    const drawingsPrimitive = new DrawingsPrimitive();
    series.attachPrimitive(drawingsPrimitive);
    drawingsPrimitiveRef.current = drawingsPrimitive;

    // Attach crosshair label primitive LAST — crosshair label always on top
    const crosshairLabel = new CrosshairLabelPrimitive();
    series.attachPrimitive(crosshairLabel);
    crosshairLabelRef.current = crosshairLabel;

    // Selection click — mark this chart as selected in dual-chart mode
    const el = containerRef.current;
    const onSelectClick = () => {
      useStore.getState().setSelectedChart(chartId);
    };
    el.addEventListener('mousedown', onSelectClick);

    registerChart(chartId, {
      chart,
      primitive: drawingsPrimitive,
      instrumentEl: instrumentLabelRef.current,
      ohlcEl: ohlcRef.current,
    });

    return () => {
      unregisterChart(chartId);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      whitespaceSeriesRef.current = null;
      drawingsPrimitiveRef.current = null;
      countdownRef.current = null;
      crosshairLabelRef.current = null;
      tradeZonePrimitiveRef.current = null;
      vpPrimitiveRef.current = null;
      el.removeEventListener('mousedown', onSelectClick);
    };
  }, [chartId]);

  // -- Trade zones (entry/exit rectangles from "show on chart" clicks) --
  useEffect(() => {
    const primitive = tradeZonePrimitiveRef.current;
    if (!primitive) return;
    const contractId = contract?.id;
    const periodSec = getCandlePeriodSeconds(timeframe);
    const decimals = contract
      ? (contract.tickSize.toString().split('.')[1]?.length ?? 0)
      : 2;

    primitive.setPeriod(periodSec);
    primitive.setDecimals(decimals);

    function rebuild() {
      if (!primitive || !contractId) {
        primitive?.setData([]);
        return;
      }
      const { visibleTradeIds, sessionTrades } = useStore.getState();
      if (visibleTradeIds.length === 0) {
        primitive.setData([]);
        return;
      }
      const zones = matchTrades(sessionTrades, visibleTradeIds, String(contractId));
      primitive.setData(zones);
    }

    rebuild();
    const unsub = useStore.subscribe((s, prev) => {
      if (s.visibleTradeIds !== prev.visibleTradeIds || s.sessionTrades !== prev.sessionTrades) {
        rebuild();
      }
    });
    return () => {
      unsub();
      primitive.setData([]);
    };
  }, [contract, timeframe]);

  // -- OHLC tooltip (crosshair hover → show candle values, default to last bar) --
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const el = ohlcRef.current;
    if (!chart || !series || !el) return;

    const decimals = contract ? (contract.tickSize.toString().split('.')[1]?.length ?? 0) : 2;
    const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

    function render(o: number, h: number, l: number, c: number) {
      const bullish = c >= o;
      const valColor = bullish ? '#9598a1' : '#0097a6';
      const change = c - o;
      const sign = change >= 0 ? '+' : '';
      el!.innerHTML =
        `<span style="color:#787b86">O</span><span style="color:${valColor}">${fmt(o)}</span> ` +
        `<span style="color:#787b86">H</span><span style="color:${valColor}">${fmt(h)}</span> ` +
        `<span style="color:#787b86">L</span><span style="color:${valColor}">${fmt(l)}</span> ` +
        `<span style="color:#787b86">C</span><span style="color:${valColor}">${fmt(c)}</span> ` +
        `<span style="color:${valColor}">${sign}${fmt(change)}</span>`;
    }

    // Show last bar initially
    const last = lastBarRef.current;
    if (last) render(last.open, last.high, last.low, last.close);

    const onMove = (param: { time?: unknown; seriesData?: Map<unknown, unknown> }) => {
      if (param.time && param.seriesData) {
        const d = param.seriesData.get(series) as { open: number; high: number; low: number; close: number } | undefined;
        if (d) { render(d.open, d.high, d.low, d.close); return; }
      }
      // Fallback to last bar
      const lb = lastBarRef.current;
      if (lb) render(lb.open, lb.high, lb.low, lb.close);
    };

    chart.subscribeCrosshairMove(onMove);
    return () => { chart.unsubscribeCrosshairMove(onMove); };
  }, [contract, timeframe]);

  // -- Feed crosshair price to CrosshairLabelPrimitive (always-on-top label) --
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const cl = crosshairLabelRef.current;
    if (!chart || !series || !cl) return;

    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    const onMove = (param: { point?: { x: number; y: number } }) => {
      if (!param.point) {
        // Delay the clear by one frame so that if the mouse is transitioning
        // to the quick-order button overlay, onEnter has time to set the flag.
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(() => {
          if (!qoHoveredRef.current) cl.updateCrosshairPrice(null);
        }, 16);
        return;
      }
      if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
      const price = series.coordinateToPrice(param.point.y);
      cl.updateCrosshairPrice(price as number | null);
    };

    chart.subscribeCrosshairMove(onMove);
    return () => {
      if (clearTimer) clearTimeout(clearTimer);
      chart.unsubscribeCrosshairMove(onMove);
    };
  }, []);

  // -- Drawings: sync store → primitive + click handling --
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const primitive = drawingsPrimitiveRef.current;
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
    const container = containerRef.current!;
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
          metrics = computeRulerMetrics(barsRef.current, p1, p2);
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
            const metrics = computeRulerMetrics(barsRef.current, d.p1, d.p2);
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
          const metrics = computeRulerMetrics(barsRef.current, resizedDrawing.p1, resizedDrawing.p2);
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
      const targets = hitTargetsRef.current;
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
          || orderDragStateRef.current || previewDragStateRef.current || posDragRef.current) {
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
      for (const target of hitTargetsRef.current) {
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

  // -- Historical bars loading --
  useEffect(() => {
    if (!contract || !seriesRef.current) return;

    const series = seriesRef.current;
    let cancelled = false;

    async function loadBars() {
      setLoading(true);
      setError(null);
      try {
        const startTime = computeStartTime(timeframe);
        const endTime = new Date().toISOString();
        const bars = await marketDataService.retrieveBars({
          contractId: contract!.id,
          live: false,
          unit: timeframe.unit,
          unitNumber: timeframe.unitNumber,
          startTime,
          endTime,
          limit: 20000,
          includePartialBar: true,
        });

        if (cancelled) return;

        const sorted = sortBarsAscending(bars);
        barsRef.current = sorted;
        const candles = sorted.map(barToCandle);
        series.setData(candles);
        lastBarRef.current = candles.length > 0 ? candles[candles.length - 1] : null;

        // Push future whitespace to the separate invisible series so the
        // crosshair time label shows beyond the last candle
        const periodSec = getCandlePeriodSeconds(timeframe);
        const lastTime = candles.length > 0 ? (candles[candles.length - 1].time as number) : 0;
        if (lastTime > 0 && whitespaceSeriesRef.current) {
          whitespaceSeriesRef.current.setData(generateWhitespace(lastTime, periodSec, 100));
        }

        // Populate data map for crosshair sync
        dataMapRef.current.clear();
        for (const c of candles) {
          dataMapRef.current.set(c.time as number, c.close);
        }

        chartRef.current?.timeScale().fitContent();

        // Configure series price format to snap crosshair label to tick size
        if (contract) {
          const dec = contract.tickSize.toString().split('.')[1]?.length ?? 0;
          series.applyOptions({
            priceFormat: { type: 'price', minMove: contract.tickSize, precision: dec },
          });
        }

        // Seed countdown primitive with initial price + config
        const cd = countdownRef.current;
        if (cd) {
          const dec = contract ? (contract.tickSize.toString().split('.')[1]?.length ?? 0) : 2;
          cd.setDecimals(dec);
          cd.setPeriod(periodSec);
          drawingsPrimitiveRef.current?.setDecimals(dec);
          crosshairLabelRef.current?.setDecimals(dec);
          crosshairLabelRef.current?.setTickSize(contract?.tickSize ?? 0);
          if (lastBarRef.current) {
            cd.updatePrice(lastBarRef.current.close, false);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load bars');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBars();
    return () => { cancelled = true; };
  }, [contract, timeframe]);

  // -- Real-time quote subscription --
  useEffect(() => {
    if (!contract || !seriesRef.current) return;

    const contractId = contract.id;
    const periodSec = getCandlePeriodSeconds(timeframe);
    let cancelled = false;

    async function startRealtime() {
      if (!realtimeService.isConnected()) {
        try {
          const token = await authService.getToken();
          await realtimeService.connect(token);
        } catch (err) {
          console.error('[chart] Failed to connect SignalR:', err);
          return;
        }
      }
      if (!cancelled) {
        realtimeService.subscribeQuotes(contractId);
      }
    }

    startRealtime();

    function handleQuote(quoteContractId: string, data: GatewayQuote) {
      if (quoteContractId !== contractId || !seriesRef.current) return;

      const price = data.lastPrice;
      if (price == null || !isFinite(price)) return;

      const lastBar = lastBarRef.current;
      // Don't process quotes until historical data has loaded
      if (!lastBar) return;

      const quoteSec = new Date(data.lastUpdated).getTime() / 1000;
      const candleTime = floorToCandlePeriod(quoteSec, periodSec);

      // Skip quotes older than the current bar (lightweight-charts rejects these)
      if (candleTime < lastBar.time) return;

      if (lastBar.time === candleTime) {
        // Update existing bar
        const updated: CandlestickData<UTCTimestamp> = {
          time: candleTime,
          open: lastBar.open,
          high: Math.max(lastBar.high, price),
          low: Math.min(lastBar.low, price),
          close: price,
        };
        seriesRef.current.update(updated);
        lastBarRef.current = updated;
        dataMapRef.current.set(updated.time as number, updated.close);
      } else {
        // New candle period
        const newBar: CandlestickData<UTCTimestamp> = {
          time: candleTime,
          open: price,
          high: price,
          low: price,
          close: price,
        };
        seriesRef.current.update(newBar);
        lastBarRef.current = newBar;
        dataMapRef.current.set(newBar.time as number, newBar.close);
      }

      // Feed live price into countdown primitive
      countdownRef.current?.updatePrice(price, true);
    }

    realtimeService.onQuote(handleQuote);

    return () => {
      cancelled = true;
      countdownRef.current?.setLive(false);
      realtimeService.offQuote(handleQuote);
      realtimeService.unsubscribeQuotes(contractId);
    };
  }, [contract, timeframe]);

  // -- Volume profile depth subscription --
  const vpEnabled = useStore((s) => chartId === 'left' ? s.vpEnabled : s.secondVpEnabled);
  const vpColor = useStore((s) => chartId === 'left' ? s.vpColor : s.secondVpColor);

  useEffect(() => {
    const vp = vpPrimitiveRef.current;
    if (!vp) return;

    vp.setEnabled(vpEnabled);
    if (!vpEnabled || !contract) {
      vp.clear();
      return;
    }

    const contractId = contract.id;
    const tickSize = contract.tickSize;
    vp.setTickSize(tickSize);
    vp.clear();

    function handleDepth(depthContractId: string, entries: DepthEntry[]) {
      if (depthContractId !== contractId || !vp) return;

      for (const entry of entries) {
        if (entry.type === 6) {
          // Reset marker — clear and prepare for snapshot
          vp.clear();
          continue;
        }
        if (entry.type === 5) {
          // Volume at Price — snapshot or incremental update
          vp.updateLevel(entry.price, entry.volume);
        }
      }
    }

    realtimeService.onDepth(handleDepth);
    realtimeService.subscribeDepth(contractId);

    return () => {
      realtimeService.offDepth(handleDepth);
      realtimeService.unsubscribeDepth(contractId);
      vp.clear();
      vp.setEnabled(false);
    };
  }, [contract, vpEnabled]);

  // -- VP color sync (separate so color changes don't re-subscribe depth) --
  useEffect(() => {
    vpPrimitiveRef.current?.setColor(vpColor);
  }, [vpColor]);

  // -- VP hover tracking (crosshair move feeds hover price to primitive) --
  useEffect(() => {
    const chart = chartRef.current;
    const vp = vpPrimitiveRef.current;
    if (!chart || !vp || !vpEnabled) return;

    function onCrosshairMove(param: import('lightweight-charts').MouseEventParams) {
      if (!vp) return;
      if (!param.point || !seriesRef.current) {
        vp.setHoverPrice(null);
        return;
      }
      const price = seriesRef.current.coordinateToPrice(param.point.y);
      vp.setHoverPrice(price != null ? price : null);
    }

    chart.subscribeCrosshairMove(onCrosshairMove);
    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      vp.setHoverPrice(null);
    };
  }, [vpEnabled]);

  // -- Order panel contract (overlays show on whichever chart matches) --
  const orderContract = useStore((s) => s.orderContract);
  const isOrderChart = contract?.id != null && contract.id === orderContract?.id;

  // Ref for quick-order preview lines, accessible from overlay cancel handlers
  const qoPreviewLinesRef = useRef<{
    sl: ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null;
    tps: (ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null)[];
  }>({ sl: null, tps: [] });

  // Mutable prices ref for quick-order pending preview (updated during drag)
  const qoPreviewPricesRef = useRef<{ sl: number | null; tps: number[] }>({ sl: null, tps: [] });

  // -- Quick order button (+ button to left of crosshair price label) --
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const el = quickOrderRef.current;
    if (!chart || !series || !el || !isOrderChart || !contract) {
      if (el) el.style.display = 'none';
      return;
    }

    const wrap = el.querySelector('[data-qo-wrap]') as HTMLDivElement;
    const label = el.querySelector('[data-qo-label]') as HTMLDivElement;
    const plusEl = el.querySelector('[data-qo-plus]') as HTMLDivElement;
    if (!wrap || !label || !plusEl) return;

    let snappedPrice: number | null = null;
    let lastCrosshairTime: unknown = null;
    let lastValidTime: unknown = null; // fallback — always stores the most recent non-null time
    let isBuy = true;
    let isHovered = false;
    let hideTimer: number | null = null;
    let qoPreviewLines: ReturnType<typeof series.createPriceLine>[] = [];
    let pendingFillUnsub: (() => void) | null = null;
    let qoHoverLabels: HTMLDivElement[] = [];
    let qoComputedPrices: {
      entryPrice: number; slPrice: number | null;
      tpPrices: number[]; tpSizes: number[];
      side: 0 | 1; orderSize: number;
    } | null = null;

    function removePreviewLines() {
      qoPreviewLines.forEach((l) => series!.removePriceLine(l));
      qoPreviewLines = [];
      qoPreviewLinesRef.current = { sl: null, tps: [] };
    }

    function removeHoverLabels() {
      qoHoverLabels.forEach((r) => r.remove());
      qoHoverLabels = [];
    }

    function createPreviewLines() {
      removePreviewLines();
      qoComputedPrices = null;
      if (snappedPrice == null) return;
      const st = useStore.getState();
      const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      if (!activePreset) return;
      const bc = activePreset.config;
      const tickSize = contract!.tickSize;
      const toPrice = (points: number) => points * tickSize * TICKS_PER_POINT;
      const ep = snappedPrice;
      const side = isBuy ? 0 : 1;

      // Entry reference line
      qoPreviewLines.push(series!.createPriceLine({
        price: ep, color: '#787b86', lineWidth: 1,
        lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
      }));

      // SL line
      let computedSlPrice: number | null = null;
      qoPreviewLinesRef.current = { sl: null, tps: [] };
      if (bc.stopLoss.points > 0) {
        computedSlPrice = side === 0 ? ep - toPrice(bc.stopLoss.points) : ep + toPrice(bc.stopLoss.points);
        const slLine = series!.createPriceLine({
          price: computedSlPrice, color: '#ff444480', lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
        });
        qoPreviewLines.push(slLine);
        qoPreviewLinesRef.current.sl = slLine;
      }

      // TP lines
      const computedTpPrices: number[] = [];
      const computedTpSizes: number[] = [];
      bc.takeProfits.forEach((tp) => {
        const tpPrice = side === 0 ? ep + toPrice(tp.points) : ep - toPrice(tp.points);
        computedTpPrices.push(tpPrice);
        computedTpSizes.push(tp.size);
        const tpLine = series!.createPriceLine({
          price: tpPrice, color: '#00c805', lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
        });
        qoPreviewLines.push(tpLine);
        qoPreviewLinesRef.current.tps.push(tpLine);
      });

      qoComputedPrices = {
        entryPrice: ep, slPrice: computedSlPrice,
        tpPrices: computedTpPrices, tpSizes: computedTpSizes,
        side: side as 0 | 1, orderSize: st.orderSize,
      };
    }

    function createHoverLabels() {
      removeHoverLabels();
      if (!qoComputedPrices) return;
      const overlay = overlayRef.current;
      if (!overlay) return;

      const qo = qoComputedPrices;
      const tk = contract!.tickSize;
      const tv = contract!.tickValue || 0.50;

      function makeRow(pnlText: string, pnlBg: string, sizeText: string, sizeBg: string, price: number) {
        const row = document.createElement('div');
        row.style.cssText = 'position:absolute;left:50%;display:flex;height:20px;font-size:11px;font-weight:bold;font-family:-apple-system,BlinkMacSystemFont,Trebuchet MS,Roboto,Ubuntu,sans-serif;line-height:20px;transform:translate(-50%,-50%);white-space:nowrap;border-radius:3px;overflow:hidden;';
        const c1 = document.createElement('div');
        c1.style.cssText = `background:${pnlBg};color:#000;padding:0 6px;`;
        c1.textContent = pnlText;
        row.appendChild(c1);
        const c2 = document.createElement('div');
        c2.style.cssText = `background:${sizeBg};color:#000;padding:0 6px;border-left:1px solid #000;`;
        c2.textContent = sizeText;
        row.appendChild(c2);
        const y = series!.priceToCoordinate(price);
        if (y !== null) row.style.top = `${y}px`;
        overlay!.appendChild(row);
        qoHoverLabels.push(row);
      }

      // SL label
      if (qo.slPrice != null) {
        const slDiff = qo.side === 0 ? qo.entryPrice - qo.slPrice : qo.slPrice - qo.entryPrice;
        const slPnl = (slDiff / tk) * tv * qo.orderSize;
        makeRow(`-$${Math.abs(slPnl).toFixed(2)}`, '#ff0000', String(qo.orderSize), '#ff0000', qo.slPrice);
      }

      // TP labels
      for (let i = 0; i < qo.tpPrices.length; i++) {
        const tpPrice = qo.tpPrices[i];
        const tpSize = qo.tpSizes[i] ?? qo.orderSize;
        const tpDiff = qo.side === 0 ? tpPrice - qo.entryPrice : qo.entryPrice - tpPrice;
        const tpPnl = (tpDiff / tk) * tv * tpSize;
        makeRow(`+$${Math.abs(tpPnl).toFixed(2)}`, '#00c805', String(tpSize), '#00c805', tpPrice);
      }
    }

    function refreshLabel() {
      const sz = useStore.getState().orderSize;
      label.textContent = isBuy ? `Buy Limit ${sz}` : `Sell Limit ${sz}`;
      label.style.background = isBuy ? '#00c805' : '#ff0000';
      label.style.color = isBuy ? '#000' : '#fff';
    }

    const onMove = (param: { point?: { x: number; y: number }; time?: unknown }) => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

      if (!param.point) {
        hideTimer = window.setTimeout(() => {
          if (!isHovered) el.style.display = 'none';
        }, 50);
        return;
      }

      const rawPrice = series.coordinateToPrice(param.point.y);
      if (rawPrice === null) {
        if (!isHovered) el.style.display = 'none';
        return;
      }

      const lastP = useStore.getState().lastPrice ?? lastBarRef.current?.close ?? null;
      snappedPrice = Math.round((rawPrice as number) / contract.tickSize) * contract.tickSize;
      lastCrosshairTime = param.time ?? null;
      if (param.time) lastValidTime = param.time;
      isBuy = lastP != null ? snappedPrice < lastP : true;

      let psWidth = 56;
      try { psWidth = chart.priceScale('right').width(); } catch (_) { psWidth = 56; }

      el.style.display = 'flex';
      el.style.top = `${param.point.y}px`;
      el.style.right = `${psWidth}px`;

      if (isHovered) refreshLabel();
    };

    const onEnter = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      isHovered = true;
      qoHoveredRef.current = true;
      label.style.display = 'block';
      plusEl.style.borderRadius = '0 2px 2px 0';
      plusEl.style.background = '#434651';
      refreshLabel();
      // Keep crosshair visible while hovering the + button
      const timeToUse = lastCrosshairTime ?? lastValidTime;
      if (snappedPrice != null && timeToUse != null) {
        chart.setCrosshairPosition(snappedPrice, timeToUse as Parameters<typeof chart.setCrosshairPosition>[1], series);
      }
      if (!pendingFillUnsub) {
        createPreviewLines();
        createHoverLabels();
      }
    };

    const onLeave = () => {
      isHovered = false;
      qoHoveredRef.current = false;
      label.style.display = 'none';
      plusEl.style.borderRadius = '2px';
      plusEl.style.background = '#2a2e39';
      chart.clearCrosshairPosition();
      if (!pendingFillUnsub) {
        removePreviewLines();
        removeHoverLabels();
      }
      hideTimer = window.setTimeout(() => {
        if (!isHovered) el.style.display = 'none';
      }, 100);
    };

    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (snappedPrice == null) return;
      const st = useStore.getState();
      if (!st.activeAccountId) return;

      const side: 0 | 1 = isBuy ? 0 : 1;
      const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      let bracketsArmed = false;

      if (activePreset) {
        const bc = activePreset.config;
        const bracketsActive = bc.stopLoss.points >= 1 || bc.takeProfits.length >= 1;
        if (bracketsActive) {
          bracketEngine.armForEntry({
            accountId: st.activeAccountId,
            contractId: contract!.id,
            entrySide: side,
            entrySize: st.orderSize,
            config: bc,
            tickSize: contract!.tickSize || 0.25,
          });
          bracketsArmed = true;

          // Publish pending preview for overlay labels
          const tickSize = contract!.tickSize;
          const toP = (points: number) => points * tickSize * TICKS_PER_POINT;
          const ep = snappedPrice;
          st.setQoPendingPreview({
            entryPrice: ep,
            slPrice: bc.stopLoss.points > 0
              ? (side === 0 ? ep - toP(bc.stopLoss.points) : ep + toP(bc.stopLoss.points))
              : null,
            tpPrices: bc.takeProfits.map((tp) =>
              side === 0 ? ep + toP(tp.points) : ep - toP(tp.points),
            ),
            side,
            orderSize: st.orderSize,
            tpSizes: bc.takeProfits.map((tp) => tp.size),
          });
        }
      }

      removeHoverLabels();
      if (!bracketsArmed) removePreviewLines();

      // Set placeholder immediately so onLeave won't remove preview lines
      // before the async .then() replaces it with the real subscription
      if (bracketsArmed) pendingFillUnsub = () => {};

      orderService.placeOrder({
        accountId: st.activeAccountId,
        contractId: contract!.id,
        type: 1,
        side,
        size: st.orderSize,
        limitPrice: snappedPrice,
      }).then(({ orderId }) => {
        if (bracketsArmed) {
          bracketEngine.confirmEntryOrderId(orderId);
          // Keep preview lines until entry fills/cancels, then remove
          pendingFillUnsub = useStore.subscribe((state) => {
            const o = state.openOrders.find((ord) => ord.id === orderId);
            if (!o || o.status === 2 || o.status === 3) {
              // Unsubscribe FIRST to prevent recursive re-entry from setQoPendingPreview
              pendingFillUnsub?.();
              pendingFillUnsub = null;
              removePreviewLines();
              useStore.getState().setQoPendingPreview(null);
            }
          });
        }
      }).catch((err) => {
        console.error('[Chart] Quick order failed:', err);
        showToast('error', 'Quick order failed', errorMessage(err));
        // Cleanup: remove stale preview state
        if (pendingFillUnsub) {
          pendingFillUnsub();
          pendingFillUnsub = null;
        }
        if (bracketsArmed) {
          bracketEngine.clearSession();
        }
        useStore.getState().setQoPendingPreview(null);
        removePreviewLines();
        removeHoverLabels();
      });
    };

    wrap.addEventListener('mouseenter', onEnter);
    wrap.addEventListener('mouseleave', onLeave);
    wrap.addEventListener('click', onClick);
    chart.subscribeCrosshairMove(onMove);

    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      qoHoveredRef.current = false;
      if (pendingFillUnsub) {
        pendingFillUnsub(); pendingFillUnsub = null;
        useStore.getState().setQoPendingPreview(null);
      }
      removePreviewLines();
      removeHoverLabels();
      chart.unsubscribeCrosshairMove(onMove);
      wrap.removeEventListener('mouseenter', onEnter);
      wrap.removeEventListener('mouseleave', onLeave);
      wrap.removeEventListener('click', onClick);
      el.style.display = 'none';
    };
  }, [contract, timeframe, isOrderChart]);

  // -- Preview overlay (bracket price lines) --
  const previewEnabled = useStore((s) => s.previewEnabled);
  const previewSide = useStore((s) => s.previewSide);
  const previewHideEntry = useStore((s) => s.previewHideEntry);
  const orderType = useStore((s) => s.orderType);
  const limitPrice = useStore((s) => s.limitPrice);
  const bracketPresets = useStore((s) => s.bracketPresets);
  const activePresetId = useStore((s) => s.activePresetId);
  const draftSlPoints = useStore((s) => s.draftSlPoints);
  const draftTpPoints = useStore((s) => s.draftTpPoints);
  const orderSize = useStore((s) => s.orderSize);
  const adHocSlPoints = useStore((s) => s.adHocSlPoints);
  const adHocTpLevels = useStore((s) => s.adHocTpLevels);
  const qoPendingPreview = useStore((s) => s.qoPendingPreview);

  type PreviewLineRole = { kind: 'entry' } | { kind: 'sl' } | { kind: 'tp'; index: number }
    | { kind: 'qo-sl' } | { kind: 'qo-tp'; index: number };

  const previewLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);
  const previewRolesRef = useRef<PreviewLineRole[]>([]);
  const previewPricesRef = useRef<number[]>([]); // current absolute prices for hit-testing
  const previewDragStateRef = useRef<{ role: PreviewLineRole; lineIdx: number } | null>(null);

  // Compute a unified BracketConfig from either preset+drafts or ad-hoc state
  function resolvePreviewConfig(): BracketConfig | null {
    const st = useStore.getState();
    const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);

    if (activePreset) {
      const bc = activePreset.config;
      return {
        ...bc,
        stopLoss: { ...bc.stopLoss, points: st.draftSlPoints ?? bc.stopLoss.points },
        takeProfits: bc.takeProfits.map((tp, i) => ({
          ...tp,
          points: st.draftTpPoints[i] ?? tp.points,
        })),
      };
    }

    if (st.adHocSlPoints != null || st.adHocTpLevels.length > 0) {
      return {
        stopLoss: { points: st.adHocSlPoints ?? 0, type: 'Stop' as const },
        takeProfits: st.adHocTpLevels.map((tp, i) => ({
          id: `adhoc-tp-${i}`,
          points: tp.points,
          size: tp.size,
        })),
        conditions: [],
      };
    }

    return null;
  }

  // Create / destroy lines when the structural config changes
  useEffect(() => {
    if (!isOrderChart) return;
    const series = seriesRef.current;
    if (!series) return;

    previewLinesRef.current.forEach((l) => series.removePriceLine(l));
    previewLinesRef.current = [];
    previewRolesRef.current = [];
    previewPricesRef.current = [];

    if (!previewEnabled || !contract) return;

    const config = resolvePreviewConfig();
    const tickSize = contract.tickSize;
    const toPrice = (points: number) => points * tickSize * TICKS_PER_POINT;

    const snap = useStore.getState();
    const entry = snap.orderType === 'limit' ? snap.limitPrice : snap.lastPrice;
    const ep = entry ?? 0;

    // Entry line (always created — hidden when limit order already placed)
    const hideEntry = snap.previewHideEntry;
    previewLinesRef.current.push(series.createPriceLine({
      price: ep, color: hideEntry ? 'transparent' : '#787b86', lineWidth: 1,
      lineStyle: LineStyle.Dashed, axisLabelVisible: !hideEntry, title: '',
    }));
    previewRolesRef.current.push({ kind: 'entry' });
    previewPricesRef.current.push(ep);

    if (config) {
      // SL line
      if (config.stopLoss.points > 0) {
        const slPts = config.stopLoss.points;
        const slPrice = ep ? (snap.previewSide === 0 ? ep - toPrice(slPts) : ep + toPrice(slPts)) : 0;
        previewLinesRef.current.push(series.createPriceLine({
          price: slPrice, color: '#ff444480', lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
        }));
        previewRolesRef.current.push({ kind: 'sl' });
        previewPricesRef.current.push(slPrice);
      }

      // TP lines
      config.takeProfits.forEach((tp, i) => {
        const tpPts = tp.points;
        const tpPrice = ep ? (snap.previewSide === 0 ? ep + toPrice(tpPts) : ep - toPrice(tpPts)) : 0;
        previewLinesRef.current.push(series.createPriceLine({
          price: tpPrice, color: '#00c805', lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
        }));
        previewRolesRef.current.push({ kind: 'tp', index: i });
        previewPricesRef.current.push(tpPrice);
      });
    }

    return () => {
      const s = seriesRef.current;
      if (s) {
        previewLinesRef.current.forEach((l) => s.removePriceLine(l));
        previewLinesRef.current = [];
        previewRolesRef.current = [];
        previewPricesRef.current = [];
      }
    };
  }, [isOrderChart, previewEnabled, previewSide, previewHideEntry, bracketPresets, activePresetId, contract, adHocSlPoints, adHocTpLevels]);

  // Update line prices in-place (no teardown → no flicker)
  // Uses direct Zustand subscription for lastPrice to avoid re-rendering on every tick
  useEffect(() => {
    if (!isOrderChart) return;
    if (!previewEnabled || !contract) return;
    if (previewLinesRef.current.length === 0) return;

    const tickSize = contract.tickSize;
    const toPrice = (points: number) => points * tickSize * TICKS_PER_POINT;

    function doUpdate() {
      const snap = useStore.getState();
      const entryPrice = snap.orderType === 'limit' ? snap.limitPrice : snap.lastPrice;
      if (!entryPrice) return;

      const cfg = resolvePreviewConfig();
      const prices: number[] = [];
      let idx = 0;

      // Entry
      previewLinesRef.current[idx]?.applyOptions({ price: entryPrice });
      prices.push(entryPrice);
      idx++;

      if (cfg) {
        // SL
        if (cfg.stopLoss.points > 0) {
          const slPts = cfg.stopLoss.points;
          const slPrice = snap.previewSide === 0 ? entryPrice - toPrice(slPts) : entryPrice + toPrice(slPts);
          previewLinesRef.current[idx]?.applyOptions({ price: slPrice });
          prices.push(slPrice);
          idx++;
        }

        // TPs
        cfg.takeProfits.forEach((tp) => {
          const tpPts = tp.points;
          const tpPrice = snap.previewSide === 0 ? entryPrice + toPrice(tpPts) : entryPrice - toPrice(tpPts);
          previewLinesRef.current[idx]?.applyOptions({ price: tpPrice });
          prices.push(tpPrice);
          idx++;
        });
      }

      previewPricesRef.current = prices;
      updateOverlayRef.current();
    }

    doUpdate();

    // Subscribe to lastPrice changes directly (bypasses React render cycle)
    let prevLp = useStore.getState().lastPrice;
    const unsub = useStore.subscribe((state) => {
      if (state.lastPrice !== prevLp) {
        prevLp = state.lastPrice;
        doUpdate();
      }
    });

    return () => { unsub(); };
  }, [isOrderChart, previewEnabled, previewSide, bracketPresets, activePresetId, contract, orderType, limitPrice, draftSlPoints, draftTpPoints, adHocSlPoints, adHocTpLevels]);

  // -- Drag interaction for preview lines (initiated from overlay labels) --
  useEffect(() => {
    if (!isOrderChart) return;
    const container = containerRef.current;
    if (!container || (!previewEnabled && !qoPendingPreview) || !contract) return;

    function snap(price: number): number {
      const ts = contract!.tickSize;
      return Math.round(price / ts) * ts;
    }

    function onMouseMove(e: MouseEvent) {
      const drag = previewDragStateRef.current;
      if (!drag) return;

      // Don't stopPropagation — let LWC see the event so crosshair stays visible
      e.preventDefault();

      const rect = container!.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const series = seriesRef.current;
      if (!series) return;
      const rawPrice = series.coordinateToPrice(mouseY);
      if (rawPrice === null) return;
      const snapped = snap(rawPrice as number);

      // Quick-order pending preview drag
      if (drag.role.kind === 'qo-sl') {
        const line = qoPreviewLinesRef.current.sl;
        if (line) line.applyOptions({ price: snapped });
        qoPreviewPricesRef.current.sl = snapped;
        updateOverlayRef.current();
        return;
      }
      if (drag.role.kind === 'qo-tp') {
        const tpIdx = drag.role.index;
        const line = qoPreviewLinesRef.current.tps[tpIdx];
        if (line) line.applyOptions({ price: snapped });
        qoPreviewPricesRef.current.tps[tpIdx] = snapped;
        updateOverlayRef.current();
        return;
      }

      // Regular order panel preview drag
      previewLinesRef.current[drag.lineIdx]?.applyOptions({ price: snapped });
      previewPricesRef.current[drag.lineIdx] = snapped;
      updateOverlayRef.current();

      const st = useStore.getState();
      const tickSize = contract!.tickSize;

      if (drag.role.kind === 'entry') {
        st.setOrderType('limit');
        st.setLimitPrice(snapped);
      } else {
        const entryPrice = st.orderType === 'limit' ? st.limitPrice : st.lastPrice;
        if (entryPrice) {
          const pts = Math.abs(entryPrice - snapped) / (tickSize * TICKS_PER_POINT);
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
      const drag = previewDragStateRef.current;
      if (drag) {
        // Entry label click-vs-drag: if movement < 4px, treat as click (submit order)
        const click = entryClickRef.current;
        if (click) {
          const dx = Math.abs(e.clientX - click.downX);
          const dy = Math.abs(e.clientY - click.downY);
          if (dx < 4 && dy < 4) click.exec();
          entryClickRef.current = null;
        }

        // Commit quick-order pending preview drag to store + bracketEngine
        if (drag.role.kind === 'qo-sl' || drag.role.kind === 'qo-tp') {
          const st = useStore.getState();
          const cur = st.qoPendingPreview;
          if (cur) {
            const tickSize = contract!.tickSize;
            if (drag.role.kind === 'qo-sl' && qoPreviewPricesRef.current.sl != null) {
              const newSlPrice = qoPreviewPricesRef.current.sl;
              st.setQoPendingPreview({ ...cur, slPrice: newSlPrice });
              const slDiff = Math.abs(cur.entryPrice - newSlPrice);
              const slPoints = Math.round(slDiff / (tickSize * TICKS_PER_POINT));
              bracketEngine.updateArmedConfig((cfg) => ({
                ...cfg,
                stopLoss: { ...cfg.stopLoss, points: Math.max(1, slPoints) },
              }));
            } else if (drag.role.kind === 'qo-tp') {
              const tpIdx = drag.role.index;
              const newTpPrice = qoPreviewPricesRef.current.tps[tpIdx];
              if (newTpPrice != null) {
                const newTpPrices = [...cur.tpPrices];
                newTpPrices[tpIdx] = newTpPrice;
                st.setQoPendingPreview({ ...cur, tpPrices: newTpPrices });
                const tpDiff = Math.abs(newTpPrice - cur.entryPrice);
                const tpPoints = Math.round(tpDiff / (tickSize * TICKS_PER_POINT));
                bracketEngine.updateArmedConfig((cfg) => ({
                  ...cfg,
                  takeProfits: cfg.takeProfits.map((tp, i) =>
                    i === tpIdx ? { ...tp, points: Math.max(1, tpPoints) } : tp),
                }));
              }
            }
          }
        }

        previewDragStateRef.current = null;
        if (activeDragRowRef.current) {
          activeDragRowRef.current.style.cursor = 'pointer';
          activeDragRowRef.current = null;
        }
        if (containerRef.current) containerRef.current.style.cursor = CROSSHAIR_CURSOR;
        // Re-enable LWC scroll/scale after drag
        if (chartRef.current) chartRef.current.applyOptions({ handleScroll: true, handleScale: true });
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isOrderChart, previewEnabled, qoPendingPreview, contract]);

  // -- Live order & position lines (always visible) --
  const openOrders = useStore((s) => s.openOrders);
  const positions = useStore((s) => s.positions);
  const activeAccountId = useStore((s) => s.activeAccountId);

  type OrderLineMeta = { kind: 'position' } | { kind: 'order'; order: Order };

  const orderLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);
  const orderLineMetaRef = useRef<OrderLineMeta[]>([]);
  const orderLinePricesRef = useRef<number[]>([]);
  const orderDragStateRef = useRef<{ meta: OrderLineMeta; idx: number; originalPrice: number; draggedPrice: number } | null>(null);
  const activeDragRowRef = useRef<HTMLDivElement | null>(null);

  // Hit-target registry: overlay labels register interactive regions here.
  // The container-level mousedown handler checks these via getBoundingClientRect().
  type HitTarget = {
    el: HTMLDivElement;
    priority: number;        // 0=buttons, 1=entry-click, 2=row-drag
    handler: (e: MouseEvent) => void;
  };
  const hitTargetsRef = useRef<HitTarget[]>([]);
  const entryClickRef = useRef<{ downX: number; downY: number; exec: () => void } | null>(null);

  // Position drag-to-create SL/TP refs
  const posDragRef = useRef<{
    isLong: boolean;
    posSize: number;
    avgPrice: number;
    direction: 'sl' | 'tp' | null;
    snappedPrice: number;
  } | null>(null);
  const posDragLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);
  const posDragLabelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOrderChart) return;
    const series = seriesRef.current;
    if (!series) return;

    // Tear down previous
    orderLinesRef.current.forEach((l) => series.removePriceLine(l));
    orderLinesRef.current = [];
    orderLineMetaRef.current = [];
    orderLinePricesRef.current = [];

    if (!contract) return;

    // Position entry line (not draggable)
    const pos = positions.find(
      (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
    );
    if (pos) {
      orderLinesRef.current.push(series.createPriceLine({
        price: pos.averagePrice,
        color: '#cac8cb',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: '',
      }));
      orderLineMetaRef.current.push({ kind: 'position' });
      orderLinePricesRef.current.push(pos.averagePrice);
    }

    // Open order lines (draggable)
    const isLong = pos ? pos.type === 1 : undefined;
    for (const order of openOrders) {
      if (order.contractId !== contract.id) continue;

      let price: number | undefined;
      let color: string;

      if (order.type === 4 || order.type === 5) {
        price = order.stopPrice;
      } else if (order.type === 1) {
        price = order.limitPrice;
      } else {
        continue;
      }

      // Color by profit/loss relative to position; fall back to red SL / side-based limit
      if (pos && price != null) {
        const inProfit = isLong ? price >= pos.averagePrice : price <= pos.averagePrice;
        color = inProfit ? '#00c805' : '#ff0000';
      } else if (order.type === 4 || order.type === 5) {
        color = '#ff0000';
      } else {
        color = order.side === 1 ? '#ff0000' : '#00c805';
      }

      if (price == null) continue;

      orderLinesRef.current.push(series.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: '',
      }));
      orderLineMetaRef.current.push({ kind: 'order', order });
      orderLinePricesRef.current.push(price);
    }

    return () => {
      const s = seriesRef.current;
      if (s) {
        orderLinesRef.current.forEach((l) => s.removePriceLine(l));
        orderLinesRef.current = [];
        orderLineMetaRef.current = [];
        orderLinePricesRef.current = [];
      }
    };
  }, [isOrderChart, openOrders, positions, contract, activeAccountId]);

  // -- Drag interaction for live order lines (initiated from overlay labels) --
  useEffect(() => {
    if (!isOrderChart) return;
    const container = containerRef.current;
    if (!container || !contract) return;

    function snapPrice(price: number): number {
      const ts = contract!.tickSize;
      return Math.round(price / ts) * ts;
    }

    function onMouseMove(e: MouseEvent) {
      const drag = orderDragStateRef.current;
      if (!drag) return;

      // Don't stopPropagation — let LWC see the event so crosshair stays visible
      e.preventDefault();

      const rect = container!.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const series = seriesRef.current;
      if (!series) return;
      const rawPrice = series.coordinateToPrice(mouseY);
      if (rawPrice === null) return;
      const snapped = snapPrice(rawPrice as number);

      // Update line price + color based on profit/loss relative to position
      const pos = positions.find(
        (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract!.id) && p.size > 0,
      );
      let lineColor: string | undefined;
      if (pos) {
        const isL = pos.type === 1;
        lineColor = (isL ? snapped >= pos.averagePrice : snapped <= pos.averagePrice) ? '#00c805' : '#ff0000';
      }
      orderLinesRef.current[drag.idx]?.applyOptions({ price: snapped, ...(lineColor ? { color: lineColor } : {}) });
      orderLinePricesRef.current[drag.idx] = snapped;
      drag.draggedPrice = snapped;
      updateOverlayRef.current();
    }

    function onMouseUp() {
      const drag = orderDragStateRef.current;
      if (!drag) return;

      const { meta, originalPrice, draggedPrice: newPrice } = drag;
      orderDragStateRef.current = null;
      if (activeDragRowRef.current) {
        activeDragRowRef.current.style.cursor = 'pointer';
        activeDragRowRef.current = null;
      }
      if (containerRef.current) containerRef.current.style.cursor = CROSSHAIR_CURSOR;
      // Re-enable LWC scroll/scale after drag
      if (chartRef.current) chartRef.current.applyOptions({ handleScroll: true, handleScale: true });

      if (meta.kind !== 'order' || newPrice === originalPrice) return;

      const { order } = meta;
      const dragIdx = drag.idx;
      const accountId = useStore.getState().activeAccountId;
      if (!accountId) return;

      const params: { accountId: number; orderId: number; stopPrice?: number; limitPrice?: number } = {
        accountId,
        orderId: order.id,
      };

      if (order.type === 4 || order.type === 5) {
        params.stopPrice = newPrice;
      } else if (order.type === 1) {
        params.limitPrice = newPrice;
      }

      orderService.modifyOrder(params).catch((err) => {
        console.error('[Chart] Failed to modify order:', err);
        showToast('error', 'Order modification failed', errorMessage(err));
        // Revert line back to original price
        const line = orderLinesRef.current[dragIdx];
        if (line) {
          // Recompute correct color based on position
          const pos = positions.find(
            (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract!.id) && p.size > 0,
          );
          let revertColor = '#ff0000';
          if (pos) {
            const isL = pos.type === 1;
            revertColor = (isL ? originalPrice >= pos.averagePrice : originalPrice <= pos.averagePrice)
              ? '#00c805' : '#ff0000';
          }
          line.applyOptions({ price: originalPrice, color: revertColor });
          orderLinePricesRef.current[dragIdx] = originalPrice;
          updateOverlayRef.current();
        }
      });
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isOrderChart, contract]);

  // -- Position drag-to-create SL/TP (drag from position label → place order on release) --
  useEffect(() => {
    if (!isOrderChart) return;
    const container = containerRef.current;
    if (!container || !contract) return;

    const tickSize = contract.tickSize;

    function snapPrice(price: number): number {
      return Math.round(price / tickSize) * tickSize;
    }

    function onMouseMove(e: MouseEvent) {
      const drag = posDragRef.current;
      if (!drag) return;

      // Don't stopPropagation — let the event reach LWC so the crosshair stays visible
      e.preventDefault();

      const rect = container!.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const series = seriesRef.current;
      if (!series) return;
      const rawPrice = series.coordinateToPrice(mouseY);
      if (rawPrice === null) return;
      const snapped = snapPrice(rawPrice as number);

      // Determine direction based on price relative to position
      let direction: 'sl' | 'tp';
      if (drag.isLong) {
        direction = snapped < drag.avgPrice ? 'sl' : 'tp';
      } else {
        direction = snapped > drag.avgPrice ? 'sl' : 'tp';
      }
      drag.direction = direction;
      drag.snappedPrice = snapped;

      // Create or update temporary preview line
      const color = direction === 'sl' ? '#ff4444' : '#00c805';
      if (!posDragLineRef.current) {
        posDragLineRef.current = series.createPriceLine({
          price: snapped, color, lineWidth: 2,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
        });
      } else {
        posDragLineRef.current.applyOptions({ price: snapped, color });
      }

      // Compute projected P&L for the label
      const tv = contract!.tickValue || 0.50;
      const ts = contract!.tickSize;
      const diff = drag.isLong
        ? (direction === 'tp' ? snapped - drag.avgPrice : drag.avgPrice - snapped)
        : (direction === 'tp' ? drag.avgPrice - snapped : snapped - drag.avgPrice);
      const orderSz = direction === 'sl' ? drag.posSize : 1;
      const pnl = (diff / ts) * tv * orderSz;
      const pnlText = direction === 'sl'
        ? `-$${Math.abs(pnl).toFixed(2)}`
        : `+$${Math.abs(pnl).toFixed(2)}`;
      const labelText = direction === 'sl' ? 'SL' : 'TP';
      const labelBg = color;
      const sizeBg = color;
      const textColor = color === '#00c805' ? '#000' : '#fff';

      // Create or update temporary overlay label
      const overlay = overlayRef.current;
      if (!posDragLabelRef.current && overlay) {
        const row = document.createElement('div');
        row.style.cssText = 'position:absolute;left:50%;display:flex;height:20px;font-size:11px;font-weight:bold;font-family:-apple-system,BlinkMacSystemFont,Trebuchet MS,Roboto,Ubuntu,sans-serif;line-height:20px;transform:translate(-50%,-50%);white-space:nowrap;border-radius:3px;overflow:hidden;pointer-events:none;';
        // P&L cell
        const pnlCell = document.createElement('div');
        pnlCell.style.cssText = `background:${labelBg};color:${textColor};padding:0 6px;`;
        pnlCell.textContent = pnlText;
        pnlCell.dataset.role = 'pnl';
        row.appendChild(pnlCell);
        // Size cell
        const sizeCell = document.createElement('div');
        sizeCell.style.cssText = `background:${sizeBg};color:${textColor};padding:0 6px;`;
        sizeCell.textContent = String(orderSz);
        sizeCell.dataset.role = 'size';
        row.appendChild(sizeCell);
        // Label cell
        const lblCell = document.createElement('div');
        lblCell.style.cssText = `background:#e0e0e0;color:#000;padding:0 6px;`;
        lblCell.textContent = labelText;
        lblCell.dataset.role = 'lbl';
        row.appendChild(lblCell);
        overlay.appendChild(row);
        posDragLabelRef.current = row;
      }
      if (posDragLabelRef.current) {
        // Update cell contents
        const cells = posDragLabelRef.current.children;
        const pnlCell = cells[0] as HTMLDivElement;
        const sizeCell = cells[1] as HTMLDivElement;
        const lblCell = cells[2] as HTMLDivElement;
        pnlCell.textContent = pnlText;
        pnlCell.style.background = labelBg;
        pnlCell.style.color = textColor;
        sizeCell.textContent = String(orderSz);
        sizeCell.style.background = sizeBg;
        sizeCell.style.color = textColor;
        lblCell.textContent = labelText;
        // Position at Y coordinate of the snapped price
        const y = series.priceToCoordinate(snapped);
        if (y !== null) {
          posDragLabelRef.current.style.top = `${y}px`;
          posDragLabelRef.current.style.display = 'flex';
        }
      }
    }

    function onMouseUp() {
      const drag = posDragRef.current;
      if (!drag) return;

      posDragRef.current = null;
      if (activeDragRowRef.current) {
        activeDragRowRef.current.style.cursor = 'pointer';
        activeDragRowRef.current = null;
      }
      if (containerRef.current) containerRef.current.style.cursor = CROSSHAIR_CURSOR;
      // Re-enable LWC scroll/scale after drag
      if (chartRef.current) chartRef.current.applyOptions({ handleScroll: true, handleScale: true });

      // Remove temporary line + label
      if (posDragLineRef.current && seriesRef.current) {
        seriesRef.current.removePriceLine(posDragLineRef.current);
        posDragLineRef.current = null;
      }
      if (posDragLabelRef.current) {
        posDragLabelRef.current.remove();
        posDragLabelRef.current = null;
      }

      if (!drag.direction) return;

      const st = useStore.getState();
      if (!st.activeAccountId || !contract) return;

      const oppositeSide: 0 | 1 = drag.isLong ? 1 : 0;

      if (drag.direction === 'sl') {
        // Validate: no existing stop order for this contract + side
        const existingSL = st.openOrders.some(
          (o) => String(o.contractId) === String(contract!.id)
            && (o.type === 4 || o.type === 5)
            && o.side === oppositeSide,
        );
        if (existingSL) {
          console.warn('[Chart] SL already exists for this position');
          return;
        }
        orderService.placeOrder({
          accountId: st.activeAccountId,
          contractId: contract!.id,
          type: 4,
          side: oppositeSide,
          size: drag.posSize,
          stopPrice: drag.snappedPrice,
        }).catch((err) => {
          console.error('[Chart] Failed to place SL from drag:', err);
          showToast('error', 'Stop Loss placement failed', errorMessage(err));
        });
      } else {
        // TP: validate remaining contracts
        const existingTpSize = st.openOrders
          .filter(
            (o) => String(o.contractId) === String(contract!.id)
              && o.type === 1
              && o.side === oppositeSide,
          )
          .reduce((sum, o) => sum + o.size, 0);
        const remaining = drag.posSize - existingTpSize;
        if (remaining <= 0) {
          console.warn('[Chart] No remaining contracts for TP');
          return;
        }
        orderService.placeOrder({
          accountId: st.activeAccountId,
          contractId: contract!.id,
          type: 1,
          side: oppositeSide,
          size: Math.min(1, remaining),
          limitPrice: drag.snappedPrice,
        }).catch((err) => {
          console.error('[Chart] Failed to place TP from drag:', err);
          showToast('error', 'Take Profit placement failed', errorMessage(err));
        });
      }
    }

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);

    return () => {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      if (posDragLineRef.current && seriesRef.current) {
        seriesRef.current.removePriceLine(posDragLineRef.current);
        posDragLineRef.current = null;
      }
      if (posDragLabelRef.current) {
        posDragLabelRef.current.remove();
        posDragLabelRef.current = null;
      }
    };
  }, [isOrderChart, contract, positions, openOrders, activeAccountId]);

  // -- Overlay label system (HTML labels positioned over price lines) --
  const updateOverlayRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!isOrderChart) return;
    const overlay = overlayRef.current;
    const series = seriesRef.current;
    if (!overlay || !series) return;

    // Clear previous labels + hit targets
    overlay.innerHTML = '';
    hitTargetsRef.current = [];

    const tickSize = contract?.tickSize || 0.25;
    const tickValue = contract?.tickValue || 0.50;

    type OverlayEl = {
      root: HTMLDivElement;
      priceGetter: () => number;
      pnlCell: HTMLDivElement | null;
      pnlCompute: (() => { text: string; bg: string; color?: string } | null) | null;
    };

    const overlayEls: OverlayEl[] = [];

    // Helper to build a row with sections.
    // All elements are pointer-events:none — interaction is handled via
    // coordinate-based hit testing at the container level (hitTargetsRef).
    function buildRow(
      sections: { text: string; bg: string; color: string; pointerEvents?: boolean; onClick?: () => void }[],
    ): { root: HTMLDivElement; firstCell: HTMLDivElement; cells: HTMLDivElement[] } {
      const row = document.createElement('div');
      row.style.cssText = 'position:absolute;left:50%;display:flex;height:20px;font-size:11px;font-weight:bold;font-family:-apple-system,BlinkMacSystemFont,Trebuchet MS,Roboto,Ubuntu,sans-serif;line-height:20px;transform:translate(-50%,-50%);white-space:nowrap;border-radius:3px;overflow:hidden;';
      let firstCell!: HTMLDivElement;
      const cells: HTMLDivElement[] = [];
      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        const cell = document.createElement('div');
        cell.style.cssText = `background:${sec.bg};color:${sec.color};padding:0 6px;${si > 0 ? 'border-left:1px solid #000;' : ''}`;
        cell.textContent = sec.text;
        if (si === 0) firstCell = cell;
        cells.push(cell);
        row.appendChild(cell);
      }
      overlay!.appendChild(row);
      return { root: row, firstCell, cells };
    }

    // Register button cells (close-X, +SL, +TP) as priority-0 hit targets
    function registerCellHitTargets(
      sections: { pointerEvents?: boolean; onClick?: () => void }[],
      cells: HTMLDivElement[],
    ) {
      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        if (sec.pointerEvents && sec.onClick) {
          const handler = sec.onClick;
          hitTargetsRef.current.push({
            el: cells[si],
            priority: 0,
            handler: () => handler(),
          });
        }
      }
    }

    // Text color helper: always black
    function textFor(_bg: string): string {
      return '#000';
    }

    // --- Position label ---
    if (contract) {
      const pos = positions.find(
        (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
      );
      if (pos) {
        const isLong = pos.type === 1;
        const sideBg = isLong ? '#00c805' : '#ff0000';

        // Compute initial P&L — use cached value if lastPrice not yet available
        const lp = useStore.getState().lastPrice;
        let initText: string;
        let initBg: string;
        if (lp != null) {
          const diff = isLong ? lp - pos.averagePrice : pos.averagePrice - lp;
          const initPnl = (diff / tickSize) * tickValue * pos.size;
          initText = `${initPnl >= 0 ? '+' : ''}$${initPnl.toFixed(2)}`;
          initBg = initPnl >= 0 ? '#00c805' : '#ff0000';
          lastPnlCache.current = { text: initText, bg: initBg };
        } else if (lastPnlCache.current.text) {
          initText = lastPnlCache.current.text;
          initBg = lastPnlCache.current.bg;
        } else {
          initText = '---';
          initBg = '#787b86';
        }

        const posSections = [
          { text: initText, bg: initBg, color: textFor(initBg) },
          { text: String(pos.size), bg: sideBg, color: textFor(sideBg) },
          {
            text: '\u2715', bg: '#e0e0e0', color: '#000', pointerEvents: true,
            onClick: () => {
              const acct = useStore.getState().activeAccountId;
              if (!acct || !contract) return;
              orderService.placeOrder({
                accountId: acct, contractId: contract.id,
                type: 2, side: isLong ? 1 : 0, size: pos.size,
              }).catch((err) => {
                console.error('Failed to close position:', err);
                showToast('error', 'Failed to close position', errorMessage(err));
              });
            },
          },
        ];
        const { root, firstCell, cells } = buildRow(posSections);

        // Register close-X button + row drag via hit-target system (no pointer-events on DOM)
        registerCellHitTargets(posSections, cells);
        hitTargetsRef.current.push({
          el: root,
          priority: 2,
          handler: () => {
            posDragRef.current = {
              isLong,
              posSize: pos.size,
              avgPrice: pos.averagePrice,
              direction: null,
              snappedPrice: pos.averagePrice,
            };
            activeDragRowRef.current = root;
            root.style.cursor = 'grabbing';
            if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
            // Disable LWC scroll/scale so the chart doesn't pan during drag
            if (chartRef.current) chartRef.current.applyOptions({ handleScroll: false, handleScale: false });
          },
        });

        overlayEls.push({
          root,
          priceGetter: () => pos.averagePrice,
          pnlCell: firstCell,

          pnlCompute: () => {
            const curPrice = useStore.getState().lastPrice;
            if (curPrice == null) return lastPnlCache.current.text ? lastPnlCache.current : null;
            const diff = isLong ? curPrice - pos.averagePrice : pos.averagePrice - curPrice;
            const pnl = (diff / tickSize) * tickValue * pos.size;
            const bg = pnl >= 0 ? '#00c805' : '#ff0000';
            const result = {
              text: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
              bg,
              color: textFor(bg),
            };
            lastPnlCache.current = result;
            return result;
          },
        });
      }
    }

    // --- Open order labels (SL/TP show projected P&L) ---
    const pos = contract ? positions.find(
      (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
    ) : undefined;

    for (const order of openOrders) {
      if (!contract || String(order.contractId) !== String(contract.id)) continue;
      let price: number | undefined;
      if (order.type === 4 || order.type === 5) {
        price = order.stopPrice;
      } else if (order.type === 1) {
        price = order.limitPrice;
      } else {
        continue;
      }
      if (price == null) continue;

      const orderId = order.id;
      const orderSize = order.size;
      const orderSide = order.side;
      const orderType = order.type;

      // P&L color by profit/loss relative to position
      function profitColor(p: number): string {
        if (pos) {
          const isL = pos.type === 1;
          return (isL ? p >= pos.averagePrice : p <= pos.averagePrice) ? '#00c805' : '#ff0000';
        }
        return (orderType === 4 || orderType === 5) ? '#ff0000'
          : orderSide === 1 ? '#ff0000' : '#00c805';
      }
      // Size cell color by order side (sell=red, buy=green)
      const sizeBg = orderSide === 1 ? '#ff0000' : '#00c805';

      // Lookup current price from refs (changes during drag)
      function getOrderRefPrice(): number {
        for (let k = 0; k < orderLineMetaRef.current.length; k++) {
          const m = orderLineMetaRef.current[k];
          if (m.kind === 'order' && m.order.id === orderId) {
            return orderLinePricesRef.current[k];
          }
        }
        return price!;
      }

      // Compute projected P&L
      let initPnlText: string;
      let initPnlBg: string;
      let pnlCompute: (() => { text: string; bg: string }) | null = null;

      if (pos) {
        const isLong = pos.type === 1;
        const diff = isLong ? price - pos.averagePrice : pos.averagePrice - price;
        const projPnl = (diff / tickSize) * tickValue * orderSize;
        initPnlText = `${projPnl >= 0 ? '+' : ''}$${projPnl.toFixed(2)}`;
        initPnlBg = profitColor(price);

        pnlCompute = () => {
          const curPrice = getOrderRefPrice();
          const d = isLong ? curPrice - pos.averagePrice : pos.averagePrice - curPrice;
          const pnl = (d / tickSize) * tickValue * orderSize;
          const bg = profitColor(curPrice);
          return {
            text: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
            bg,
            color: textFor(bg),
          };
        };
      } else {
        initPnlText = (orderType === 4 || orderType === 5) ? 'SL'
          : orderSide === 0 ? 'Buy Limit' : 'Sell Limit';
        initPnlBg = (orderType === 4 || orderType === 5) ? '#ff0000' : '#cac9cb';
      }

      const orderSections = [
        { text: initPnlText, bg: initPnlBg, color: initPnlBg === '#cac9cb' ? '#000' : textFor(initPnlBg) },
        { text: String(orderSize), bg: sizeBg, color: textFor(sizeBg) },
        {
          text: '\u2715', bg: '#e0e0e0', color: '#000', pointerEvents: true,
          onClick: () => {
            const acct = useStore.getState().activeAccountId;
            if (!acct) return;
            orderService.cancelOrder(acct, orderId).catch((err) => {
              console.error('[Chart] Failed to cancel order:', err);
              showToast('error', 'Failed to cancel order', errorMessage(err));
            });
          },
        },
      ];
      const { root, firstCell, cells } = buildRow(orderSections);

      // Register cancel-X button + row drag via hit-target system
      registerCellHitTargets(orderSections, cells);
      const dragOrder = order;
      hitTargetsRef.current.push({
        el: root,
        priority: 1, // higher than position row-drag (2) so order drag wins when overlapping (e.g. SL at BE)
        handler: () => {
          let idx = -1;
          for (let k = 0; k < orderLineMetaRef.current.length; k++) {
            const m = orderLineMetaRef.current[k];
            if (m.kind === 'order' && m.order.id === dragOrder.id) { idx = k; break; }
          }
          if (idx === -1) return;
          orderDragStateRef.current = {
            meta: { kind: 'order', order: dragOrder },
            idx,
            originalPrice: orderLinePricesRef.current[idx],
            draggedPrice: orderLinePricesRef.current[idx],
          };
          activeDragRowRef.current = root;
          root.style.cursor = 'grabbing';
          if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
          if (chartRef.current) chartRef.current.applyOptions({ handleScroll: false, handleScale: false });
        },
      });

      overlayEls.push({
        root,
        priceGetter: getOrderRefPrice,
        pnlCell: pnlCompute ? firstCell : null,
        pnlCompute,
      });
    }

    // --- Preview labels ---
    const snap2 = useStore.getState();
    const pvSide = snap2.previewSide;
    const previewTotalSize = snap2.orderSize;
    const hasPreset = snap2.bracketPresets.some((p) => p.id === snap2.activePresetId);
    const previewPreset = snap2.bracketPresets.find((p) => p.id === snap2.activePresetId);
    const previewTpSizes = hasPreset
      ? (previewPreset?.config.takeProfits.map((tp) => tp.size) ?? [])
      : snap2.adHocTpLevels.map((tp) => tp.size);

    for (let i = 0; i < previewRolesRef.current.length; i++) {
      const role = previewRolesRef.current[i];
      const price = previewPricesRef.current[i];
      if (price == null) continue;

      let onCancel: (() => void) | undefined;
      let onExecute: (() => void) | undefined;
      let pnlText: string;
      let pnlBg: string;
      let pnlCompute: (() => { text: string; bg: string }) | null = null;
      let displaySize: number;

      if (role.kind === 'entry') {
        // Skip entry label entirely when hidden (limit order already placed)
        if (snap2.previewHideEntry) continue;
        pnlText = pvSide === 0 ? 'Limit Buy' : 'Limit Sell';
        pnlBg = '#cac9cb';
        displaySize = previewTotalSize;
        onCancel = () => useStore.getState().togglePreview();
        onExecute = async () => {
          const st = useStore.getState();
          if (!st.activeAccountId || !contract) return;
          const side: 0 | 1 = st.previewSide;

          const params: PlaceOrderParams = {
            accountId: st.activeAccountId,
            contractId: contract.id,
            type: st.orderType === 'market' ? 2 : 1,
            side,
            size: st.orderSize,
          };
          if (st.orderType === 'limit' && st.limitPrice != null) {
            params.limitPrice = st.limitPrice;
          }

          // Use resolvePreviewConfig for both preset and ad-hoc brackets
          const mergedConfig = resolvePreviewConfig();
          const bracketsActive = mergedConfig != null
            && (mergedConfig.stopLoss.points >= 1 || mergedConfig.takeProfits.length >= 1);

          if (bracketsActive && mergedConfig) {
            bracketEngine.armForEntry({
              accountId: st.activeAccountId,
              contractId: contract.id,
              entrySide: side,
              entrySize: st.orderSize,
              config: mergedConfig,
              tickSize: contract.tickSize || 0.25,
            });
          }

          try {
            const { orderId } = await orderService.placeOrder(params);
            if (bracketsActive) bracketEngine.confirmEntryOrderId(orderId);
            const s = useStore.getState();
            s.clearDraftOverrides();
            if (s.orderType === 'market') {
              s.clearAdHocBrackets();
              s.togglePreview();
            } else {
              // Limit: hide entry line (real order covers it), keep SL/TP visible
              useStore.setState({ previewHideEntry: true });
            }
          } catch (err) {
            console.error('[Chart] Failed to place order from preview:', err);
            showToast('error', 'Order placement failed', errorMessage(err));
          }
        };
      } else if (role.kind === 'sl') {
        // SL projected P&L (always negative, full position size)
        displaySize = previewTotalSize;
        const entryPrice = previewPricesRef.current[0] ?? 0;
        const slDiff = pvSide === 0 ? entryPrice - price : price - entryPrice;
        const slPnl = (slDiff / tickSize) * tickValue * displaySize;
        pnlText = `-$${Math.abs(slPnl).toFixed(2)}`;
        pnlBg = '#ff0000';
        onCancel = hasPreset
          ? () => useStore.getState().setDraftSlPoints(0)
          : () => useStore.getState().setAdHocSlPoints(null);

        const previewIdx = i;
        pnlCompute = () => {
          const ep = previewPricesRef.current[0] ?? 0;
          const sp = previewPricesRef.current[previewIdx] ?? price;
          const s1 = useStore.getState();
          const sz = s1.orderSize;
          const diff = s1.previewSide === 0 ? ep - sp : sp - ep;
          const pnl = (diff / tickSize) * tickValue * sz;
          return {
            text: `-$${Math.abs(pnl).toFixed(2)}`,
            bg: '#ff0000',
          };
        };
      } else {
        // TP projected P&L — use individual TP size
        displaySize = previewTpSizes[role.index] ?? previewTotalSize;
        const entryPrice = previewPricesRef.current[0] ?? 0;
        const tpDiff = pvSide === 0 ? price - entryPrice : entryPrice - price;
        const tpPnl = (tpDiff / tickSize) * tickValue * displaySize;
        pnlText = `+$${Math.abs(tpPnl).toFixed(2)}`;
        pnlBg = '#00c805';
        onCancel = hasPreset
          ? () => useStore.getState().setDraftTpPoints(role.index, 0)
          : () => useStore.getState().removeAdHocTp(role.index);

        const tpIdx = role.index;
        const previewIdx = i;
        pnlCompute = () => {
          const ep = previewPricesRef.current[0] ?? 0;
          const tp = previewPricesRef.current[previewIdx] ?? price;
          const s2 = useStore.getState();
          const presetCfg = s2.bracketPresets.find((p) => p.id === s2.activePresetId);
          const sz = presetCfg
            ? (presetCfg.config.takeProfits[tpIdx]?.size ?? s2.orderSize)
            : (s2.adHocTpLevels[tpIdx]?.size ?? 1);
          const diff = s2.previewSide === 0 ? tp - ep : ep - tp;
          const pnl = (diff / tickSize) * tickValue * sz;
          return {
            text: `+$${Math.abs(pnl).toFixed(2)}`,
            bg: '#00c805',
            color: '#000',
          };
        };
      }

      const previewIdx = i;
      const isEntry = role.kind === 'entry';
      const entrySideBg = pvSide === 0 ? '#00c805' : '#ff0000';
      const sizeBg = isEntry ? entrySideBg : role.kind === 'sl' ? '#ff0000' : '#00c805';

      // Build sections array — entry label gets +SL/+TP buttons when no preset
      const sections: { text: string; bg: string; color: string; pointerEvents?: boolean; onClick?: () => void }[] = [
        {
          text: pnlText, bg: pnlBg, color: isEntry ? '#000' : textFor(pnlBg),
          ...(onExecute ? { pointerEvents: true } : {}),
        },
        { text: String(displaySize), bg: sizeBg, color: textFor(sizeBg) },
      ];

      // +SL / +TP buttons on entry label when no preset is active
      if (isEntry && !hasPreset) {
        const curAdHocSl = snap2.adHocSlPoints;
        const allocatedTpSize = snap2.adHocTpLevels.reduce((sum, tp) => sum + tp.size, 0);
        const remainingContracts = previewTotalSize - allocatedTpSize;

        if (curAdHocSl == null) {
          sections.push({
            text: '+SL', bg: '#ff444480', color: '#000', pointerEvents: true,
            onClick: () => useStore.getState().setAdHocSlPoints(10),
          });
        }
        if (remainingContracts > 0) {
          sections.push({
            text: '+TP', bg: '#00c80580', color: '#000', pointerEvents: true,
            onClick: () => {
              const st = useStore.getState();
              const n = st.adHocTpLevels.length;
              st.addAdHocTp(20 * (n + 1), 1);
            },
          });
        }
      }

      sections.push({
        text: '\u2715', bg: '#e0e0e0', color: '#000', pointerEvents: true,
        onClick: onCancel,
      });

      const { root, firstCell, cells } = buildRow(sections);

      // Register button cells (+SL, +TP, close-X) via hit-target system
      registerCellHitTargets(sections, cells);

      const dragRole = role;
      const dragLineIdx = i;

      // Entry label firstCell: click-vs-drag detection (priority 1)
      if (onExecute) {
        const exec = onExecute;
        hitTargetsRef.current.push({
          el: firstCell,
          priority: 1,
          handler: (e: MouseEvent) => {
            entryClickRef.current = { downX: e.clientX, downY: e.clientY, exec };
            previewDragStateRef.current = { role: dragRole, lineIdx: dragLineIdx };
            activeDragRowRef.current = root;
            root.style.cursor = 'grabbing';
            if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
            if (chartRef.current) chartRef.current.applyOptions({ handleScroll: false, handleScale: false });
          },
        });
      }

      // Row drag (priority 2)
      hitTargetsRef.current.push({
        el: root,
        priority: 2,
        handler: () => {
          entryClickRef.current = null;
          previewDragStateRef.current = { role: dragRole, lineIdx: dragLineIdx };
          activeDragRowRef.current = root;
          root.style.cursor = 'grabbing';
          if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
          if (chartRef.current) chartRef.current.applyOptions({ handleScroll: false, handleScale: false });
        },
      });

      overlayEls.push({
        root,
        priceGetter: () => previewPricesRef.current[previewIdx] ?? price,
        pnlCell: pnlCompute ? firstCell : null,
        pnlCompute,
      });
    }

    // --- Quick order pending preview labels (+ button brackets awaiting fill) ---
    if (qoPendingPreview) {
      const qo = qoPendingPreview;
      const qoEntryPrice = qo.entryPrice;

      // Initialize mutable prices ref (used by priceGetter during drag)
      qoPreviewPricesRef.current = { sl: qo.slPrice, tps: [...qo.tpPrices] };

      // SL label — cancel removes SL from armed config + preview
      if (qo.slPrice != null) {
        const slDiff = qo.side === 0 ? qoEntryPrice - qo.slPrice : qo.slPrice - qoEntryPrice;
        const slPnl = (slDiff / tickSize) * tickValue * qo.orderSize;
        const slPnlText = `-$${Math.abs(slPnl).toFixed(2)}`;
        const cancelSl = () => {
          // Remove the SL price line from chart
          const slLine = qoPreviewLinesRef.current.sl;
          if (slLine && seriesRef.current) {
            seriesRef.current.removePriceLine(slLine);
            qoPreviewLinesRef.current.sl = null;
          }
          bracketEngine.updateArmedConfig((cfg) => ({
            ...cfg,
            stopLoss: { ...cfg.stopLoss, points: 0 },
          }));
          const cur = useStore.getState().qoPendingPreview;
          if (cur) useStore.getState().setQoPendingPreview({ ...cur, slPrice: null });
        };
        const qoSlSections = [
          { text: slPnlText, bg: '#ff0000', color: '#000' },
          { text: String(qo.orderSize), bg: '#ff0000', color: '#000' },
          { text: '\u2715', bg: '#e0e0e0', color: '#000', pointerEvents: true, onClick: cancelSl },
        ];
        const { root, firstCell, cells } = buildRow(qoSlSections);

        // Register cancel-X + row drag via hit-target system
        registerCellHitTargets(qoSlSections, cells);
        hitTargetsRef.current.push({
          el: root,
          priority: 2,
          handler: () => {
            previewDragStateRef.current = { role: { kind: 'qo-sl' }, lineIdx: -1 };
            activeDragRowRef.current = root;
            root.style.cursor = 'grabbing';
            if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
            if (chartRef.current) chartRef.current.applyOptions({ handleScroll: false, handleScale: false });
          },
        });

        const qoSlPnlCompute = () => {
          const sp = qoPreviewPricesRef.current.sl;
          if (sp == null) return null;
          const diff = qo.side === 0 ? qoEntryPrice - sp : sp - qoEntryPrice;
          const pnl = (diff / tickSize) * tickValue * qo.orderSize;
          return { text: `-$${Math.abs(pnl).toFixed(2)}`, bg: '#ff0000' };
        };

        overlayEls.push({
          root,
          priceGetter: () => qoPreviewPricesRef.current.sl!,
          pnlCell: firstCell,

          pnlCompute: qoSlPnlCompute,
        });
      }

      // TP labels — each cancel removes that specific TP
      for (let ti = 0; ti < qo.tpPrices.length; ti++) {
        const tpPrice = qo.tpPrices[ti];
        const tpSize = qo.tpSizes[ti] ?? qo.orderSize;
        const tpDiff = qo.side === 0 ? tpPrice - qoEntryPrice : qoEntryPrice - tpPrice;
        const tpPnl = (tpDiff / tickSize) * tickValue * tpSize;
        const tpPnlText = `+$${Math.abs(tpPnl).toFixed(2)}`;
        const tpIdx = ti;
        const cancelTp = () => {
          // Remove the TP price line from chart
          const tpLine = qoPreviewLinesRef.current.tps[tpIdx];
          if (tpLine && seriesRef.current) {
            seriesRef.current.removePriceLine(tpLine);
            qoPreviewLinesRef.current.tps[tpIdx] = null;
          }
          bracketEngine.updateArmedConfig((cfg) => ({
            ...cfg,
            takeProfits: cfg.takeProfits.filter((_, i) => i !== tpIdx),
          }));
          const cur = useStore.getState().qoPendingPreview;
          if (cur) {
            // Remove from both arrays and compact the ref tps array
            const newTpPrices = cur.tpPrices.filter((_, i) => i !== tpIdx);
            const newTpSizes = cur.tpSizes.filter((_, i) => i !== tpIdx);
            qoPreviewLinesRef.current.tps = qoPreviewLinesRef.current.tps.filter((_, i) => i !== tpIdx);
            useStore.getState().setQoPendingPreview({
              ...cur,
              tpPrices: newTpPrices,
              tpSizes: newTpSizes,
            });
          }
        };
        const qoTpSections = [
          { text: tpPnlText, bg: '#00c805', color: '#000' },
          { text: String(tpSize), bg: '#00c805', color: '#000' },
          { text: '\u2715', bg: '#e0e0e0', color: '#000', pointerEvents: true, onClick: cancelTp },
        ];
        const { root, firstCell, cells } = buildRow(qoTpSections);

        // Register cancel-X + row drag via hit-target system
        registerCellHitTargets(qoTpSections, cells);
        const qoTpIdx = ti;
        hitTargetsRef.current.push({
          el: root,
          priority: 2,
          handler: () => {
            previewDragStateRef.current = { role: { kind: 'qo-tp', index: qoTpIdx }, lineIdx: -1 };
            activeDragRowRef.current = root;
            root.style.cursor = 'grabbing';
            if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
            if (chartRef.current) chartRef.current.applyOptions({ handleScroll: false, handleScale: false });
          },
        });

        const capturedTpIdx = ti;
        const capturedTpSize = tpSize;
        const qoTpPnlCompute = () => {
          const tp = qoPreviewPricesRef.current.tps[capturedTpIdx];
          if (tp == null) return null;
          const diff = qo.side === 0 ? tp - qoEntryPrice : qoEntryPrice - tp;
          const pnl = (diff / tickSize) * tickValue * capturedTpSize;
          return { text: `+$${Math.abs(pnl).toFixed(2)}`, bg: '#00c805', color: '#000' };
        };

        overlayEls.push({
          root,
          priceGetter: () => qoPreviewPricesRef.current.tps[capturedTpIdx] ?? tpPrice,
          pnlCell: firstCell,

          pnlCompute: qoTpPnlCompute,
        });
      }
    }

    // Position + P&L update function (called on scroll, zoom, resize, drag, price tick)
    function updatePositions() {
      const s = seriesRef.current;
      for (const el of overlayEls) {
        // Update Y position (needs series)
        if (s) {
          const p = el.priceGetter();
          const y = s.priceToCoordinate(p);
          if (y === null) {
            el.root.style.display = 'none';
          } else {
            el.root.style.display = 'flex';
            el.root.style.top = `${y}px`;
          }
        }
        // Always update P&L text + color (regardless of series availability)
        if (el.pnlCell && el.pnlCompute) {
          const result = el.pnlCompute();
          if (result) {
            el.pnlCell.textContent = result.text;
            el.pnlCell.style.background = result.bg;
            if (result.color) el.pnlCell.style.color = result.color;
          }
        }
      }
    }

    updatePositions();
    updateOverlayRef.current = updatePositions;

    // Subscribe to lastPrice changes directly (bypasses React render cycle → no DOM rebuild flicker)
    let prevLp = useStore.getState().lastPrice;
    const unsub = useStore.subscribe((state) => {
      if (state.lastPrice !== prevLp) {
        prevLp = state.lastPrice;
        updatePositions();
      }
    });

    return () => {
      unsub();
      overlay.innerHTML = '';
      hitTargetsRef.current = [];
      updateOverlayRef.current = () => {};
    };
  }, [isOrderChart, openOrders, positions, contract, activeAccountId, previewEnabled, previewSide, previewHideEntry,
    bracketPresets, activePresetId, orderType, limitPrice, orderSize,
    draftSlPoints, draftTpPoints, adHocSlPoints, adHocTpLevels, qoPendingPreview]);

  // -- Sync overlay positions on chart scroll/zoom/resize/price-scale-drag --
  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;

    const handler = () => updateOverlayRef.current();

    // Horizontal time-scale changes
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);

    // Container resize
    const ro = new ResizeObserver(handler);
    ro.observe(container);

    // rAF loop during any pointer interaction (covers vertical pan + price scale stretch)
    let rafId = 0;
    function rafLoop() {
      handler();
      rafId = requestAnimationFrame(rafLoop);
    }
    function onPointerDown() {
      cancelAnimationFrame(rafId);
      rafLoop();
    }
    function onPointerUp() {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    // Wheel zoom (vertical or horizontal)
    container.addEventListener('wheel', handler, { passive: true });

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
      ro.disconnect();
      cancelAnimationFrame(rafId);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('wheel', handler);
    };
  }, []);

  // -- Show/hide "scroll to latest" button when user scrolls away from latest candle --
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handler = () => {
      const visibleRange = chart.timeScale().getVisibleRange();
      const lastTime = lastBarRef.current?.time;
      if (!visibleRange || !lastTime) {
        if (scrollBtnShownRef.current) {
          scrollBtnShownRef.current = false;
          setShowScrollBtn(false);
        }
        return;
      }
      const shouldShow = (lastTime as number) > (visibleRange.to as number);
      if (shouldShow !== scrollBtnShownRef.current) {
        scrollBtnShownRef.current = shouldShow;
        setShowScrollBtn(shouldShow);
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
    };
  }, []);

  // -- Position scroll-to-latest button equidistant from price scale left border
  //    and time scale top border (sits just inside the candle area corner) --
  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;

    const TS_HEIGHT = 26; // LWC time scale height at fontSize 12
    const GAP = 30;       // equal distance from both border lines to button edge

    const recompute = () => {
      const tsW = chart.timeScale().width();
      if (tsW <= 0) return;
      const P = container.clientWidth - tsW; // price scale width
      const r = P + GAP;
      const b = TS_HEIGHT + GAP;
      setScrollBtnPos(prev =>
        prev.right === r && prev.bottom === b ? prev : { right: r, bottom: b },
      );
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    chart.timeScale().subscribeVisibleLogicalRangeChange(recompute);

    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(recompute);
    };
  }, []);

  return (
    <div className="flex-1 relative min-h-0 min-w-0 overflow-hidden">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#131722]/80">
          <span className="text-xs text-[#787b86]">Loading bars...</span>
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <span className="text-xs text-red-400">{error}</span>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
      {contract && (
        <div className="absolute top-2 left-2 z-10 pointer-events-none select-none flex items-center gap-2" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif", maxWidth: 'calc(100% - 90px)' }}>
          <div ref={instrumentLabelRef} className="text-[#787b86] text-xs font-medium leading-tight whitespace-nowrap shrink-0" style={{ background: '#00000080', borderRadius: 2, padding: '1px 3px' }}>
            {contract.name.replace(/[FGHJKMNQUVXZ]\d{2}$/, '')} · {timeframe.label}
          </div>
          <div
            ref={ohlcRef}
            className="text-xs font-medium leading-tight overflow-hidden whitespace-nowrap min-w-0"
            style={{ background: '#00000080', borderRadius: 2, padding: '1px 3px' }}
          />
        </div>
      )}
      <div
        ref={overlayRef}
        className="absolute inset-0 z-20 pointer-events-none overflow-hidden"
      />
      {isOrderChart && (
        <div
          ref={quickOrderRef}
          className="absolute z-30 pointer-events-none"
          style={{ display: 'none', transform: 'translateY(-50%)' }}
        >
          <div data-qo-wrap style={{ display: 'flex', alignItems: 'center', pointerEvents: 'auto', cursor: 'pointer' }}>
            <div
              data-qo-label
              style={{
                display: 'none',
                fontSize: 11,
                fontWeight: 'bold',
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
                padding: '0 6px',
                height: 20,
                lineHeight: '20px',
                whiteSpace: 'nowrap',
                borderRadius: '2px 0 0 2px',
              }}
            />
            <div
              data-qo-plus
              style={{
                width: 20,
                height: 20,
                background: '#2a2e39',
                borderRadius: '2px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ color: '#d1d4dc', fontSize: 14, fontWeight: 'bold' }}>+</span>
            </div>
          </div>
        </div>
      )}
      {/* Scroll-to-latest button — appears when user has scrolled away from latest candle */}
      <button
        onClick={() => {
          const chart = chartRef.current;
          if (!chart) return;
          const range = chart.timeScale().getVisibleLogicalRange();
          if (range) {
            const barsVisible = range.to - range.from;
            chart.timeScale().scrollToPosition(Math.round(barsVisible * 0.25), true);
          }
        }}
        style={{
          position: 'absolute',
          bottom: scrollBtnPos.bottom,
          right: scrollBtnPos.right,
          zIndex: 30,
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#2a2e39',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          opacity: showScrollBtn ? 0.85 : 0,
          pointerEvents: showScrollBtn ? 'auto' as const : 'none' as const,
          transition: 'opacity 0.2s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { if (showScrollBtn) e.currentTarget.style.opacity = '0.85'; }}
        title="Scroll to latest candle"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 2l5 5-5 5" stroke="#d1d4dc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="11" y1="2" x2="11" y2="12" stroke="#d1d4dc" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>
      <DrawingEditToolbar contractId={contract ? String(contract.id) : undefined} />
    </div>
  );
}));
