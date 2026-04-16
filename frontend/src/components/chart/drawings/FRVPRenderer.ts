import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { FRVPDrawing } from '../../../types/drawing';
import { COLOR_ACCENT, COLOR_LABEL_TEXT, COLOR_HANDLE_STROKE, COLOR_TEXT } from '../../../constants/colors';
import { FONT_FAMILY } from '../../../constants/layout';
import { applyLineDash } from './rendererUtils';
import { hitTestRect } from './hitTesting';

/** Vertical expansion (CSS px) added to hovered bar on each side */
const EXPAND_PX = 3;
/** Lerp speed toward expand target per frame */
const EXPAND_LERP = 0.25;
/** Label background */
const LABEL_BG = 'rgba(19, 23, 34, 0.90)';

// ---------------------------------------------------------------------------
// Color helpers (copied from MarketDepthPrimitive.ts)
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

interface HoveredBarInfo {
  cssAnchorX: number;
  cssCenterY: number;
  volume: number;
}

class FRVPRendererImpl implements IPrimitivePaneRenderer {
  private _drawing: FRVPDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;
  private _volumeMapRef: { current: Map<number, number> };
  private _tickSize: number;
  private _hoverPrice: number | null;
  private _expandMap: Map<number, number>;
  private _requestUpdate: (() => void) | null;

  constructor(
    drawing: FRVPDrawing,
    selected: boolean,
    series: ISeriesApi<SeriesType>,
    chart: IChartApiBase<Time>,
    volumeMapRef: { current: Map<number, number> },
    tickSize: number,
    hoverPrice: number | null,
    expandMap: Map<number, number>,
    requestUpdate: (() => void) | null,
  ) {
    this._drawing = drawing;
    this._selected = selected;
    this._series = series;
    this._chart = chart;
    this._volumeMapRef = volumeMapRef;
    this._tickSize = tickSize;
    this._hoverPrice = hoverPrice;
    this._expandMap = expandMap;
    this._requestUpdate = requestUpdate;
  }

  draw(target: CanvasRenderingTarget2D): void {
    let hoveredBar: HoveredBarInfo | null = null;

    target.useBitmapCoordinateSpace(({ context: ctx, verticalPixelRatio: vpr, horizontalPixelRatio: hpr }) => {
      const cssAnchorX = this._chart.timeScale().timeToCoordinate(this._drawing.anchorTime as unknown as Time);
      const cssPMaxY = this._series.priceToCoordinate(this._drawing.pMax);
      const cssPMinY = this._series.priceToCoordinate(this._drawing.pMin);

      if (cssAnchorX === null || cssPMaxY === null || cssPMinY === null) return;

      const anchorX = cssAnchorX * hpr;
      const topY = Math.min(cssPMaxY, cssPMinY) * vpr;
      const bottomY = Math.max(cssPMaxY, cssPMinY) * vpr;

      if (bottomY - topY < 1) return;

      // In range mode, cap bar width at the pixel distance between t1 and t2
      let maxBarW = Math.min(MAX_BAR_WIDTH_CSS * hpr, ctx.canvas.width * 0.25);
      let cssT2X: number | null = null;
      if (this._drawing.mode === 'range' && this._drawing.t2 !== undefined) {
        cssT2X = this._chart.timeScale().timeToCoordinate(this._drawing.t2 as unknown as Time);
        if (cssT2X !== null) {
          const rangePx = Math.abs(cssT2X - cssAnchorX) * hpr;
          maxBarW = Math.min(maxBarW, rangePx);
        }
      }

      // Range mode: semi-transparent background rect from t1 to t2
      if (this._drawing.mode === 'range' && cssT2X !== null) {
        const t2X = cssT2X * hpr;
        const [r, g, b] = parseColor(this._drawing.color);
        ctx.fillStyle = rgba(r, g, b, 0.08);
        const rectLeft = Math.min(anchorX, t2X);
        const rectRight = Math.max(anchorX, t2X);
        ctx.fillRect(rectLeft, topY, rectRight - rectLeft, bottomY - topY);
      }

      const result = this._drawBars(ctx, anchorX, topY, bottomY, maxBarW, hpr, vpr, this._drawing.highlightOnHover !== false);
      if (result) {
        hoveredBar = { cssAnchorX, cssCenterY: result.bitmapCenterY / vpr, volume: result.volume };
      }

      // Vertical anchor line (t1 only)
      ctx.strokeStyle = this._drawing.color;
      ctx.lineWidth = this._drawing.strokeWidth * hpr;
      applyLineDash(ctx, this._drawing.lineStyle, this._drawing.strokeWidth, Math.min(hpr, vpr));
      ctx.beginPath();
      ctx.moveTo(Math.round(anchorX) + 0.5, topY);
      ctx.lineTo(Math.round(anchorX) + 0.5, bottomY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Selection handles
      if (this._selected) {
        const hr = Math.round(5 * vpr);
        ctx.fillStyle = COLOR_LABEL_TEXT;
        ctx.strokeStyle = COLOR_HANDLE_STROKE;
        ctx.lineWidth = Math.round(1.5 * vpr);

        if (this._drawing.mode === 'range' && cssT2X !== null) {
          // Range mode: handles at t1 and t2 lines, vertically centered
          const midY = (topY + bottomY) / 2;
          for (const hx of [anchorX, cssT2X * hpr]) {
            ctx.beginPath();
            ctx.arc(hx, midY, hr, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
          }
        } else {
          // Anchor mode: handles at top and bottom of the price range
          for (const hy of [topY, bottomY]) {
            ctx.beginPath();
            ctx.arc(anchorX, hy, hr, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
          }
        }
      }
    });

    // Draw value label in media space so font is crisp
    if (hoveredBar && this._drawing.showBarValues) {
      const { cssAnchorX, cssCenterY, volume } = hoveredBar as HoveredBarInfo;
      target.useMediaCoordinateSpace(({ context: ctx }) => {
        const volText = volume >= 1000 ? `${(volume / 1000).toFixed(1)}k` : String(Math.round(volume));
        ctx.font = `11px ${FONT_FAMILY}`;
        const textW = ctx.measureText(volText).width;
        const pad = 5;
        const labelW = textW + pad * 2;
        const labelH = 18;
        const labelX = cssAnchorX + 4;
        const labelY = cssCenterY - labelH / 2;

        ctx.fillStyle = LABEL_BG;
        ctx.beginPath();
        ctx.roundRect(labelX, labelY, labelW, labelH, 3);
        ctx.fill();

        ctx.fillStyle = COLOR_TEXT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(volText, labelX + pad, cssCenterY);
      });
    }
  }

  private _drawBars(
    ctx: CanvasRenderingContext2D,
    anchorX: number,
    topY: number,
    bottomY: number,
    maxBarW: number,
    _hpr: number,
    vpr: number,
    highlightOnHover: boolean,
  ): { bitmapCenterY: number; volume: number } | null {
    const vmap = this._volumeMapRef.current;
    if (vmap.size === 0) return null;

    const pMin = Math.min(this._drawing.pMin, this._drawing.pMax);
    const pMax = Math.max(this._drawing.pMin, this._drawing.pMax);
    const tickSize = this._tickSize > 0 ? this._tickSize : 0.01;
    const isPriceMode = this._drawing.rowSizeMode === 'price' && (this._drawing.rowSizePrice ?? 0) > 0;
    const numBars = (!isPriceMode && this._drawing.numBars && this._drawing.numBars > 1) ? this._drawing.numBars : 0;
    const showPoc = this._drawing.showPoc !== false;
    const pocColor = this._drawing.pocColor ?? COLOR_ACCENT;
    const extendPoc = this._drawing.extendPoc === true;

    const [r, g, b] = parseColor(this._drawing.color);
    const barColor = rgba(r, g, b, 0.45);
    const hoverColor = rgba(r, g, b, 0.75);

    const hoverP = highlightOnHover ? this._hoverPrice : null;

    // pocLine: { y, w } in bitmap pixels — filled during bar loop, drawn after
    let pocLine: { y: number; w: number } | null = null;
    let hoveredResult: { bitmapCenterY: number; volume: number } | null = null;

    let needsAnim = false;

    if (isPriceMode) {
      // ── Price mode: fixed price range per row ──
      const bucketSize = this._drawing.rowSizePrice!;
      const numBucketsCalc = Math.ceil((pMax - pMin) / bucketSize);
      if (numBucketsCalc < 1) return null;
      const buckets = new Float64Array(numBucketsCalc);

      for (const [price, vol] of vmap) {
        if (price < pMin - 1e-9 || price > pMax + 1e-9) continue;
        const idx = Math.min(Math.floor((price - pMin) / bucketSize), numBucketsCalc - 1);
        buckets[idx] += vol;
      }

      let maxVol = 0;
      let pocIdx = 0;
      for (let i = 0; i < numBucketsCalc; i++) {
        if (buckets[i] > maxVol) { maxVol = buckets[i]; pocIdx = i; }
      }
      if (maxVol === 0) return null;

      const hoverIdx = hoverP !== null
        ? Math.min(Math.max(Math.floor((hoverP - pMin) / bucketSize), -1), numBucketsCalc)
        : -1;

      for (let i = 0; i < numBucketsCalc; i++) {
        if (buckets[i] === 0) continue;

        const bucketMidPrice = pMin + (i + 0.5) * bucketSize;
        const cssY = this._series.priceToCoordinate(bucketMidPrice);
        if (cssY === null) continue;

        const cssYLo = this._series.priceToCoordinate(pMin + i * bucketSize);
        const cssYHi = this._series.priceToCoordinate(pMin + (i + 1) * bucketSize);
        const barH = cssYLo !== null && cssYHi !== null
          ? Math.max(Math.abs(cssYHi - cssYLo) * vpr - 1, 1)
          : Math.max((bottomY - topY) / numBucketsCalc - 1, 1);

        const barCenterY = cssY * vpr;
        if (barCenterY < topY - barH || barCenterY > bottomY + barH) continue;

        const isHovered = i === hoverIdx;
        const key = bucketMidPrice;
        const curExpand = this._expandMap.get(key) ?? 0;
        const targetExpand = isHovered ? EXPAND_PX * vpr : 0;
        let expand = curExpand;
        if (Math.abs(curExpand - targetExpand) < 0.3) {
          if (curExpand !== targetExpand) this._expandMap.set(key, targetExpand);
        } else {
          expand = curExpand + (targetExpand - curExpand) * EXPAND_LERP;
          this._expandMap.set(key, expand);
          needsAnim = true;
        }

        const barW = (buckets[i] / maxVol) * maxBarW;
        ctx.fillStyle = isHovered ? hoverColor : barColor;
        ctx.fillRect(anchorX, barCenterY - barH / 2 - expand, barW, barH + expand * 2);

        if (i === pocIdx) pocLine = { y: barCenterY, w: barW };
        if (isHovered) hoveredResult = { bitmapCenterY: barCenterY, volume: buckets[i] };
      }
    } else if (numBars > 0) {
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
      if (maxVol === 0) return null;

      // Determine which bucket index is hovered
      const hoverIdx = hoverP !== null
        ? Math.min(Math.max(Math.floor((hoverP - pMin) / bucketSize), -1), numBars)
        : -1;

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

        const isHovered = i === hoverIdx;
        const key = bucketMidPrice;
        const curExpand = this._expandMap.get(key) ?? 0;
        const targetExpand = isHovered ? EXPAND_PX * vpr : 0;
        let expand = curExpand;
        if (Math.abs(curExpand - targetExpand) < 0.3) {
          if (curExpand !== targetExpand) this._expandMap.set(key, targetExpand);
        } else {
          expand = curExpand + (targetExpand - curExpand) * EXPAND_LERP;
          this._expandMap.set(key, expand);
          needsAnim = true;
        }

        const barW = (buckets[i] / maxVol) * maxBarW;
        ctx.fillStyle = isHovered ? hoverColor : barColor;
        ctx.fillRect(anchorX, barCenterY - barH / 2 - expand, barW, barH + expand * 2);

        if (i === pocIdx) pocLine = { y: barCenterY, w: barW };
        if (isHovered) hoveredResult = { bitmapCenterY: barCenterY, volume: buckets[i] };
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
      if (maxVol === 0 || entries.length === 0) return null;

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

        const isHovered = hoverP !== null && Math.abs(price - hoverP) < tickSize * 0.5 + 1e-9;
        const curExpand = this._expandMap.get(price) ?? 0;
        const targetExpand = isHovered ? EXPAND_PX * vpr : 0;
        let expand = curExpand;
        if (Math.abs(curExpand - targetExpand) < 0.3) {
          if (curExpand !== targetExpand) this._expandMap.set(price, targetExpand);
        } else {
          expand = curExpand + (targetExpand - curExpand) * EXPAND_LERP;
          this._expandMap.set(price, expand);
          needsAnim = true;
        }

        const barW = (vol / maxVol) * maxBarW;
        ctx.fillStyle = isHovered ? hoverColor : barColor;
        ctx.fillRect(anchorX, barCenterY - barH / 2 - expand, barW, barH + expand * 2);

        if (Math.abs(price - pocPrice) < tickSize * 0.5) pocLine = { y: barCenterY, w: barW };
        if (isHovered) hoveredResult = { bitmapCenterY: barCenterY, volume: vol };
      }
    }

    // ── POC line: thin horizontal line centered on the POC bar, drawn on top ──
    if (showPoc && pocLine) {
      ctx.strokeStyle = pocColor;
      ctx.lineWidth = Math.max(Math.round(2 * vpr), 2);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(anchorX, pocLine.y);
      ctx.lineTo(extendPoc ? ctx.canvas.width : anchorX + pocLine.w, pocLine.y);
      ctx.stroke();
    }

    if (needsAnim) this._requestUpdate?.();
    return hoveredResult;
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
  private _hoverPrice: number | null = null;
  private _expandMap: Map<number, number> = new Map();
  private _requestUpdate: (() => void) | null;

  constructor(
    drawing: FRVPDrawing,
    selected: boolean,
    series: ISeriesApi<SeriesType>,
    chart: IChartApiBase<Time>,
    volumeMapRef: { current: Map<number, number> },
    tickSize: number,
    requestUpdate: (() => void) | null = null,
  ) {
    this._drawing = drawing;
    this._selected = selected;
    this._series = series;
    this._chart = chart;
    this._volumeMapRef = volumeMapRef;
    this._tickSize = tickSize;
    this._requestUpdate = requestUpdate;
  }

  /** Called from DrawingsPrimitive on crosshair move. Returns true if changed. */
  setHoverPrice(price: number | null): boolean {
    if (price === this._hoverPrice) return false;
    this._hoverPrice = price;
    return true;
  }

  zOrder(): 'normal' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new FRVPRendererImpl(
      this._drawing, this._selected, this._series, this._chart,
      this._volumeMapRef, this._tickSize,
      this._hoverPrice, this._expandMap, this._requestUpdate,
    );
  }

  hitTest(mouseX: number, mouseY: number): boolean {
    const ax = this._chart.timeScale().timeToCoordinate(this._drawing.anchorTime as unknown as Time);
    const yPMax = this._series.priceToCoordinate(this._drawing.pMax);
    const yPMin = this._series.priceToCoordinate(this._drawing.pMin);
    if (ax === null || yPMax === null || yPMin === null) return false;
    const top = Math.min(yPMax, yPMin);
    const bottom = Math.max(yPMax, yPMin);
    if (this._drawing.mode === 'range' && this._drawing.t2 !== undefined) {
      const t2x = this._chart.timeScale().timeToCoordinate(this._drawing.t2 as unknown as Time);
      if (t2x === null) return false;
      const left = Math.min(ax, t2x) - 6;
      const right = Math.max(ax, t2x) + 6;
      return hitTestRect(mouseX, mouseY, left, top, right, bottom);
    }
    return hitTestRect(mouseX, mouseY, ax - 6, top, ax + MAX_BAR_WIDTH_CSS, bottom);
  }

  hitTestHandle(mx: number, my: number): string | null {
    if (!this._selected) return null;
    const ax = this._chart.timeScale().timeToCoordinate(this._drawing.anchorTime as unknown as Time);
    const yPMax = this._series.priceToCoordinate(this._drawing.pMax);
    const yPMin = this._series.priceToCoordinate(this._drawing.pMin);
    if (ax === null || yPMax === null || yPMin === null) return null;

    const tol = 8;
    if (this._drawing.mode === 'range' && this._drawing.t2 !== undefined) {
      const t2x = this._chart.timeScale().timeToCoordinate(this._drawing.t2 as unknown as Time);
      if (t2x === null) return null;
      const midY = (Math.min(yPMax, yPMin) + Math.max(yPMax, yPMin)) / 2;
      if (Math.abs(mx - ax) <= tol && Math.abs(my - midY) <= tol) return 'w';
      if (Math.abs(mx - t2x) <= tol && Math.abs(my - midY) <= tol) return 'e';
      return null;
    }
    if (Math.abs(mx - ax) <= tol && Math.abs(my - yPMax) <= tol) return 'n';
    if (Math.abs(mx - ax) <= tol && Math.abs(my - yPMin) <= tol) return 's';
    return null;
  }

  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number } | null {
    const ax = this._chart.timeScale().timeToCoordinate(this._drawing.anchorTime as unknown as Time);
    const yPMax = this._series.priceToCoordinate(this._drawing.pMax);
    const yPMin = this._series.priceToCoordinate(this._drawing.pMin);
    if (ax === null || yPMax === null || yPMin === null) return null;
    const top = Math.min(yPMax, yPMin);
    const bottom = Math.max(yPMax, yPMin);
    if (this._drawing.mode === 'range' && this._drawing.t2 !== undefined) {
      const t2x = this._chart.timeScale().timeToCoordinate(this._drawing.t2 as unknown as Time);
      if (t2x !== null) {
        return { x1: Math.min(ax, t2x), y1: top, x2: Math.max(ax, t2x), y2: bottom };
      }
    }
    return { x1: ax, y1: top, x2: ax + MAX_BAR_WIDTH_CSS, y2: bottom };
  }

  get drawingId(): string {
    return this._drawing.id;
  }
}
