import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { FRVPDrawing } from '../../../types/drawing';
import { COLOR_ACCENT, COLOR_LABEL_TEXT, COLOR_HANDLE_STROKE } from '../../../constants/colors';
import { applyLineDash } from './rendererUtils';
import { hitTestRect } from './hitTesting';

// ---------------------------------------------------------------------------
// Color helpers (copied from VolumeProfilePrimitive.ts)
// ---------------------------------------------------------------------------

function parseColor(color: string): [number, number, number, number] {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (m) {
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1];
  }
  const h = color.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16), 1];
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Max bar width in CSS pixels — bars never extend further than this from the anchor line
const MAX_BAR_WIDTH_CSS = 180;

// ---------------------------------------------------------------------------
// FRVP Renderer
// ---------------------------------------------------------------------------

class FRVPRendererImpl implements IPrimitivePaneRenderer {
  private _drawing: FRVPDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;
  private _volumeMapRef: { current: Map<number, number> };
  private _tickSize: number;

  constructor(
    drawing: FRVPDrawing,
    selected: boolean,
    series: ISeriesApi<SeriesType>,
    chart: IChartApiBase<Time>,
    volumeMapRef: { current: Map<number, number> },
    tickSize: number,
  ) {
    this._drawing = drawing;
    this._selected = selected;
    this._series = series;
    this._chart = chart;
    this._volumeMapRef = volumeMapRef;
    this._tickSize = tickSize;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, verticalPixelRatio: vpr, horizontalPixelRatio: hpr }) => {
      const cssAnchorX = this._chart.timeScale().timeToCoordinate(this._drawing.anchorTime as unknown as Time);
      const cssPMaxY = this._series.priceToCoordinate(this._drawing.pMax);
      const cssPMinY = this._series.priceToCoordinate(this._drawing.pMin);

      if (cssAnchorX === null || cssPMaxY === null || cssPMinY === null) return;

      const anchorX = cssAnchorX * hpr;
      const topY = Math.min(cssPMaxY, cssPMinY) * vpr;
      const bottomY = Math.max(cssPMaxY, cssPMinY) * vpr;

      if (bottomY - topY < 1) return;

      const maxBarW = Math.min(MAX_BAR_WIDTH_CSS * hpr, ctx.canvas.width * 0.25);

      // Draw VP bars first (behind the line)
      this._drawBars(ctx, anchorX, topY, bottomY, maxBarW, hpr, vpr);

      // Vertical anchor line
      ctx.strokeStyle = this._drawing.color;
      ctx.lineWidth = this._drawing.strokeWidth * hpr;
      applyLineDash(ctx, this._drawing.lineStyle, this._drawing.strokeWidth, Math.min(hpr, vpr));
      ctx.beginPath();
      ctx.moveTo(Math.round(anchorX) + 0.5, topY);
      ctx.lineTo(Math.round(anchorX) + 0.5, bottomY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Selection handles at top and bottom of anchor line
      if (this._selected) {
        const hr = Math.round(5 * vpr);
        ctx.fillStyle = COLOR_LABEL_TEXT;
        ctx.strokeStyle = COLOR_HANDLE_STROKE;
        ctx.lineWidth = Math.round(1.5 * vpr);
        for (const hy of [topY, bottomY]) {
          ctx.beginPath();
          ctx.arc(anchorX, hy, hr, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
      }
    });
  }

  private _drawBars(
    ctx: CanvasRenderingContext2D,
    anchorX: number,
    topY: number,
    bottomY: number,
    maxBarW: number,
    _hpr: number,
    vpr: number,
  ): void {
    const vmap = this._volumeMapRef.current;
    if (vmap.size === 0) return;

    const pMin = Math.min(this._drawing.pMin, this._drawing.pMax);
    const pMax = Math.max(this._drawing.pMin, this._drawing.pMax);
    const tickSize = this._tickSize > 0 ? this._tickSize : 0.01;
    const numBars = this._drawing.numBars && this._drawing.numBars > 1 ? this._drawing.numBars : 0;
    const showPoc = this._drawing.showPoc !== false;
    const pocColor = this._drawing.pocColor ?? COLOR_ACCENT;

    const [r, g, b] = parseColor(this._drawing.color);
    const barColor = rgba(r, g, b, 0.45);

    // pocLine: { y, w } in bitmap pixels — filled during bar loop, drawn after
    let pocLine: { y: number; w: number } | null = null;

    if (numBars > 0) {
      // ── Aggregated mode: divide [pMin, pMax] into numBars equal-height buckets ──
      const bucketSize = (pMax - pMin) / numBars;
      const buckets = new Float64Array(numBars);

      for (const [price, vol] of vmap) {
        if (price < pMin - 1e-9 || price > pMax + 1e-9) continue;
        const idx = Math.min(Math.floor((price - pMin) / bucketSize), numBars - 1);
        buckets[idx] += vol;
      }

      let maxVol = 0;
      let pocIdx = 0;
      for (let i = 0; i < numBars; i++) {
        if (buckets[i] > maxVol) { maxVol = buckets[i]; pocIdx = i; }
      }
      if (maxVol === 0) return;

      for (let i = 0; i < numBars; i++) {
        if (buckets[i] === 0) continue;

        const bucketMidPrice = pMin + (i + 0.5) * bucketSize;
        const cssY = this._series.priceToCoordinate(bucketMidPrice);
        if (cssY === null) continue;

        const cssYLo = this._series.priceToCoordinate(pMin + i * bucketSize);
        const cssYHi = this._series.priceToCoordinate(pMin + (i + 1) * bucketSize);
        const barH = cssYLo !== null && cssYHi !== null
          ? Math.max(Math.abs(cssYHi - cssYLo) * vpr - 1, 1)
          : Math.max((bottomY - topY) / numBars - 1, 1);

        const barCenterY = cssY * vpr;
        if (barCenterY < topY - barH || barCenterY > bottomY + barH) continue;

        const barW = (buckets[i] / maxVol) * maxBarW;
        ctx.fillStyle = barColor;
        ctx.fillRect(anchorX, barCenterY - barH / 2, barW, barH);

        if (i === pocIdx) pocLine = { y: barCenterY, w: barW };
      }
    } else {
      // ── Raw mode: one bar per tick-level price ──
      let maxVol = 0;
      let pocPrice = 0;
      const entries: { price: number; vol: number }[] = [];

      for (const [price, vol] of vmap) {
        if (price < pMin - 1e-9 || price > pMax + 1e-9) continue;
        entries.push({ price, vol });
        if (vol > maxVol) { maxVol = vol; pocPrice = price; }
      }
      if (maxVol === 0 || entries.length === 0) return;

      const tickPixels = (() => {
        const yLo = this._series.priceToCoordinate(pMin);
        const yHi = this._series.priceToCoordinate(pMin + tickSize);
        if (yLo === null || yHi === null) return 1;
        return Math.abs(yHi - yLo) * vpr;
      })();
      const barH = Math.max(tickPixels, 1);

      for (const { price, vol } of entries) {
        const cssY = this._series.priceToCoordinate(price);
        if (cssY === null) continue;

        const barCenterY = cssY * vpr;
        if (barCenterY < topY - barH || barCenterY > bottomY + barH) continue;

        const barW = (vol / maxVol) * maxBarW;
        ctx.fillStyle = barColor;
        ctx.fillRect(anchorX, barCenterY - barH / 2, barW, barH);

        if (Math.abs(price - pocPrice) < tickSize * 0.5) pocLine = { y: barCenterY, w: barW };
      }
    }

    // ── POC line: thin horizontal line centered on the POC bar, drawn on top ──
    if (showPoc && pocLine) {
      ctx.strokeStyle = pocColor;
      ctx.lineWidth = Math.max(Math.round(2 * vpr), 2);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(anchorX, pocLine.y);
      ctx.lineTo(anchorX + pocLine.w, pocLine.y);
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// FRVP PaneView
// ---------------------------------------------------------------------------

export class FRVPPaneView implements IPrimitivePaneView {
  private _drawing: FRVPDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;
  private _volumeMapRef: { current: Map<number, number> };
  private _tickSize: number;

  constructor(
    drawing: FRVPDrawing,
    selected: boolean,
    series: ISeriesApi<SeriesType>,
    chart: IChartApiBase<Time>,
    volumeMapRef: { current: Map<number, number> },
    tickSize: number,
  ) {
    this._drawing = drawing;
    this._selected = selected;
    this._series = series;
    this._chart = chart;
    this._volumeMapRef = volumeMapRef;
    this._tickSize = tickSize;
  }

  zOrder(): 'normal' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new FRVPRendererImpl(
      this._drawing, this._selected, this._series, this._chart,
      this._volumeMapRef, this._tickSize,
    );
  }

  hitTest(mouseX: number, mouseY: number): boolean {
    const ax = this._chart.timeScale().timeToCoordinate(this._drawing.anchorTime as unknown as Time);
    const yPMax = this._series.priceToCoordinate(this._drawing.pMax);
    const yPMin = this._series.priceToCoordinate(this._drawing.pMin);
    if (ax === null || yPMax === null || yPMin === null) return false;
    const top = Math.min(yPMax, yPMin);
    const bottom = Math.max(yPMax, yPMin);
    // Hit within the anchor line or the bar area to its right
    return hitTestRect(mouseX, mouseY, ax - 6, top, ax + MAX_BAR_WIDTH_CSS, bottom);
  }

  hitTestHandle(mx: number, my: number): string | null {
    if (!this._selected) return null;
    const ax = this._chart.timeScale().timeToCoordinate(this._drawing.anchorTime as unknown as Time);
    const yPMax = this._series.priceToCoordinate(this._drawing.pMax);
    const yPMin = this._series.priceToCoordinate(this._drawing.pMin);
    if (ax === null || yPMax === null || yPMin === null) return null;

    const tol = 8;
    if (Math.abs(mx - ax) <= tol && Math.abs(my - yPMax) <= tol) return 'n';
    if (Math.abs(mx - ax) <= tol && Math.abs(my - yPMin) <= tol) return 's';
    return null;
  }

  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number } | null {
    const ax = this._chart.timeScale().timeToCoordinate(this._drawing.anchorTime as unknown as Time);
    const yPMax = this._series.priceToCoordinate(this._drawing.pMax);
    const yPMin = this._series.priceToCoordinate(this._drawing.pMin);
    if (ax === null || yPMax === null || yPMin === null) return null;
    return {
      x1: ax,
      y1: Math.min(yPMax, yPMin),
      x2: ax + MAX_BAR_WIDTH_CSS,
      y2: Math.max(yPMax, yPMin),
    };
  }

  get drawingId(): string {
    return this._drawing.id;
  }
}
