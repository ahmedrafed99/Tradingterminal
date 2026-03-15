import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { DrawingsPrimitive } from '../drawings/DrawingsPrimitive';
import type { ChartRefs } from './types';

// ── Custom white crosshair cursor (24×24 SVG, hotspot at center) ──
export const CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cline x1='12' y1='0' x2='12' y2='24' stroke='%23ffffff' stroke-width='2'/%3E%3Cline x1='0' y1='12' x2='24' y2='12' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`;

// ── Mutable interaction state shared across all drawing handlers ──
export interface DrawingState {
  ovalDrag: {
    startX: number; startY: number;
    startTime: number; startPrice: number;
    tool: 'oval';
  } | null;

  rulerCreation: {
    startX: number; startY: number;
    startTime: number; startPrice: number;
  } | null;
  rulerDisplayActive: boolean;

  ovalResize: {
    drawingId: string;
    handle: string;
    leftTime: number;
    rightTime: number;
    topPrice: number;
    bottomPrice: number;
    origP1: { time: number; price: number };
    origP2: { time: number; price: number };
  } | null;

  drawingDrag: {
    drawingId: string;
    type: 'hline' | 'oval' | 'arrowpath' | 'ruler' | 'freedraw';
    startX: number;
    startY: number;
    origPrice: number;
    origP1: { time: number; price: number };
    origP2: { time: number; price: number };
    origPoints?: { time: number; price: number }[];
    startTime: number;
    startPrice: number;
    origStartTime: number;
  } | null;
  drawingDragOccurred: boolean;

  arrowPathCreation: {
    anchorTime: number;
    anchorPixelX: number;
    barSpacing: number;
    points: { barOffset: number; price: number }[];
    cssPoints: { x: number; y: number }[];
  } | null;

  arrowPathNodeDrag: {
    drawingId: string;
    nodeIndex: number;
    anchorTime: number;  // needed to compute barOffset for the dragged node
    origPoints: { barOffset: number; price: number }[];
  } | null;

  freeDrawCreation: {
    anchorTime: number;         // time of nearest bar to first point
    anchorPixelX: number;       // pixel x of anchor at creation time
    barSpacing: number;         // bar spacing at creation time
    points: { barOffset: number; price: number }[];
    cssPoints: { x: number; y: number }[];
  } | null;

  chartPanning: boolean;
  overlayHitCaptured: boolean;
}

/** Context object passed to all extracted handler functions. */
export interface DrawingContext {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  container: HTMLElement;
  primitive: DrawingsPrimitive;
  contract: import('../../../services/marketDataService').Contract | null;
  refs: ChartRefs;
  state: DrawingState;
}

export function createDrawingState(): DrawingState {
  return {
    ovalDrag: null,
    rulerCreation: null,
    rulerDisplayActive: false,
    ovalResize: null,
    drawingDrag: null,
    drawingDragOccurred: false,
    arrowPathCreation: null,
    arrowPathNodeDrag: null,
    freeDrawCreation: null,
    chartPanning: false,
    overlayHitCaptured: false,
  };
}

/** Get mouse position relative to container. */
export function getMousePos(e: MouseEvent, container: HTMLElement): { x: number; y: number } {
  const rect = container.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/** Convert pixel coords to data coords (time + price). Returns null if conversion fails. */
export function getDataPos(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  x: number,
  y: number,
): { time: number; price: number } | null {
  const time = chart.timeScale().coordinateToTime(x);
  const price = series.coordinateToPrice(y);
  if (time === null || price === null) return null;
  return { time: time as number, price: price as number };
}


/** Re-enable chart scroll/scale and reset cursor to crosshair. */
export function resetChartInteraction(ctx: DrawingContext): void {
  ctx.container.style.cursor = CROSSHAIR_CURSOR;
  ctx.chart.applyOptions({ handleScroll: true, handleScale: true });
}
