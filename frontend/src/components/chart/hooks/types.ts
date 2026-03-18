import type { IChartApi, ISeriesApi, CandlestickData, UTCTimestamp } from 'lightweight-charts';
import type { Bar } from '../../../services/marketDataService';
import type { Order } from '../../../services/orderService';
import type { DrawingsPrimitive } from '../drawings/DrawingsPrimitive';
import type { CountdownPrimitive } from '../CountdownPrimitive';
import type { CrosshairLabelPrimitive } from '../CrosshairLabelPrimitive';
import type { TradeZonePrimitive } from '../TradeZonePrimitive';
import type { VolumeProfilePrimitive } from '../VolumeProfilePrimitive';
import type { NewsEventsPrimitive } from '../primitives/NewsEventsPrimitive';
import type { PriceLevelLine } from '../PriceLevelLine';

// ── Preview line role (entry, SL, TP, or quick-order variants) ──
export type PreviewLineRole =
  | { kind: 'entry' }
  | { kind: 'sl' }
  | { kind: 'tp'; index: number }
  | { kind: 'qo-sl' }
  | { kind: 'qo-tp'; index: number };

// ── Order line metadata ──
export type OrderLineMeta = { kind: 'position' } | { kind: 'order'; order: Order };

// ── Hit-target for overlay label interactions ──
export type HitTarget = {
  el: HTMLDivElement;
  priority: number; // 0=buttons, 1=entry-click, 2=row-drag
  handler: (e: MouseEvent) => void;
};

// ── Quick-order preview line refs shape ──
export type QoPreviewLines = {
  sl: PriceLevelLine | null;
  tps: (PriceLevelLine | null)[];
};

// ── Position drag state ──
export type PosDragState = {
  isLong: boolean;
  posSize: number;
  avgPrice: number;
  direction: 'sl' | 'tp' | null;
  snappedPrice: number;
};

// ── Order drag state ──
export type OrderDragState = {
  meta: OrderLineMeta;
  idx: number;
  originalPrice: number;
  draggedPrice: number;
};

// ── All shared refs, declared once in the orchestrator ──
export interface ChartRefs {
  // Core chart
  container: React.RefObject<HTMLDivElement | null>;
  overlay: React.RefObject<HTMLDivElement | null>;
  chart: React.MutableRefObject<IChartApi | null>;
  series: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;

  // Data
  lastBar: React.MutableRefObject<CandlestickData<UTCTimestamp> | null>;
  dataMap: React.MutableRefObject<Map<number, number>>;
  bars: React.MutableRefObject<Bar[]>;

  // Primitives
  drawingsPrimitive: React.MutableRefObject<DrawingsPrimitive | null>;
  countdown: React.MutableRefObject<CountdownPrimitive | null>;
  crosshairLabel: React.MutableRefObject<CrosshairLabelPrimitive | null>;
  whitespaceSeries: React.MutableRefObject<ISeriesApi<'Line'> | null>;
  tradeZonePrimitive: React.MutableRefObject<TradeZonePrimitive | null>;
  vpPrimitive: React.MutableRefObject<VolumeProfilePrimitive | null>;
  newsEventsPrimitive: React.MutableRefObject<NewsEventsPrimitive | null>;

  // DOM elements
  ohlc: React.RefObject<HTMLDivElement | null>;
  instrumentLabel: React.RefObject<HTMLDivElement | null>;
  quickOrder: React.RefObject<HTMLDivElement | null>;

  // Shared flags
  qoHovered: React.MutableRefObject<boolean>;
  labelHovered: React.MutableRefObject<boolean>;
  lastPnlCache: React.MutableRefObject<{ text: string; bg: string }>;

  // Hit-target registry (shared between drawings + overlay labels)
  hitTargets: React.MutableRefObject<HitTarget[]>;
  entryClick: React.MutableRefObject<{ downX: number; downY: number; exec: () => void } | null>;
  updateOverlay: React.MutableRefObject<() => void>;
  scheduleOverlaySync: React.MutableRefObject<() => void>;
  activeDragRow: React.MutableRefObject<HTMLDivElement | null>;

  // Preview lines
  previewLines: React.MutableRefObject<PriceLevelLine[]>;
  previewRoles: React.MutableRefObject<PreviewLineRole[]>;
  previewPrices: React.MutableRefObject<number[]>;
  previewDragState: React.MutableRefObject<{ role: PreviewLineRole; lineIdx: number } | null>;

  // Order lines
  orderLines: React.MutableRefObject<PriceLevelLine[]>;
  orderLineMeta: React.MutableRefObject<OrderLineMeta[]>;
  orderLinePrices: React.MutableRefObject<number[]>;
  orderDragState: React.MutableRefObject<OrderDragState | null>;

  // Quick-order preview
  qoPreviewLines: React.MutableRefObject<QoPreviewLines>;
  qoPreviewPrices: React.MutableRefObject<{ entry: number; sl: number | null; tps: number[] }>;

  // Position drag-to-create SL/TP
  posDrag: React.MutableRefObject<PosDragState | null>;
  posDragLine: React.MutableRefObject<PriceLevelLine | null>;
  posDragLabel: React.MutableRefObject<HTMLDivElement | null>;

  // TP size +/- redistribution
  hoveredTpOrderId: React.MutableRefObject<string | null>;
  tpRedistInFlight: React.MutableRefObject<boolean>;

  // Scroll button
  scrollBtnShown: React.MutableRefObject<boolean>;

  // Peer-chart crosshair sync (set by ChartArea in dual-chart mode)
  peerSync: React.MutableRefObject<((price: number, time: unknown) => void) | null>;
}
