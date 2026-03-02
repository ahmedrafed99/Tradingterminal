import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { OvalDrawing } from '../../../types/drawing';
import { hitTestOval } from './hitTesting';

class OvalRendererImpl implements IPrimitivePaneRenderer {
  private _drawing: OvalDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;

  constructor(
    drawing: OvalDrawing,
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
      const cssX1 = this._chart.timeScale().timeToCoordinate(this._drawing.p1.time as unknown as Time);
      const cssY1 = this._series.priceToCoordinate(this._drawing.p1.price);
      const cssX2 = this._chart.timeScale().timeToCoordinate(this._drawing.p2.time as unknown as Time);
      const cssY2 = this._series.priceToCoordinate(this._drawing.p2.price);

      if (cssX1 === null || cssY1 === null || cssX2 === null || cssY2 === null) return;

      // Convert to device pixel coordinates
      const x1 = cssX1 * hpr;
      const y1 = cssY1 * vpr;
      const x2 = cssX2 * hpr;
      const y2 = cssY2 * vpr;

      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;

      if (rx < 1 || ry < 1) return;

      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      ctx.strokeStyle = this._drawing.color;
      ctx.lineWidth = this._drawing.strokeWidth; // 1 = 1 device pixel
      ctx.stroke();

      // Selection: 4 handles at ellipse cardinal points (top, bottom, left, right)
      if (this._selected) {
        const hr = Math.round(4 * vpr);
        const handles = [
          [cx, cy - ry], // top
          [cx, cy + ry], // bottom
          [cx - rx, cy], // left
          [cx + rx, cy], // right
        ];
        ctx.fillStyle = '#000000';
        ctx.strokeStyle = '#1e3a5f';
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
        ctx.font = `${style} ${weight} ${fs}px system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = text.color;

        // Horizontal position relative to oval center
        let tx: number;
        const pad = Math.round(4 * hpr);
        if (text.hAlign === 'left') {
          ctx.textAlign = 'left';
          tx = cx - rx + pad;
        } else if (text.hAlign === 'right') {
          ctx.textAlign = 'right';
          tx = cx + rx - pad;
        } else {
          ctx.textAlign = 'center';
          tx = cx;
        }

        // Vertical position relative to oval
        let ty: number;
        const vpad = Math.round(4 * vpr);
        if (text.vAlign === 'top') {
          ctx.textBaseline = 'bottom';
          ty = cy - ry - vpad;
        } else if (text.vAlign === 'bottom') {
          ctx.textBaseline = 'top';
          ty = cy + ry + vpad;
        } else {
          ctx.textBaseline = 'middle';
          ty = cy;
        }

        ctx.fillText(text.content, tx, ty);
      }
    });
  }
}

export class OvalPaneView implements IPrimitivePaneView {
  private _drawing: OvalDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;

  constructor(
    drawing: OvalDrawing,
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
    return new OvalRendererImpl(this._drawing, this._selected, this._series, this._chart);
  }

  hitTest(mouseX: number, mouseY: number): boolean {
    const x1 = this._chart.timeScale().timeToCoordinate(this._drawing.p1.time as unknown as Time);
    const y1 = this._series.priceToCoordinate(this._drawing.p1.price);
    const x2 = this._chart.timeScale().timeToCoordinate(this._drawing.p2.time as unknown as Time);
    const y2 = this._series.priceToCoordinate(this._drawing.p2.price);

    if (x1 === null || y1 === null || x2 === null || y2 === null) return false;

    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2;
    const ry = Math.abs(y2 - y1) / 2;

    return hitTestOval(mouseX, mouseY, cx, cy, rx, ry);
  }

  /** Hit-test the 8 resize handles. Returns handle ID or null. */
  hitTestHandle(mx: number, my: number): string | null {
    if (!this._selected) return null;

    const x1 = this._chart.timeScale().timeToCoordinate(this._drawing.p1.time as unknown as Time);
    const y1 = this._series.priceToCoordinate(this._drawing.p1.price);
    const x2 = this._chart.timeScale().timeToCoordinate(this._drawing.p2.time as unknown as Time);
    const y2 = this._series.priceToCoordinate(this._drawing.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2;
    const ry = Math.abs(y2 - y1) / 2;
    const tol = 6;

    const handles: [number, number, string][] = [
      [cx, cy - ry, 'n'],
      [cx, cy + ry, 's'],
      [cx - rx, cy, 'w'],
      [cx + rx, cy, 'e'],
    ];

    for (const [hx, hy, id] of handles) {
      if (Math.abs(mx - hx) <= tol && Math.abs(my - hy) <= tol) return id;
    }
    return null;
  }

  /** Get the drawing's data-coordinate points for resize logic. */
  get drawingData(): { p1: { time: number; price: number }; p2: { time: number; price: number } } {
    return { p1: this._drawing.p1, p2: this._drawing.p2 };
  }

  get drawingId(): string {
    return this._drawing.id;
  }
}
