import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { RulerDrawing } from '../../../types/drawing';
import { COLOR_LABEL_TEXT, COLOR_BTN_SELL, COLOR_HANDLE_STROKE } from '../../../constants/colors';
import { FONT_FAMILY } from '../../../constants/layout';
import { hitTestRect } from './hitTesting';
import { formatVolume } from './rulerMetrics';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

class RulerRendererImpl implements IPrimitivePaneRenderer {
  private _drawing: RulerDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;
  private _decimals: number;

  constructor(
    drawing: RulerDrawing,
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
    target.useBitmapCoordinateSpace(({ context: ctx, verticalPixelRatio: vpr, horizontalPixelRatio: hpr, bitmapSize }) => {
      const cssX1 = this._chart.timeScale().timeToCoordinate(this._drawing.p1.time as unknown as Time);
      const cssY1 = this._series.priceToCoordinate(this._drawing.p1.price);
      const cssX2 = this._chart.timeScale().timeToCoordinate(this._drawing.p2.time as unknown as Time);
      const cssY2 = this._series.priceToCoordinate(this._drawing.p2.price);

      if (cssX1 === null || cssY1 === null || cssX2 === null || cssY2 === null) return;

      const x1 = cssX1 * hpr;
      const y1 = cssY1 * vpr;
      const x2 = cssX2 * hpr;
      const y2 = cssY2 * vpr;

      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);

      if (w < 1 && h < 1) return;

      // Determine color based on direction
      const isNegative = this._drawing.metrics.priceChange < 0;
      const rectColor = isNegative ? '#d32f2f' : this._drawing.color;
      const labelColor = isNegative ? COLOR_BTN_SELL : this._drawing.color;
      const { r: rr, g: rg, b: rb } = hexToRgb(rectColor);
      const { r: lr, g: lg, b: lb } = hexToRgb(labelColor);

      // Semi-transparent filled rectangle (no border)
      ctx.fillStyle = `rgba(${rr}, ${rg}, ${rb}, 0.25)`;
      ctx.fillRect(left, top, w, h);

      // Crossing single-direction arrows inside rectangle (touching edges)
      const arrowColor = `rgba(${rr}, ${rg}, ${rb}, 0.5)`;
      const headSize = Math.round(5 * vpr);
      const cx = left + w / 2;
      const cy = top + h / 2;

      ctx.strokeStyle = arrowColor;
      ctx.fillStyle = arrowColor;
      ctx.lineWidth = Math.round(1.5 * vpr);

      // Vertical arrow: up for positive, down for negative
      if (h > headSize * 3) {
        ctx.beginPath();
        ctx.moveTo(cx, top);
        ctx.lineTo(cx, top + h);
        ctx.stroke();
        // Arrowhead at tip
        if (isNegative) {
          // Points down (bottom edge)
          ctx.beginPath();
          ctx.moveTo(cx, top + h);
          ctx.lineTo(cx - headSize, top + h - headSize);
          ctx.lineTo(cx + headSize, top + h - headSize);
          ctx.closePath();
          ctx.fill();
        } else {
          // Points up (top edge)
          ctx.beginPath();
          ctx.moveTo(cx, top);
          ctx.lineTo(cx - headSize, top + headSize);
          ctx.lineTo(cx + headSize, top + headSize);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Horizontal arrow: always left to right (time direction)
      if (w > headSize * 3) {
        ctx.beginPath();
        ctx.moveTo(left, cy);
        ctx.lineTo(left + w, cy);
        ctx.stroke();
        // Arrowhead at right edge
        ctx.beginPath();
        ctx.moveTo(left + w, cy);
        ctx.lineTo(left + w - headSize, cy - headSize);
        ctx.lineTo(left + w - headSize, cy + headSize);
        ctx.closePath();
        ctx.fill();
      }

      // Selection handles at 4 corners
      if (this._selected) {
        const hr = Math.round(5 * vpr);
        const handles = [
          [left, top],
          [left + w, top],
          [left, top + h],
          [left + w, top + h],
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

      // Label box above top edge
      const m = this._drawing.metrics;
      const decimals = this._decimals;

      const priceStr = m.priceChange >= 0
        ? `+${m.priceChange.toFixed(decimals)}`
        : m.priceChange.toFixed(decimals);
      const pctStr = m.pctChange >= 0
        ? `(+${m.pctChange.toFixed(2)}%)`
        : `(${m.pctChange.toFixed(2)}%)`;
      const line1 = `${priceStr} ${pctStr}`;
      const line2 = `${m.barCount} bars, ${m.timeSpan}`;
      const line3 = `Vol ${formatVolume(m.volumeSum)}`;

      const fontFamily = FONT_FAMILY;
      const fontSize = Math.round(12 * vpr);
      const lineHeight = Math.round(fontSize * 1.35);
      const padH = Math.round(8 * hpr);
      const padV = Math.round(5 * vpr);

      const boldFont = `bold ${fontSize}px ${fontFamily}`;
      const normalFont = `${fontSize}px ${fontFamily}`;
      ctx.font = boldFont;
      const w1 = ctx.measureText(line1).width;
      ctx.font = normalFont;
      const w2 = ctx.measureText(line2).width;
      const w3 = ctx.measureText(line3).width;
      const maxTextW = Math.max(w1, w2, w3);

      const boxW = maxTextW + padH * 2;
      const boxH = lineHeight * 3 + padV * 2;
      const boxX = left + w / 2 - boxW / 2;

      // Position above top edge, or below bottom edge if not enough room
      const gap = Math.round(6 * vpr);
      let boxY = top - boxH - gap;
      if (boxY < 0) boxY = top + h + gap;

      // Background with rounded corners
      const radius = Math.round(4 * vpr);
      ctx.fillStyle = `rgba(${lr}, ${lg}, ${lb}, 0.85)`;
      ctx.beginPath();
      ctx.moveTo(boxX + radius, boxY);
      ctx.lineTo(boxX + boxW - radius, boxY);
      ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + radius);
      ctx.lineTo(boxX + boxW, boxY + boxH - radius);
      ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - radius, boxY + boxH);
      ctx.lineTo(boxX + radius, boxY + boxH);
      ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - radius);
      ctx.lineTo(boxX, boxY + radius);
      ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
      ctx.closePath();
      ctx.fill();

      // Text lines
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const textX = boxX + boxW / 2;
      const textStartY = boxY + padV;

      // Line 1: price change — white (bold)
      ctx.font = boldFont;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line1, textX, textStartY);

      // Line 2: bars + time span — white (normal)
      ctx.font = normalFont;
      ctx.fillText(line2, textX, textStartY + lineHeight);

      // Line 3: volume — white (normal)
      ctx.fillText(line3, textX, textStartY + lineHeight * 2);
    });
  }
}

export class RulerPaneView implements IPrimitivePaneView {
  private _drawing: RulerDrawing;
  private _selected: boolean;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;
  private _decimals: number;

  constructor(
    drawing: RulerDrawing,
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

  zOrder(): 'normal' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new RulerRendererImpl(this._drawing, this._selected, this._series, this._chart, this._decimals);
  }

  hitTest(mouseX: number, mouseY: number): boolean {
    const x1 = this._chart.timeScale().timeToCoordinate(this._drawing.p1.time as unknown as Time);
    const y1 = this._series.priceToCoordinate(this._drawing.p1.price);
    const x2 = this._chart.timeScale().timeToCoordinate(this._drawing.p2.time as unknown as Time);
    const y2 = this._series.priceToCoordinate(this._drawing.p2.price);

    if (x1 === null || y1 === null || x2 === null || y2 === null) return false;

    return hitTestRect(mouseX, mouseY, x1, y1, x2, y2);
  }

  hitTestHandle(mx: number, my: number): string | null {
    if (!this._selected) return null;

    const x1 = this._chart.timeScale().timeToCoordinate(this._drawing.p1.time as unknown as Time);
    const y1 = this._series.priceToCoordinate(this._drawing.p1.price);
    const x2 = this._chart.timeScale().timeToCoordinate(this._drawing.p2.time as unknown as Time);
    const y2 = this._series.priceToCoordinate(this._drawing.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

    const tol = 6;
    const handles: [number, number, string][] = [
      [x1, y1, 'nw'],
      [x2, y1, 'ne'],
      [x1, y2, 'sw'],
      [x2, y2, 'se'],
    ];

    for (const [hx, hy, id] of handles) {
      if (Math.abs(mx - hx) <= tol && Math.abs(my - hy) <= tol) return id;
    }
    return null;
  }

  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number } | null {
    const x1 = this._chart.timeScale().timeToCoordinate(this._drawing.p1.time as unknown as Time);
    const y1 = this._series.priceToCoordinate(this._drawing.p1.price);
    const x2 = this._chart.timeScale().timeToCoordinate(this._drawing.p2.time as unknown as Time);
    const y2 = this._series.priceToCoordinate(this._drawing.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
  }

  get drawingData(): { p1: { time: number; price: number }; p2: { time: number; price: number } } {
    return { p1: this._drawing.p1, p2: this._drawing.p2 };
  }

  get drawingId(): string {
    return this._drawing.id;
  }
}
