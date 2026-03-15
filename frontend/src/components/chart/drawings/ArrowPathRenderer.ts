import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { ArrowPathDrawing } from '../../../types/drawing';
import { COLOR_LABEL_TEXT, COLOR_HANDLE_STROKE } from '../../../constants/colors';
import { hitTestArrowPath } from './hitTesting';

/** Convert arrowpath data points → CSS pixel points using anchor + barSpacing. */
function toPixelPoints(
  drawing: ArrowPathDrawing,
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
    if (y === null) return null;  // all points must be valid for arrow path
    result.push({ x, y });
  }
  return result.length >= 2 ? result : null;
}

class ArrowPathRendererImpl implements IPrimitivePaneRenderer {
  private _drawing: ArrowPathDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;

  constructor(
    drawing: ArrowPathDrawing,
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

      // Convert CSS → device pixel coords
      const devPts = cssPts.map((p) => ({ x: p.x * hpr, y: p.y * vpr }));

      // Draw polyline
      ctx.beginPath();
      ctx.strokeStyle = this._drawing.color;
      ctx.lineWidth = this._drawing.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.moveTo(devPts[0].x, devPts[0].y);
      for (let i = 1; i < devPts.length; i++) {
        ctx.lineTo(devPts[i].x, devPts[i].y);
      }
      ctx.stroke();

      // Draw arrowhead on last segment
      const last = devPts[devPts.length - 1];
      const prev = devPts[devPts.length - 2];
      const dx = last.x - prev.x;
      const dy = last.y - prev.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      if (segLen > 1) {
        const arrowSize = Math.min(segLen * 0.4, Math.max(8, 4 * this._drawing.strokeWidth) * Math.min(hpr, vpr));
        const angle = Math.atan2(dy, dx);
        const halfAngle = 0.70; // ~40 degrees

        const wing1x = last.x - arrowSize * Math.cos(angle - halfAngle);
        const wing1y = last.y - arrowSize * Math.sin(angle - halfAngle);
        const wing2x = last.x - arrowSize * Math.cos(angle + halfAngle);
        const wing2y = last.y - arrowSize * Math.sin(angle + halfAngle);

        ctx.beginPath();
        ctx.moveTo(wing1x, wing1y);
        ctx.lineTo(last.x, last.y);
        ctx.lineTo(wing2x, wing2y);
        ctx.strokeStyle = this._drawing.color;
        ctx.lineWidth = this._drawing.strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // Selection handles at each node
      if (this._selected) {
        const hr = Math.round(4 * vpr);
        ctx.fillStyle = COLOR_LABEL_TEXT;
        ctx.strokeStyle = COLOR_HANDLE_STROKE;
        ctx.lineWidth = Math.round(1.5 * vpr);
        for (const dp of devPts) {
          ctx.beginPath();
          ctx.arc(dp.x, dp.y, hr, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Text label (positioned at path midpoint)
      const text = this._drawing.text;
      if (text?.content) {
        const midIdx = Math.floor(devPts.length / 2);
        const midPt = devPts.length % 2 === 0
          ? { x: (devPts[midIdx - 1].x + devPts[midIdx].x) / 2, y: (devPts[midIdx - 1].y + devPts[midIdx].y) / 2 }
          : devPts[midIdx];

        const fs = Math.round((text.fontSize ?? 11) * vpr);
        const weight = (text.bold ?? true) ? 'bold' : 'normal';
        const style = (text.italic ?? false) ? 'italic' : 'normal';
        ctx.font = `${style} ${weight} ${fs}px system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = text.color;

        const pad = Math.round(6 * vpr);
        if (text.hAlign === 'left') {
          ctx.textAlign = 'left';
        } else if (text.hAlign === 'right') {
          ctx.textAlign = 'right';
        } else {
          ctx.textAlign = 'center';
        }

        if (text.vAlign === 'top') {
          ctx.textBaseline = 'bottom';
          ctx.fillText(text.content, midPt.x, midPt.y - pad);
        } else if (text.vAlign === 'bottom') {
          ctx.textBaseline = 'top';
          ctx.fillText(text.content, midPt.x, midPt.y + pad);
        } else {
          ctx.textBaseline = 'middle';
          ctx.fillText(text.content, midPt.x, midPt.y - pad);
        }
      }
    });
  }
}

export class ArrowPathPaneView implements IPrimitivePaneView {
  private _drawing: ArrowPathDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;

  constructor(
    drawing: ArrowPathDrawing,
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
    return new ArrowPathRendererImpl(this._drawing, this._selected, this._series, this._chart);
  }

  hitTest(mouseX: number, mouseY: number): boolean {
    const cssPts = toPixelPoints(this._drawing, this._chart, this._series);
    if (!cssPts) return false;
    return hitTestArrowPath(mouseX, mouseY, cssPts);
  }

  /** Hit-test node handles. Returns 'node-0', 'node-1', etc. or null. */
  hitTestHandle(mx: number, my: number): string | null {
    if (!this._selected) return null;
    const cssPts = toPixelPoints(this._drawing, this._chart, this._series);
    if (!cssPts) return null;
    const tol = 6;
    for (let i = 0; i < cssPts.length; i++) {
      if (Math.abs(mx - cssPts[i].x) <= tol && Math.abs(my - cssPts[i].y) <= tol) return `node-${i}`;
    }
    return null;
  }

  get drawingId(): string {
    return this._drawing.id;
  }
}
