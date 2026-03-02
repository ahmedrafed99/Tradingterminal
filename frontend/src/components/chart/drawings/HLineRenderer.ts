import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { HLineDrawing } from '../../../types/drawing';
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

      ctx.beginPath();
      ctx.strokeStyle = this._drawing.color;
      ctx.lineWidth = this._drawing.strokeWidth; // 1 = 1 device pixel
      ctx.moveTo(startX, y);
      ctx.lineTo(bitmapSize.width, y);
      ctx.stroke();

      // Selection handles
      if (this._selected) {
        const hs = Math.round(4 * vpr);
        ctx.fillStyle = '#000000';
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
      const text = this._drawing.text;
      if (text?.content) {
        const fs = Math.round((text.fontSize ?? 11) * vpr);
        const weight = (text.bold ?? true) ? 'bold' : 'normal';
        const style = (text.italic ?? false) ? 'italic' : 'normal';
        ctx.font = `${style} ${weight} ${fs}px system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = text.color;

        // Horizontal position
        let tx: number;
        if (text.hAlign === 'left') {
          ctx.textAlign = 'left';
          tx = startX + Math.round(8 * hpr);
        } else if (text.hAlign === 'right') {
          ctx.textAlign = 'right';
          tx = bitmapSize.width - Math.round(8 * hpr);
        } else {
          ctx.textAlign = 'center';
          tx = (startX + bitmapSize.width) / 2;
        }

        // Vertical offset from line
        let ty: number;
        const gap = Math.round(2 * vpr);
        if (text.vAlign === 'top') {
          ctx.textBaseline = 'bottom';
          ty = y - fs / 2 - gap;
        } else if (text.vAlign === 'bottom') {
          ctx.textBaseline = 'top';
          ty = y + fs / 2 + gap;
        } else {
          ctx.textBaseline = 'middle';
          ty = y;
        }

        ctx.fillText(text.content, tx, ty);
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
