// ---------------------------------------------------------------------------
// Drawing tool identifiers
// ---------------------------------------------------------------------------
export type DrawingTool = 'select' | 'hline' | 'rect' | 'oval' | 'arrowpath' | 'ruler' | 'freedraw' | 'frvp';

// ---------------------------------------------------------------------------
// Text configuration for drawings
// ---------------------------------------------------------------------------
export type TextHAlign = 'left' | 'center' | 'right';
export type TextVAlign = 'top' | 'middle' | 'bottom';

export interface DrawingText {
  content: string;
  color: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  hAlign: TextHAlign;
  vAlign: TextVAlign;
}

export const FONT_SIZE_OPTIONS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32] as const;

// ---------------------------------------------------------------------------
// Line style
// ---------------------------------------------------------------------------
export type LineStyle = 'solid' | 'dashed' | 'dotted';
export const LINE_STYLE_OPTIONS: LineStyle[] = ['solid', 'dashed', 'dotted'];

// ---------------------------------------------------------------------------
// Base drawing properties (shared)
// ---------------------------------------------------------------------------
interface DrawingBase {
  id: string;
  color: string;          // hex
  strokeWidth: number;    // 1-4
  lineStyle: LineStyle;   // solid | dashed | dotted
  text: DrawingText | null;
  contractId: string;     // scope drawings per instrument
}

// ---------------------------------------------------------------------------
// Horizontal Line drawing
// ---------------------------------------------------------------------------
export interface HLineDrawing extends DrawingBase {
  type: 'hline';
  price: number;
  startTime: number;      // timestamp where the line was placed
  extendLeft: boolean;    // true = full width, false = starts at startTime going right
}

// ---------------------------------------------------------------------------
// Anchored point (sub-bar precision via anchorTime + barOffset)
// ---------------------------------------------------------------------------
export interface AnchoredPoint {
  time: number;           // snapped bar time (backward compat + undo serialization)
  price: number;
  anchorTime?: number;    // nearest bar time (reference for offset calc)
  barOffset?: number;     // fractional bar offset from anchorTime
}

// ---------------------------------------------------------------------------
// Rectangle drawing
// ---------------------------------------------------------------------------
export interface RectDrawing extends DrawingBase {
  type: 'rect';
  p1: AnchoredPoint;     // diagonal corner 1
  p2: AnchoredPoint;     // diagonal corner 2
  fillColor: string;     // fill color (supports alpha, e.g. rgba)
}

// ---------------------------------------------------------------------------
// Oval drawing
// ---------------------------------------------------------------------------
export interface OvalDrawing extends DrawingBase {
  type: 'oval';
  p1: AnchoredPoint;     // bounding rect corner 1
  p2: AnchoredPoint;     // bounding rect corner 2
  fillColor: string;     // fill color (supports alpha, e.g. rgba)
}

// ---------------------------------------------------------------------------
// Arrow Path drawing (multi-segment polyline with arrowhead)
// ---------------------------------------------------------------------------
export interface ArrowPathDrawing extends DrawingBase {
  type: 'arrowpath';
  anchorTime: number;  // time of nearest bar to first point (for pan positioning)
  points: { barOffset: number; price: number }[];  // barOffset = fractional bars from anchor
}

// ---------------------------------------------------------------------------
// Ruler drawing (measurement tool)
// ---------------------------------------------------------------------------
export interface RulerMetrics {
  priceChange: number;      // absolute: p2.price - p1.price
  pctChange: number;        // percentage: (priceChange / p1.price) * 100
  barCount: number;         // candle bars within the time range
  timeSpan: string;         // human-readable duration e.g. "2h 15m"
  timeSpanMs: number;       // raw duration in milliseconds
  volumeSum: number;        // sum of volume across bars in range
}

export interface RulerDrawing extends DrawingBase {
  type: 'ruler';
  p1: { time: number; price: number };
  p2: { time: number; price: number };
  metrics: RulerMetrics;
}

// ---------------------------------------------------------------------------
// Free Draw drawing (freehand brush strokes)
// ---------------------------------------------------------------------------
export interface FreeDrawDrawing extends DrawingBase {
  type: 'freedraw';
  anchorTime: number;  // time of nearest bar to first point (used for pan positioning)
  points: { barOffset: number; price: number }[];  // barOffset = fractional bars from anchor (continuous)
}

// ---------------------------------------------------------------------------
// Marker drawing (arrow + pill label at a specific time/price)
// ---------------------------------------------------------------------------
export interface MarkerDrawing extends DrawingBase {
  type: 'marker';
  time: number;             // bar timestamp (unix seconds)
  price: number;            // price level the arrow points to
  label: string;            // text inside the pill (e.g. "Entry  1 @ 21300.00")
  placement: 'above' | 'below'; // arrow direction relative to anchor
}

// ---------------------------------------------------------------------------
// Fixed Range Volume Profile drawing
// ---------------------------------------------------------------------------
export interface FRVPDrawing extends DrawingBase {
  type: 'frvp';
  mode?: 'anchor' | 'range';  // 'anchor' = single time point + manual price range (default); 'range' = two time points + auto price range from candles
  anchorTime: number;  // t1: time of left anchor line (both modes)
  t2?: number;         // range mode only: right time boundary
  t2Auto?: boolean;    // range mode only: when true, t2 tracks the latest bar automatically
  pMin: number;        // lower price bound (manual in anchor mode; auto-computed in range mode)
  pMax: number;        // upper price bound (manual in anchor mode; auto-computed in range mode)
  numBars?: number;        // bucket count for aggregation; undefined/0 = raw tick-level (used when rowSizeMode === 'count')
  rowSizeMode?: 'count' | 'price'; // 'count' (default) = numBars buckets; 'price' = fixed price range per row
  rowSizePrice?: number;   // price range per row when rowSizeMode === 'price' (e.g. 1.0 = 1 point)
  rowTickSize?: number;    // user-defined tick size used as step for rowSizePrice spinner
  showPoc?: boolean;       // show POC line; undefined/true = visible
  pocColor?: string;       // POC line color; undefined = COLOR_ACCENT
  extendPoc?: boolean;     // extend POC line to right edge; undefined/false = bar width only
  showBarValues?: boolean; // show volume label on hover; undefined/false = hidden
  highlightOnHover?: boolean; // highlight bar on crosshair hover; undefined/true = enabled
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------
export type Drawing = HLineDrawing | RectDrawing | OvalDrawing | ArrowPathDrawing | RulerDrawing | FreeDrawDrawing | MarkerDrawing | FRVPDrawing;

// ---------------------------------------------------------------------------
// Horizontal line template (saved style presets)
// ---------------------------------------------------------------------------
export interface HLineTemplate {
  id: string;
  name: string;
  color: string;
  strokeWidth: number;
  lineStyle?: LineStyle;
  text: DrawingText | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
import { COLOR_TEXT_MUTED, COLOR_ACCENT } from '../constants/colors';

export const DEFAULT_HLINE_COLOR = COLOR_TEXT_MUTED;
export const DEFAULT_OVAL_COLOR = '#ff9800';
export const DEFAULT_OVAL_FILL = 'rgba(255, 152, 0, 0.15)';
export const DEFAULT_ARROWPATH_COLOR = '#f7c948';
export const DEFAULT_RULER_COLOR = COLOR_ACCENT;
export const DEFAULT_RECT_COLOR = '#ff9800';
export const DEFAULT_RECT_FILL = 'rgba(255, 152, 0, 0.15)';
export const DEFAULT_FREEDRAW_COLOR = '#ffffff';
export const DEFAULT_FRVP_COLOR = COLOR_ACCENT;
export const STROKE_WIDTH_OPTIONS = [1, 2, 3, 4] as const;
