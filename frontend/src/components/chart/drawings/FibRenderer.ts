import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { FibDrawing, FibLevel } from '../../../types/drawing';
import {
  DEFAULT_FIB_LEVELS,
  DEFAULT_FIB_COLOR,
  DEFAULT_FIB_NEG_COLOR,
} from '../../../types/drawing';
import { COLOR_LABEL_TEXT, COLOR_HANDLE_STROKE } from '../../../constants/colors';
import { FONT_FAMILY } from '../../../constants/layout';
import { PRICE_SCALE_FONT_SIZE } from '../chartTheme';
import { applyLineDash } from './rendererUtils';

// ---------------------------------------------------------------------------
// Helper: convert AnchoredPoint to CSS pixel X (sub-bar precision)
// ---------------------------------------------------------------------------
function ptX(
  point: { time: number; anchorTime?: number; barOffset?: number },
  chart: IChartApiBase<Time>,
): number | null {
  if (point.anchorTime !== undefined && point.barOffset !== undefined) {
    const ax = chart.timeScale().timeToCoordinate(point.anchorTime as unknown as Time);
    if (ax === null) return null;
    const bs = (chart.timeScale().options() as { barSpacing: number }).barSpacing;
    return ax + point.barOffset * bs;
  }
  return chart.timeScale().timeToCoordinate(point.time as unknown as Time);
}

// ---------------------------------------------------------------------------
// Helper: resolve effective levels (merge stored overrides with defaults)
// ---------------------------------------------------------------------------
export function resolvedFibLevels(drawing: FibDrawing): FibLevel[] {
  if (!drawing.levels || drawing.levels.length === 0) return DEFAULT_FIB_LEVELS;
  // Use only the stored ratios — fill in default color for known ones but never
  // re-add a ratio the user removed or changed.
  return drawing.levels.map((l) => ({ ...l }));
}

// ---------------------------------------------------------------------------
// Helper: format ratio as label string (no % sign)
// ---------------------------------------------------------------------------
function formatRatioLabel(ratio: number): string {
  // Round to 3 decimal places to eliminate float artifacts, then strip trailing zeros
  const rounded = Math.round(ratio * 1000) / 1000;
  return rounded.toString();
}

// ---------------------------------------------------------------------------
// Helper: resolve color for a level
// ---------------------------------------------------------------------------
function resolveColor(level: FibLevel, drawing: FibDrawing): string {
  if (level.color) return level.color;
  if (level.ratio < 0) return drawing.negativeMasterColor ?? DEFAULT_FIB_NEG_COLOR;
  return drawing.color ?? DEFAULT_FIB_COLOR;
}

// ---------------------------------------------------------------------------
// FibRendererImpl — main canvas renderer
// ---------------------------------------------------------------------------
class FibRendererImpl implements IPrimitivePaneRenderer {
  private _drawing: FibDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;
  private _decimals: number;

  constructor(
    drawing: FibDrawing,
    selected: boolean,
    series: ISeriesApi<SeriesType>,
    chart: IChartApiBase<Time>,
    decimals: number,
  ) {
    this._drawing = drawing;
    this._selected = selected;
    this._series = series;
    this._chart = chart;
    this._decimals = decimals;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, verticalPixelRatio: vpr, horizontalPixelRatio: hpr }) => {
      const cssX1 = ptX(this._drawing.p1, this._chart);
      const cssY1 = this._series.priceToCoordinate(this._drawing.p1.price);
      const cssX2 = ptX(this._drawing.p2, this._chart);
      const cssY2 = this._series.priceToCoordinate(this._drawing.p2.price);

      if (cssX1 === null || cssY1 === null || cssX2 === null || cssY2 === null) return;

      const x1 = cssX1 * hpr;
      const y1 = cssY1 * vpr;
      const x2 = cssX2 * hpr;
      const y2 = cssY2 * vpr;

      const left = Math.min(x1, x2);
      const right = this._drawing.extendRight ? ctx.canvas.width : Math.max(x1, x2);

      if (right - left < 1) return;

      // Normalize: ratio 0 = lower price (bottom of chart), ratio 1 = higher price (top)
      // This ensures positive extensions always appear above the rectangle
      const basePrice = Math.min(this._drawing.p1.price, this._drawing.p2.price);
      const priceSpan = Math.abs(this._drawing.p2.price - this._drawing.p1.price);

      // Resolve levels
      const allLevels = resolvedFibLevels(this._drawing);
      const activeLevels = this._drawing.showNegative
        ? allLevels
        : allLevels.filter((l) => l.ratio >= 0);
      const visibleLevels = activeLevels.filter((l) => l.visible !== false);

      // Background fill: span [0, 1] = core rectangle between p1 and p2
      const top = Math.min(y1, y2);
      const bottom = Math.max(y1, y2);
      const bgH = bottom - top;
      if (bgH >= 1) {
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = this._drawing.color ?? DEFAULT_FIB_COLOR;
        ctx.fillRect(left, top, right - left, bgH);
        ctx.globalAlpha = 1.0;
      }

      // Level lines + labels (labels OUTSIDE left boundary)
      const sw = this._drawing.strokeWidth;
      const pxr = Math.min(hpr, vpr);
      const labelOffsetX = Math.round(6 * hpr);
      ctx.save();
      for (const level of visibleLevels) {
        const price = basePrice + level.ratio * priceSpan;
        const cssY = this._series.priceToCoordinate(price);
        if (cssY === null) continue;
        const ly = Math.round(cssY * vpr) + 0.5;

        const color = resolveColor(level, this._drawing);
        ctx.strokeStyle = color;
        ctx.lineWidth = sw;
        applyLineDash(ctx, this._drawing.lineStyle, sw, pxr);
        ctx.beginPath();
        ctx.moveTo(left, ly);
        ctx.lineTo(right, ly);
        ctx.stroke();
        ctx.setLineDash([]);

        // Labels outside (to the left) — same font/color as the price scale
        const fs = Math.round(PRICE_SCALE_FONT_SIZE * vpr);
        const labelY = ly - Math.round(2 * vpr);
        const priceLabel = `(${price.toFixed(this._decimals)})`;
        const ratioLabel = formatRatioLabel(level.ratio);
        ctx.font = `${fs}px ${FONT_FAMILY}`;
        ctx.fillStyle = color;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        // Price in parens (right-most)
        ctx.fillText(priceLabel, left - labelOffsetX, labelY);
        // Ratio label to the left of price
        const priceWidth = ctx.measureText(priceLabel).width;
        ctx.fillText(ratioLabel, left - labelOffsetX - priceWidth - Math.round(4 * hpr), labelY);
      }
      ctx.restore();

      // Selection handles at p1 and p2
      if (this._selected) {
        const hr = Math.round(5 * vpr);
        ctx.fillStyle = COLOR_LABEL_TEXT;
        ctx.strokeStyle = COLOR_HANDLE_STROKE;
        ctx.lineWidth = Math.round(1.5 * vpr);
        for (const [hx, hy] of [[x1, y1], [x2, y2]] as [number, number][]) {
          ctx.beginPath();
          ctx.arc(hx, hy, hr, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// FibPaneView
// ---------------------------------------------------------------------------
export class FibPaneView implements IPrimitivePaneView {
  private _drawing: FibDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;
  private _decimals: number;

  constructor(
    drawing: FibDrawing,
    selected: boolean,
    series: ISeriesApi<SeriesType>,
    chart: IChartApiBase<Time>,
    decimals: number = 2,
  ) {
    this._drawing = drawing;
    this._selected = selected;
    this._series = series;
    this._chart = chart;
    this._decimals = decimals;
  }

  zOrder(): 'normal' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new FibRendererImpl(this._drawing, this._selected, this._series, this._chart, this._decimals);
  }

  hitTest(mouseX: number, mouseY: number): boolean {
    const x1 = ptX(this._drawing.p1, this._chart);
    const y1 = this._series.priceToCoordinate(this._drawing.p1.price);
    const x2 = ptX(this._drawing.p2, this._chart);
    const y2 = this._series.priceToCoordinate(this._drawing.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return false;

    const left = Math.min(x1, x2);
    const right = this._drawing.extendRight ? 1e6 : Math.max(x1, x2);

    // Check against all visible level lines
    const allLevels = resolvedFibLevels(this._drawing);
    const activeLevels = this._drawing.showNegative
      ? allLevels
      : allLevels.filter((l) => l.ratio >= 0);
    const visibleLevels = activeLevels.filter((l) => l.visible !== false);
    const basePrice = Math.min(this._drawing.p1.price, this._drawing.p2.price);
    const priceSpan = Math.abs(this._drawing.p2.price - this._drawing.p1.price);

    const LABEL_ZONE = 72; // px to the left of `left` where labels are drawn
    for (const level of visibleLevels) {
      const price = basePrice + level.ratio * priceSpan;
      const cssY = this._series.priceToCoordinate(price);
      if (cssY === null) continue;
      // Hit the line itself
      if (mouseX >= left - 4 && mouseX <= right + 4 && Math.abs(mouseY - cssY) <= 4) return true;
      // Hit the label area (to the left of the drawing boundary)
      if (mouseX >= left - LABEL_ZONE && mouseX < left && Math.abs(mouseY - cssY) <= 8) return true;
    }

    // Also hit the border of the core rectangle (edges)
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const TOL = 5;
    if (mouseX >= left - TOL && mouseX <= right + TOL) {
      if (Math.abs(mouseY - top) <= TOL || Math.abs(mouseY - bottom) <= TOL) return true;
    }
    if (mouseY >= top - TOL && mouseY <= bottom + TOL) {
      if (Math.abs(mouseX - left) <= TOL || (!this._drawing.extendRight && Math.abs(mouseX - Math.max(x1, x2)) <= TOL)) return true;
    }
    return false;
  }

  hitTestHandle(mx: number, my: number): string | null {
    if (!this._selected) return null;
    const x1 = ptX(this._drawing.p1, this._chart);
    const y1 = this._series.priceToCoordinate(this._drawing.p1.price);
    const x2 = ptX(this._drawing.p2, this._chart);
    const y2 = this._series.priceToCoordinate(this._drawing.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

    const tol = 7;
    if (Math.abs(mx - x1) <= tol && Math.abs(my - y1) <= tol) return 'p1';
    if (Math.abs(mx - x2) <= tol && Math.abs(my - y2) <= tol) return 'p2';
    return null;
  }

  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number } | null {
    const x1 = ptX(this._drawing.p1, this._chart);
    const x2 = ptX(this._drawing.p2, this._chart);
    if (x1 === null || x2 === null) return null;

    // Compute Y range across all visible levels
    const allLevels = resolvedFibLevels(this._drawing);
    const activeLevels = this._drawing.showNegative
      ? allLevels
      : allLevels.filter((l) => l.ratio >= 0);
    const visibleLevels = activeLevels.filter((l) => l.visible !== false);
    const priceSpan = this._drawing.p2.price - this._drawing.p1.price;

    const basePrice2 = Math.min(this._drawing.p1.price, this._drawing.p2.price);
    const priceSpan2 = Math.abs(this._drawing.p2.price - this._drawing.p1.price);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const level of visibleLevels) {
      const price = basePrice2 + level.ratio * priceSpan2;
      const cssY = this._series.priceToCoordinate(price);
      if (cssY === null) continue;
      if (cssY < minY) minY = cssY;
      if (cssY > maxY) maxY = cssY;
    }
    if (minY === Infinity) return null;

    return {
      x1: Math.min(x1, x2),
      y1: minY,
      x2: this._drawing.extendRight ? 1e6 : Math.max(x1, x2),
      y2: maxY,
    };
  }

  get drawingId(): string {
    return this._drawing.id;
  }

  /** Expose p1/p2 for drag handler */
  get drawingData(): { p1: { time: number; price: number; anchorTime?: number; barOffset?: number }; p2: { time: number; price: number; anchorTime?: number; barOffset?: number } } {
    return { p1: this._drawing.p1, p2: this._drawing.p2 };
  }
}

// ---------------------------------------------------------------------------
// FibPreviewPaneView — full fib-level preview during click-move-click creation
// ---------------------------------------------------------------------------
export interface FibPreviewOptions {
  x1: number; y1: number;   // CSS pixel coords (first click / p1)
  x2: number; y2: number;   // CSS pixel coords (current mouse / p2)
  startPrice: number;        // price at p1 — used for label text
  endPrice: number;          // price at p2 — used for label text
  levels: FibLevel[];
  color: string;
  strokeWidth: number;
  showNegative: boolean;
  decimals: number;
}

class FibPreviewRenderer implements IPrimitivePaneRenderer {
  private _opts: FibPreviewOptions;
  constructor(opts: FibPreviewOptions) { this._opts = opts; }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const { x1, y1, x2, y2, startPrice, endPrice, levels, color, strokeWidth, showNegative, decimals } = this._opts;

      const xLeft  = Math.min(x1, x2);
      const xRight = Math.max(x1, x2);
      const yTop   = Math.min(y1, y2);
      const yBottom = Math.max(y1, y2);
      const heightPx = yBottom - yTop;
      const widthPx  = xRight - xLeft;

      // Background fill (core rectangle, ratios 0–1)
      if (heightPx >= 1) {
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = color;
        ctx.fillRect(xLeft, yTop, widthPx || 1, heightPx);
        ctx.globalAlpha = 1.0;
      }

      // Levels + labels
      const basePrice  = Math.min(startPrice, endPrice);
      const priceSpan  = Math.abs(endPrice - startPrice);
      const allLevels  = levels.length > 0 ? levels : DEFAULT_FIB_LEVELS;
      const active     = showNegative ? allLevels : allLevels.filter((l) => l.ratio >= 0);
      const visible    = active.filter((l) => l.visible !== false);
      const labelOffX  = 6;

      ctx.save();
      for (const level of visible) {
        // Higher price = smaller Y in canvas coords → invert ratio
        const ly = yBottom - level.ratio * heightPx;
        const lc = level.color ?? color;

        ctx.strokeStyle = lc;
        ctx.lineWidth   = strokeWidth;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(xLeft, ly);
        ctx.lineTo(xRight, ly);
        ctx.stroke();

        // Labels to the left of xLeft (only when we have a real price span)
        if (priceSpan > 0) {
          const lp = basePrice + level.ratio * priceSpan;
          const priceLabel = `(${lp.toFixed(decimals)})`;
          const ratioLabel = formatRatioLabel(level.ratio);
          ctx.font         = `${PRICE_SCALE_FONT_SIZE}px ${FONT_FAMILY}`;
          ctx.fillStyle    = lc;
          ctx.textAlign    = 'right';
          ctx.textBaseline = 'bottom';
          const labelY = ly - 2;
          ctx.fillText(priceLabel, xLeft - labelOffX, labelY);
          const pw = ctx.measureText(priceLabel).width;
          ctx.fillText(ratioLabel, xLeft - labelOffX - pw - 4, labelY);
        }
      }
      ctx.restore();

      // Dashed diagonal connecting the two anchor points
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Endpoint dots
      ctx.fillStyle = color;
      for (const [px, py] of [[x1, y1], [x2, y2]] as [number, number][]) {
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  }
}

export class FibPreviewPaneView implements IPrimitivePaneView {
  private _opts: FibPreviewOptions;
  constructor(opts: FibPreviewOptions) { this._opts = opts; }

  zOrder(): 'top' { return 'top'; }

  renderer(): IPrimitivePaneRenderer | null {
    return new FibPreviewRenderer(this._opts);
  }
}
