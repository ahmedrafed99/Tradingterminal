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
    startAnchorTime?: number; startBarOffset?: number;
    tool: 'oval';
  } | null;

  rulerCreation: {
    startX: number; startY: number;
    startTime: number; startPrice: number;
  } | null;
  rulerDisplayActive: boolean;
  shiftRulerConsumed: boolean;

  ovalResize: {
    drawingId: string;
    handle: string;
    fixedCorner: { time: number; price: number; anchorTime?: number; barOffset?: number };
    origP1: { time: number; price: number; anchorTime?: number; barOffset?: number };
    origP2: { time: number; price: number; anchorTime?: number; barOffset?: number };
  } | null;

  drawingDrag: {
    drawingId: string;
    type: 'hline' | 'rect' | 'oval' | 'arrowpath' | 'ruler' | 'freedraw';
    startX: number;
    startY: number;
    origPrice: number;
    origP1: { time: number; price: number; anchorTime?: number; barOffset?: number };
    origP2: { time: number; price: number; anchorTime?: number; barOffset?: number };
    origAnchorTime?: number;
    origBarOffsets?: { barOffset: number; price: number }[];
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

  rectCreation: {
    startX: number; startY: number;
    startTime: number; startPrice: number;
    startAnchorTime?: number; startBarOffset?: number;
  } | null;

  freeDrawCreation: {
    anchorTime: number;         // time of nearest bar to first point
    anchorPixelX: number;       // pixel x of anchor at creation time
    barSpacing: number;         // bar spacing at creation time
    points: { barOffset: number; price: number }[];
    cssPoints: { x: number; y: number }[];
  } | null;

  ctrlDragSelect: {
    startX: number;
    startY: number;
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
    shiftRulerConsumed: false,
    ovalResize: null,
    drawingDrag: null,
    drawingDragOccurred: false,
    arrowPathCreation: null,
    arrowPathNodeDrag: null,
    rectCreation: null,
    freeDrawCreation: null,
    ctrlDragSelect: null,
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

/** Convert an AnchoredPoint to CSS pixel X coordinate (sub-bar precision when available). */
export function pointToPixelX(
  point: { time: number; anchorTime?: number; barOffset?: number },
  chart: IChartApi,
): number | null {
  if (point.anchorTime !== undefined && point.barOffset !== undefined) {
    const anchorX = chart.timeScale().timeToCoordinate(point.anchorTime as unknown as Time);
    if (anchorX === null) return null;
    const barSpacing = (chart.timeScale().options() as { barSpacing: number }).barSpacing;
    return anchorX + point.barOffset * barSpacing;
  }
  return chart.timeScale().timeToCoordinate(point.time as unknown as Time);
}

/** Build an AnchoredPoint from pixel coordinates (sub-bar precision). */
export function pixelToAnchoredPoint(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  x: number,
  y: number,
): { time: number; price: number; anchorTime: number; barOffset: number } | null {
  const price = series.coordinateToPrice(y);
  const snappedTime = chart.timeScale().coordinateToTime(x);
  if (price === null || snappedTime === null) return null;
  const anchorTime = snappedTime as number;
  const anchorX = chart.timeScale().timeToCoordinate(snappedTime) ?? x;
  const barSpacing = (chart.timeScale().options() as { barSpacing: number }).barSpacing;
  const barOffset = (x - anchorX) / barSpacing;
  return { time: anchorTime, price: price as number, anchorTime, barOffset };
}

/** Re-enable chart scroll/scale and reset cursor to crosshair. */
export function resetChartInteraction(ctx: DrawingContext): void {
  ctx.container.style.cursor = CROSSHAIR_CURSOR;
  ctx.chart.applyOptions({ handleScroll: true, handleScale: true });
}
