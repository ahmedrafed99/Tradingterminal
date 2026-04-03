import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { FreeDrawDrawing } from '../../../types/drawing';
import { COLOR_LABEL_TEXT, COLOR_HANDLE_STROKE } from '../../../constants/colors';
import { hitTestArrowPath } from './hitTesting';
import { applyLineDash } from './rendererUtils';

/** Convert freedraw data points → CSS pixel points using anchor + barSpacing. */
function toPixelPoints(
  drawing: FreeDrawDrawing,
  chart: IChartApiBase<Time>,
  series: ISeriesApi<SeriesType>,
): { x: number; y: number }[] | null {
  const anchorX = chart.timeScale().timeToCoordinate(drawing.anchorTime as unknown as Time);
  if (anchorX === null) return null;
  const barSpacing = (chart.timeScale().options() as { barSpacing: number }).barSpacing;

  const result: { x: number; y: number }[] = [];
  for (const p of drawing.points) {
    const x = anchorX + p.barOffset * barSpacing;
    const y = series.priceToCoordinate(p.price);
    if (y === null) return null;  // all points must be valid to preserve shape
    result.push({ x, y });
  }
  return result.length >= 2 ? result : null;
}

class FreeDrawRendererImpl implements IPrimitivePaneRenderer {
  private _drawing: FreeDrawDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;

  constructor(
    drawing: FreeDrawDrawing,
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
      const cssPts = toPixelPoints(this._drawing, this._chart, this._series);
      if (!cssPts) return;

      ctx.beginPath();
      ctx.strokeStyle = this._drawing.color;
      ctx.lineWidth = this._drawing.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      applyLineDash(ctx, this._drawing.lineStyle, this._drawing.strokeWidth, Math.min(hpr, vpr));
      ctx.moveTo(cssPts[0].x * hpr, cssPts[0].y * vpr);
      for (let i = 1; i < cssPts.length; i++) {
        ctx.lineTo(cssPts[i].x * hpr, cssPts[i].y * vpr);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Selection handles at start and end points
      if (this._selected) {
        const hr = Math.round(5 * vpr);
        ctx.fillStyle = COLOR_LABEL_TEXT;
        ctx.strokeStyle = COLOR_HANDLE_STROKE;
        ctx.lineWidth = Math.round(1.5 * vpr);
        const first = cssPts[0];
        const last = cssPts[cssPts.length - 1];
        for (const pt of [first, last]) {
          ctx.beginPath();
          ctx.arc(pt.x * hpr, pt.y * vpr, hr, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
      }
    });
  }
}

export class FreeDrawPaneView implements IPrimitivePaneView {
  private _drawing: FreeDrawDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;

  constructor(
    drawing: FreeDrawDrawing,
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
    return new FreeDrawRendererImpl(this._drawing, this._selected, this._series, this._chart);
  }

  hitTest(mouseX: number, mouseY: number): boolean {
    const cssPts = toPixelPoints(this._drawing, this._chart, this._series);
    if (!cssPts) return false;
    return hitTestArrowPath(mouseX, mouseY, cssPts);
  }

  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number } | null {
    const cssPts = toPixelPoints(this._drawing, this._chart, this._series);
    if (!cssPts) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of cssPts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x1: minX, y1: minY, x2: maxX, y2: maxY };
  }

  get drawingId(): string {
    return this._drawing.id;
  }
}
