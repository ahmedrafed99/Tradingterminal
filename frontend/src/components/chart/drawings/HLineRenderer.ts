import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { HLineDrawing } from '../../../types/drawing';
import { COLOR_LABEL_TEXT } from '../../../constants/colors';
import { hitTestHLine } from './hitTesting';

class HLineRendererImpl implements IPrimitivePaneRenderer {
  private _drawing: HLineDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<never>;

  constructor(drawing: HLineDrawing, selected: boolean, series: ISeriesApi<SeriesType>, chart: IChartApiBase<never>) {
    this._drawing = drawing;
    this._selected = selected;
    this._series = series;
    this._chart = chart;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, verticalPixelRatio: vpr, horizontalPixelRatio: hpr }) => {
      const cssY = this._series.priceToCoordinate(this._drawing.price);
      if (cssY === null) return;

      // Snap to device pixel boundary + 0.5 for crisp 1px line
      const y = Math.round(cssY * vpr) + 0.5;

      // Determine horizontal start position
      let startX = 0;
      if (!this._drawing.extendLeft && this._drawing.startTime) {
        const cssX = this._chart.timeScale().timeToCoordinate(this._drawing.startTime as unknown as Time);
        if (cssX !== null) {
          startX = Math.round(cssX * hpr);
        }
      }

      // Measure text gap (only when vAlign is middle, so text sits on the line)
      const text = this._drawing.text;
      let gapLeft = 0;
      let gapRight = 0;
      let textFont = '';
      let textTx = 0;
      let textTy = y;
      let textAlign: CanvasTextAlign = 'center';
      let textBaseline: CanvasTextBaseline = 'middle';

      if (text?.content) {
        const fs = Math.round((text.fontSize ?? 11) * vpr);
        const weight = (text.bold ?? true) ? 'bold' : 'normal';
        const style = (text.italic ?? false) ? 'italic' : 'normal';
        textFont = `${style} ${weight} ${fs}px system-ui, -apple-system, sans-serif`;
        ctx.font = textFont;

        const measured = ctx.measureText(text.content);
        const pad = Math.round(4 * hpr); // padding around text

        // Horizontal position
        if (text.hAlign === 'left') {
          textAlign = 'left';
          textTx = startX + Math.round(8 * hpr);
          if (text.vAlign === 'middle') {
            gapLeft = textTx - pad;
            gapRight = textTx + measured.width + pad;
          }
        } else if (text.hAlign === 'right') {
          textAlign = 'right';
          textTx = bitmapSize.width - Math.round(8 * hpr);
          if (text.vAlign === 'middle') {
            gapLeft = textTx - measured.width - pad;
            gapRight = textTx + pad;
          }
        } else {
          textAlign = 'center';
          textTx = (startX + bitmapSize.width) / 2;
          if (text.vAlign === 'middle') {
            gapLeft = textTx - measured.width / 2 - pad;
            gapRight = textTx + measured.width / 2 + pad;
          }
        }

        // Vertical offset from line
        const gap = Math.round(2 * vpr);
        if (text.vAlign === 'top') {
          textBaseline = 'bottom';
          textTy = y - fs / 2 - gap;
        } else if (text.vAlign === 'bottom') {
          textBaseline = 'top';
          textTy = y + fs / 2 + gap;
        } else {
          textBaseline = 'middle';
          textTy = y;
        }
      }

      // Draw the horizontal line (with gap for middle-aligned text)
      ctx.strokeStyle = this._drawing.color;
      ctx.lineWidth = this._drawing.strokeWidth;
      if (gapLeft > 0 && gapRight > 0 && gapLeft > startX) {
        // Two segments: before and after the text
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(gapLeft, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gapRight, y);
        ctx.lineTo(bitmapSize.width, y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(bitmapSize.width, y);
        ctx.stroke();
      }

      // Selection handles
      if (this._selected) {
        const hs = Math.round(4 * vpr);
        ctx.fillStyle = COLOR_LABEL_TEXT;
        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = Math.round(1.5 * vpr);
        const hPositions = [startX + hs / 2, (startX + bitmapSize.width) / 2, bitmapSize.width - hs / 2];
        for (const hx of hPositions) {
          ctx.beginPath();
          ctx.arc(hx, y, hs / 2, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Text label
      if (text?.content) {
        ctx.font = textFont;
        ctx.fillStyle = text.color;
        ctx.textAlign = textAlign;
        ctx.textBaseline = textBaseline;
        ctx.fillText(text.content, textTx, textTy);
      }
    });
  }
}

export class HLinePaneView implements IPrimitivePaneView {
  private _drawing: HLineDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<never>;

  constructor(
    drawing: HLineDrawing,
    selected: boolean,
    series: ISeriesApi<SeriesType>,
    chart: IChartApiBase<never>,
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
    return new HLineRendererImpl(this._drawing, this._selected, this._series, this._chart);
  }

  hitTest(mouseX: number, mouseY: number): boolean {
    const y = this._series.priceToCoordinate(this._drawing.price);
    if (y === null) return false;
    if (!hitTestHLine(mouseY, y)) return false;
    // Exclude clicks on the price scale area (right side of chart)
    const chartWidth = this._chart.timeScale().width();
    if (chartWidth > 0 && mouseX >= chartWidth) return false;
    // When not extending left, only hit if mouse is to the right of startTime
    if (!this._drawing.extendLeft && this._drawing.startTime) {
      const startCssX = this._chart.timeScale().timeToCoordinate(this._drawing.startTime as unknown as Time);
      if (startCssX !== null && mouseX < startCssX) return false;
    }
    return true;
  }

  get drawingId(): string {
    return this._drawing.id;
  }
}
