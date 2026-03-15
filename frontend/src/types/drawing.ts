// ---------------------------------------------------------------------------
// Drawing tool identifiers
// ---------------------------------------------------------------------------
export type DrawingTool = 'select' | 'hline' | 'oval' | 'arrowpath' | 'ruler' | 'freedraw';

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
// Base drawing properties (shared)
// ---------------------------------------------------------------------------
interface DrawingBase {
  id: string;
  color: string;          // hex
  strokeWidth: number;    // 1-4
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
// Oval drawing
// ---------------------------------------------------------------------------
export interface OvalDrawing extends DrawingBase {
  type: 'oval';
  p1: { time: number; price: number };  // bounding rect corner 1
  p2: { time: number; price: number };  // bounding rect corner 2
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
// Union type
// ---------------------------------------------------------------------------
export type Drawing = HLineDrawing | OvalDrawing | ArrowPathDrawing | RulerDrawing | FreeDrawDrawing;

// ---------------------------------------------------------------------------
// Horizontal line template (saved style presets)
// ---------------------------------------------------------------------------
export interface HLineTemplate {
  id: string;
  name: string;
  color: string;
  strokeWidth: number;
  text: DrawingText | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
import { COLOR_TEXT_MUTED, COLOR_ACCENT } from '../constants/colors';

export const DEFAULT_HLINE_COLOR = COLOR_TEXT_MUTED;
export const DEFAULT_OVAL_COLOR = '#ff9800';
export const DEFAULT_ARROWPATH_COLOR = '#f7c948';
export const DEFAULT_RULER_COLOR = COLOR_ACCENT;
export const DEFAULT_FREEDRAW_COLOR = '#ffffff';
export const STROKE_WIDTH_OPTIONS = [1, 2, 3, 4] as const;
