import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { VLineDrawing } from '../../../types/drawing';
import { COLOR_LABEL_TEXT, COLOR_HANDLE_STROKE } from '../../../constants/colors';
import { FONT_FAMILY } from '../../../constants/layout';
import { applyLineDash } from './rendererUtils';

class VLineRendererImpl implements IPrimitivePaneRenderer {
  private _drawing: VLineDrawing;
  private _selected: boolean;
  private _chart: IChartApiBase<Time>;

  constructor(drawing: VLineDrawing, selected: boolean, chart: IChartApiBase<Time>) {
    this._drawing = drawing;
    this._selected = selected;
    this._chart = chart;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, verticalPixelRatio: vpr, horizontalPixelRatio: hpr }) => {
      const cssX = this._chart.timeScale().timeToCoordinate(this._drawing.time as unknown as Time);
      if (cssX === null) return;

      const x = Math.round(cssX * hpr) + 0.5;

      // Pre-measure text so we can cut a gap in the line for middle-aligned text
      const text = this._drawing.text;
      let gapTop = 0;
      let gapBottom = 0;
      let textFont = '';
      let textX = x + Math.round(6 * hpr);
      let textY = Math.round(16 * vpr);
      let textAlign: CanvasTextAlign = 'left';
      let textBaseline: CanvasTextBaseline = 'top';

      if (text?.content) {
        const fs = Math.round((text.fontSize ?? 11) * vpr);
        const weight = (text.bold ?? true) ? 'bold' : 'normal';
        const style = (text.italic ?? false) ? 'italic' : 'normal';
        textFont = `${style} ${weight} ${fs}px ${FONT_FAMILY}`;
        ctx.font = textFont;

        if (text.vAlign === 'middle') {
          textY = bitmapSize.height / 2;
          textBaseline = 'middle';
          const pad = Math.round(4 * vpr);
          gapTop = textY - fs / 2 - pad;
          gapBottom = textY + fs / 2 + pad;
        } else if (text.vAlign === 'bottom') {
          textY = bitmapSize.height - Math.round(8 * vpr);
          textBaseline = 'bottom';
        }

        if (text.hAlign === 'left') {
          textX = x - Math.round(6 * hpr);
          textAlign = 'right';
        } else if (text.hAlign === 'right') {
          textX = x + Math.round(6 * hpr);
          textAlign = 'left';
        } else {
          // center: text sits on the line
          textX = x;
          textAlign = 'center';
        }
      }

      // Draw the vertical line, with a gap where middle-aligned text sits
      const lineBottom = this._drawing.bottomPad
        ? bitmapSize.height - Math.round(this._drawing.bottomPad * vpr)
        : bitmapSize.height;
      ctx.strokeStyle = this._drawing.color;
      ctx.lineWidth = this._drawing.strokeWidth;
      applyLineDash(ctx, this._drawing.lineStyle, this._drawing.strokeWidth, vpr);
      if (gapTop > 0 && gapBottom > 0) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, gapTop);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, gapBottom);
        ctx.lineTo(x, lineBottom);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, lineBottom);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Selection handle at top of line
      if (this._selected) {
        const hr = Math.round(5 * hpr);
        ctx.fillStyle = COLOR_LABEL_TEXT;
        ctx.strokeStyle = COLOR_HANDLE_STROKE;
        ctx.lineWidth = Math.round(1.5 * hpr);
        ctx.beginPath();
        ctx.arc(x, hr, hr, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }

      // Text label
      if (text?.content) {
        ctx.font = textFont;
        ctx.fillStyle = text.color;
        ctx.textAlign = textAlign;
        ctx.textBaseline = textBaseline;
        ctx.fillText(text.content, textX, textY);
      }
    });
  }
}

export class VLinePaneView implements IPrimitivePaneView {
  private _drawing: VLineDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;

  constructor(
    drawing: VLineDrawing,
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
    return new VLineRendererImpl(this._drawing, this._selected, this._chart);
  }

  hitTest(mouseX: number, _mouseY: number): boolean {
    const x = this._chart.timeScale().timeToCoordinate(this._drawing.time as unknown as Time);
    if (x === null) return false;
    return Math.abs(mouseX - x) <= 5;
  }

  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number } | null {
    const x = this._chart.timeScale().timeToCoordinate(this._drawing.time as unknown as Time);
    if (x === null) return null;
    return { x1: x - 5, y1: 0, x2: x + 5, y2: 10_000 };
  }

  get drawingId(): string {
    return this._drawing.id;
  }
}
