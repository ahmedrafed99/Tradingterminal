import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { RectDrawing } from '../../../types/drawing';
import { COLOR_LABEL_TEXT, COLOR_HANDLE_STROKE } from '../../../constants/colors';
import { FONT_FAMILY } from '../../../constants/layout';
import { hitTestRectEdges } from './hitTesting';
import { applyLineDash } from './rendererUtils';

/** Convert an AnchoredPoint to CSS pixel X (sub-bar precision). */
function ptX(point: { time: number; anchorTime?: number; barOffset?: number }, chart: IChartApiBase<Time>): number | null {
  if (point.anchorTime !== undefined && point.barOffset !== undefined) {
    const ax = chart.timeScale().timeToCoordinate(point.anchorTime as unknown as Time);
    if (ax === null) return null;
    const bs = (chart.timeScale().options() as { barSpacing: number }).barSpacing;
    return ax + point.barOffset * bs;
  }
  return chart.timeScale().timeToCoordinate(point.time as unknown as Time);
}

class RectRendererImpl implements IPrimitivePaneRenderer {
  private _drawing: RectDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;

  constructor(
    drawing: RectDrawing,
    selected: boolean,
    series: ISeriesApi<SeriesType>,
    chart: IChartApiBase<Time>,
  ) {
    this._drawing = drawing;
    this._selected = selected;
    this._series = series;
    this._chart = chart;
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

      const rawLeft = Math.min(x1, x2);
      const rawTop = Math.min(y1, y2);
      const rawW = Math.abs(x2 - x1);
      const rawH = Math.abs(y2 - y1);

      if (rawW < 1 && rawH < 1) return;

      // Fill (use raw coords for full coverage)
      if (this._drawing.fillColor) {
        ctx.fillStyle = this._drawing.fillColor;
        ctx.fillRect(rawLeft, rawTop, rawW, rawH);
      }

      // Stroke — snap edges to pixel grid + 0.5 offset for crisp lines
      const left = Math.round(rawLeft) + 0.5;
      const top = Math.round(rawTop) + 0.5;
      const right = Math.round(rawLeft + rawW) + 0.5;
      const bottom = Math.round(rawTop + rawH) + 0.5;
      ctx.strokeStyle = this._drawing.color;
      ctx.lineWidth = this._drawing.strokeWidth;
      applyLineDash(ctx, this._drawing.lineStyle, this._drawing.strokeWidth, Math.min(hpr, vpr));
      ctx.strokeRect(left, top, right - left, bottom - top);
      ctx.setLineDash([]);

      // Selection: 4 corner handles
      if (this._selected) {
        const hr = Math.round(5 * vpr);
        const handles = [
          [Math.min(x1, x2), Math.min(y1, y2)], // top-left
          [Math.max(x1, x2), Math.min(y1, y2)], // top-right
          [Math.min(x1, x2), Math.max(y1, y2)], // bottom-left
          [Math.max(x1, x2), Math.max(y1, y2)], // bottom-right
        ];
        ctx.fillStyle = COLOR_LABEL_TEXT;
        ctx.strokeStyle = COLOR_HANDLE_STROKE;
        ctx.lineWidth = Math.round(1.5 * vpr);
        for (const [hx, hy] of handles) {
          ctx.beginPath();
          ctx.arc(hx, hy, hr, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Text label
      const text = this._drawing.text;
      if (text?.content) {
        const fs = Math.round((text.fontSize ?? 11) * vpr);
        const weight = (text.bold ?? true) ? 'bold' : 'normal';
        const style = (text.italic ?? false) ? 'italic' : 'normal';
        ctx.font = `${style} ${weight} ${fs}px ${FONT_FAMILY}`;
        ctx.fillStyle = text.color;

        const pad = Math.round(4 * hpr);
        let tx: number;
        if (text.hAlign === 'left') {
          ctx.textAlign = 'left';
          tx = left + pad;
        } else if (text.hAlign === 'right') {
          ctx.textAlign = 'right';
          tx = left + w - pad;
        } else {
          ctx.textAlign = 'center';
          tx = left + w / 2;
        }

        const vpad = Math.round(4 * vpr);
        let ty: number;
        if (text.vAlign === 'top') {
          ctx.textBaseline = 'bottom';
          ty = top - vpad;
        } else if (text.vAlign === 'bottom') {
          ctx.textBaseline = 'top';
          ty = top + h + vpad;
        } else {
          ctx.textBaseline = 'middle';
          ty = top + h / 2;
        }

        ctx.fillText(text.content, tx, ty);
      }
    });
  }
}

export class RectPaneView implements IPrimitivePaneView {
  private _drawing: RectDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;

  constructor(
    drawing: RectDrawing,
    selected: boolean,
    series: ISeriesApi<SeriesType>,
    chart: IChartApiBase<Time>,
  ) {
    this._drawing = drawing;
    this._selected = selected;
    this._series = series;
    this._chart = chart;
  }

  zOrder(): 'normal' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new RectRendererImpl(this._drawing, this._selected, this._series, this._chart);
  }

  hitTest(mouseX: number, mouseY: number): boolean {
    const x1 = ptX(this._drawing.p1, this._chart);
    const y1 = this._series.priceToCoordinate(this._drawing.p1.price);
    const x2 = ptX(this._drawing.p2, this._chart);
    const y2 = this._series.priceToCoordinate(this._drawing.p2.price);

    if (x1 === null || y1 === null || x2 === null || y2 === null) return false;

    return hitTestRectEdges(mouseX, mouseY, x1, y1, x2, y2);
  }

  hitTestHandle(mx: number, my: number): string | null {
    if (!this._selected) return null;

    const x1 = ptX(this._drawing.p1, this._chart);
    const y1 = this._series.priceToCoordinate(this._drawing.p1.price);
    const x2 = ptX(this._drawing.p2, this._chart);
    const y2 = this._series.priceToCoordinate(this._drawing.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

    const tol = 6;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);

    const handles: [number, number, string][] = [
      [left, top, 'nw'],
      [right, top, 'ne'],
      [left, bottom, 'sw'],
      [right, bottom, 'se'],
    ];

    for (const [hx, hy, id] of handles) {
      if (Math.abs(mx - hx) <= tol && Math.abs(my - hy) <= tol) return id;
    }
    return null;
  }

  get drawingData(): { p1: { time: number; price: number }; p2: { time: number; price: number } } {
    return { p1: this._drawing.p1, p2: this._drawing.p2 };
  }

  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number } | null {
    const x1 = ptX(this._drawing.p1, this._chart);
    const y1 = this._series.priceToCoordinate(this._drawing.p1.price);
    const x2 = ptX(this._drawing.p2, this._chart);
    const y2 = this._series.priceToCoordinate(this._drawing.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
  }

  get drawingId(): string {
    return this._drawing.id;
  }
}
