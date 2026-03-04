import { memo, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, CandlestickData, UTCTimestamp } from 'lightweight-charts';
import type { Contract, Bar } from '../../services/marketDataService';
import type { Timeframe } from '../../store/useStore';
import { useStore } from '../../store/useStore';
import { CHART_OPTIONS, CANDLESTICK_OPTIONS } from './chartTheme';
import { DrawingEditToolbar } from './DrawingEditToolbar';
import { DrawingsPrimitive } from './drawings/DrawingsPrimitive';
import { CountdownPrimitive } from './CountdownPrimitive';
import { CrosshairLabelPrimitive } from './CrosshairLabelPrimitive';
import { registerChart, unregisterChart } from './screenshot/chartRegistry';
import { TradeZonePrimitive } from './TradeZonePrimitive';
import { VolumeProfilePrimitive } from './VolumeProfilePrimitive';
import type { PriceLevelLine } from './PriceLevelLine';
import { useChartWidgets } from './hooks/useChartWidgets';
import { useChartBars } from './hooks/useChartBars';
import { useChartDrawings } from './hooks/useChartDrawings';
import { useQuickOrder } from './hooks/useQuickOrder';
import { useOrderLines } from './hooks/useOrderLines';
import { useOverlayLabels } from './hooks/useOverlayLabels';
import type { ChartRefs, HitTarget, PreviewLineRole, OrderLineMeta, OrderDragState, QoPreviewLines, PosDragState } from './hooks/types';

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
  /** Directly update the HTML crosshair price label (for dual-chart sync). */
  setCrosshairPrice: (price: number | null) => void;
  /** Set a callback that syncs crosshair to the peer chart (for dual-chart QO drag). */
  setPeerSync: (fn: ((price: number, time: unknown) => void) | null) => void;
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
  const labelHoveredRef = useRef(false);

  // --- Refs declared here for all hooks (stable across renders) ---

  // Quick-order preview line refs
  const qoPreviewLinesRef = useRef<QoPreviewLines>({ sl: null, tps: [] });
  const qoPreviewPricesRef = useRef<{ entry: number; sl: number | null; tps: number[] }>({ entry: 0, sl: null, tps: [] });

  // Preview line refs
  const previewLinesRef = useRef<PriceLevelLine[]>([]);
  const previewRolesRef = useRef<PreviewLineRole[]>([]);
  const previewPricesRef = useRef<number[]>([]);
  const previewDragStateRef = useRef<{ role: PreviewLineRole; lineIdx: number } | null>(null);

  // Order line refs
  const orderLinesRef = useRef<PriceLevelLine[]>([]);
  const orderLineMetaRef = useRef<OrderLineMeta[]>([]);
  const orderLinePricesRef = useRef<number[]>([]);
  const orderDragStateRef = useRef<OrderDragState | null>(null);
  const activeDragRowRef = useRef<HTMLDivElement | null>(null);

  // Hit-target registry (shared between drawings + overlay labels)
  const hitTargetsRef = useRef<HitTarget[]>([]);
  const entryClickRef = useRef<{ downX: number; downY: number; exec: () => void } | null>(null);

  // Position drag-to-create SL/TP refs
  const posDragRef = useRef<PosDragState | null>(null);
  const posDragLineRef = useRef<PriceLevelLine | null>(null);
  const posDragLabelRef = useRef<HTMLDivElement | null>(null);

  // Overlay label system
  const updateOverlayRef = useRef<() => void>(() => {});

  // TP size +/- redistribution
  const hoveredTpOrderIdRef = useRef<number | null>(null);
  const tpRedistInFlightRef = useRef(false);

  // Scroll button
  const scrollBtnShownRef = useRef(false);

  // Peer-chart crosshair sync (populated by ChartArea in dual-chart mode)
  const peerSyncRef = useRef<((price: number, time: unknown) => void) | null>(null);

  // --- ChartRefs bag (passed to all hooks) ---
  const refs: ChartRefs = {
    container: containerRef,
    overlay: overlayRef,
    chart: chartRef,
    series: seriesRef,
    lastBar: lastBarRef,
    dataMap: dataMapRef,
    bars: barsRef,
    drawingsPrimitive: drawingsPrimitiveRef,
    countdown: countdownRef,
    crosshairLabel: crosshairLabelRef,
    whitespaceSeries: whitespaceSeriesRef,
    tradeZonePrimitive: tradeZonePrimitiveRef,
    vpPrimitive: vpPrimitiveRef,
    ohlc: ohlcRef,
    instrumentLabel: instrumentLabelRef,
    quickOrder: quickOrderRef,
    qoHovered: qoHoveredRef,
    labelHovered: labelHoveredRef,
    lastPnlCache,
    hitTargets: hitTargetsRef,
    entryClick: entryClickRef,
    updateOverlay: updateOverlayRef,
    activeDragRow: activeDragRowRef,
    previewLines: previewLinesRef,
    previewRoles: previewRolesRef,
    previewPrices: previewPricesRef,
    previewDragState: previewDragStateRef,
    orderLines: orderLinesRef,
    orderLineMeta: orderLineMetaRef,
    orderLinePrices: orderLinePricesRef,
    orderDragState: orderDragStateRef,
    qoPreviewLines: qoPreviewLinesRef,
    qoPreviewPrices: qoPreviewPricesRef,
    posDrag: posDragRef,
    posDragLine: posDragLineRef,
    posDragLabel: posDragLabelRef,
    hoveredTpOrderId: hoveredTpOrderIdRef,
    tpRedistInFlight: tpRedistInFlightRef,
    scrollBtnShown: scrollBtnShownRef,
    peerSync: peerSyncRef,
  };

  useImperativeHandle(ref, () => ({
    getChartApi: () => chartRef.current,
    getSeriesApi: () => seriesRef.current,
    getDataMap: () => dataMapRef.current,
    isQoHovered: () => qoHoveredRef.current,
    setCrosshairPrice: (price: number | null) => crosshairLabelRef.current?.updateCrosshairPrice(price),
    setPeerSync: (fn: ((price: number, time: unknown) => void) | null) => { peerSyncRef.current = fn; },
  }));

  // loading/error come from useChartBars below

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

    // Create crosshair label as HTML in overlay — z-index:30 above PriceLevelLine axis labels
    const crosshairLabel = new CrosshairLabelPrimitive(overlayRef.current!, series, chart);
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
      overlayEl: overlayRef.current,
      tradeZonePrimitive,
      instrumentEl: instrumentLabelRef.current,
      ohlcEl: ohlcRef.current,
      orderLinesRef,
      orderLineMetaRef,
      previewLinesRef,
    });

    return () => {
      unregisterChart(chartId);
      crosshairLabel.destroy();
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

  // -- Widgets: trade zones, OHLC tooltip, crosshair label, scroll button --
  const { showScrollBtn, scrollBtnPos } = useChartWidgets(refs, contract, timeframe);
  const { loading, error } = useChartBars(refs, chartId, contract, timeframe);

  useChartDrawings(refs, contract);

  // -- Order panel contract (overlays show on whichever chart matches) --
  const orderContract = useStore((s) => s.orderContract);
  const isOrderChart = contract?.id != null && contract.id === orderContract?.id;

  useQuickOrder(refs, contract, timeframe, isOrderChart);
  useOrderLines(refs, contract, isOrderChart);
  useOverlayLabels(refs, contract, isOrderChart);

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
