import type {
  ISeriesApi,
  IChartApiBase,
  SeriesType,
  Time,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  PrimitiveHoveredItem,
  IPrimitivePaneRenderer,
  ISeriesPrimitiveAxisView,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { ISeriesPrimitive } from 'lightweight-charts';
import type { Drawing, FRVPDrawing, RulerMetrics } from '../../../types/drawing';
import type { Bar } from '../../../services/marketDataService';
import { COLOR_TEXT_MUTED, COLOR_LABEL_TEXT, COLOR_HANDLE_STROKE } from '../../../constants/colors';
import { FONT_FAMILY } from '../../../constants/layout';
import { HLinePaneView } from './HLineRenderer';
import { OvalPaneView } from './OvalRenderer';
import { ArrowPathPaneView } from './ArrowPathRenderer';
import { RulerPaneView } from './RulerRenderer';
import { FreeDrawPaneView } from './FreeDrawRenderer';
import { RectPaneView } from './RectRenderer';
import { MarkerPaneView } from './MarkerRenderer';
import { FRVPPaneView } from './FRVPRenderer';
import { formatVolume } from './rulerMetrics';

// ---------------------------------------------------------------------------
// Drag-preview renderer: live oval preview during oval drag creation
// ---------------------------------------------------------------------------
class DragPreviewRenderer implements IPrimitivePaneRenderer {
  private _x1: number;
  private _y1: number;
  private _x2: number;
  private _y2: number;
  private _fillColor: string;

  constructor(x1: number, y1: number, x2: number, y2: number, fillColor: string) {
    this._x1 = x1;
    this._y1 = y1;
    this._x2 = x2;
    this._y2 = y2;
    this._fillColor = fillColor;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const cx = (this._x1 + this._x2) / 2;
      const cy = (this._y1 + this._y2) / 2;
      const rx = Math.abs(this._x2 - this._x1) / 2;
      const ry = Math.abs(this._y2 - this._y1) / 2;

      if (rx < 1 || ry < 1) return;

      // Draw the ellipse preview
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);

      if (this._fillColor) {
        ctx.fillStyle = this._fillColor;
        ctx.fill();
      }

      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Cardinal handles
      const handles = [[cx, cy - ry], [cx, cy + ry], [cx - rx, cy], [cx + rx, cy]];
      ctx.fillStyle = COLOR_LABEL_TEXT;
      ctx.strokeStyle = COLOR_HANDLE_STROKE;
      ctx.lineWidth = 1.5;
      for (const [hx, hy] of handles) {
        ctx.beginPath();
        ctx.arc(hx, hy, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    });
  }
}

class DragPreviewPaneView implements IPrimitivePaneView {
  private _x1: number;
  private _y1: number;
  private _x2: number;
  private _y2: number;
  private _fillColor: string;

  constructor(x1: number, y1: number, x2: number, y2: number, fillColor: string) {
    this._x1 = x1;
    this._y1 = y1;
    this._x2 = x2;
    this._y2 = y2;
    this._fillColor = fillColor;
  }

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new DragPreviewRenderer(this._x1, this._y1, this._x2, this._y2, this._fillColor);
  }
}

// ---------------------------------------------------------------------------
// Rect preview renderer: live rectangle preview during rect click-click creation
// ---------------------------------------------------------------------------
class RectPreviewRenderer implements IPrimitivePaneRenderer {
  private _x1: number;
  private _y1: number;
  private _x2: number;
  private _y2: number;
  private _color: string;
  private _fillColor: string;
  private _strokeWidth: number;

  constructor(x1: number, y1: number, x2: number, y2: number, color: string, fillColor: string, strokeWidth: number) {
    this._x1 = x1;
    this._y1 = y1;
    this._x2 = x2;
    this._y2 = y2;
    this._color = color;
    this._fillColor = fillColor;
    this._strokeWidth = strokeWidth;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, verticalPixelRatio: vpr, horizontalPixelRatio: hpr }) => {
      const rawLeft = Math.min(this._x1, this._x2) * hpr;
      const rawTop = Math.min(this._y1, this._y2) * vpr;
      const rawW = Math.abs(this._x2 - this._x1) * hpr;
      const rawH = Math.abs(this._y2 - this._y1) * vpr;

      if (rawW < 1 && rawH < 1) return;

      ctx.fillStyle = this._fillColor;
      ctx.fillRect(rawLeft, rawTop, rawW, rawH);

      // Snap edges to pixel grid + 0.5 offset for crisp lines
      const left = Math.round(rawLeft) + 0.5;
      const top = Math.round(rawTop) + 0.5;
      const right = Math.round(rawLeft + rawW) + 0.5;
      const bottom = Math.round(rawTop + rawH) + 0.5;
      ctx.strokeStyle = this._color;
      ctx.lineWidth = this._strokeWidth;
      ctx.strokeRect(left, top, right - left, bottom - top);

      // Corner handles
      const hr = Math.round(5 * vpr);
      const handles = [[left, top], [right, top], [left, bottom], [right, bottom]];
      ctx.fillStyle = COLOR_LABEL_TEXT;
      ctx.strokeStyle = COLOR_HANDLE_STROKE;
      ctx.lineWidth = Math.round(1.5 * vpr);
      for (const [hx, hy] of handles) {
        ctx.beginPath();
        ctx.arc(hx, hy, hr, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    });
  }
}

class RectPreviewPaneView implements IPrimitivePaneView {
  private _x1: number;
  private _y1: number;
  private _x2: number;
  private _y2: number;
  private _color: string;
  private _fillColor: string;
  private _strokeWidth: number;

  constructor(x1: number, y1: number, x2: number, y2: number, color: string, fillColor: string, strokeWidth: number) {
    this._x1 = x1;
    this._y1 = y1;
    this._x2 = x2;
    this._y2 = y2;
    this._color = color;
    this._fillColor = fillColor;
    this._strokeWidth = strokeWidth;
  }

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new RectPreviewRenderer(this._x1, this._y1, this._x2, this._y2, this._color, this._fillColor, this._strokeWidth);
  }
}

// ---------------------------------------------------------------------------
// Arrow-path preview renderer: live polyline+arrow preview during creation
// ---------------------------------------------------------------------------
class ArrowPathPreviewRenderer implements IPrimitivePaneRenderer {
  private _points: { x: number; y: number }[];

  constructor(points: { x: number; y: number }[]) {
    this._points = points;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const pts = this._points;
      if (pts.length < 2) return;

      // Polyline
      ctx.beginPath();
      ctx.strokeStyle = '#f7c948';
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();

      // Arrowhead on last segment
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const dx = last.x - prev.x;
      const dy = last.y - prev.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      if (segLen > 1) {
        const arrowSize = Math.min(segLen * 0.4, 10);
        const angle = Math.atan2(dy, dx);
        const halfAngle = 0.70;
        ctx.beginPath();
        ctx.moveTo(last.x - arrowSize * Math.cos(angle - halfAngle), last.y - arrowSize * Math.sin(angle - halfAngle));
        ctx.lineTo(last.x, last.y);
        ctx.lineTo(last.x - arrowSize * Math.cos(angle + halfAngle), last.y - arrowSize * Math.sin(angle + halfAngle));
        ctx.strokeStyle = '#f7c948';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // Node handles at placed points (all except the last which is the cursor)
      ctx.fillStyle = COLOR_LABEL_TEXT;
      ctx.strokeStyle = COLOR_HANDLE_STROKE;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < pts.length - 1; i++) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    });
  }
}

class ArrowPathPreviewPaneView implements IPrimitivePaneView {
  private _points: { x: number; y: number }[];

  constructor(points: { x: number; y: number }[]) {
    this._points = points;
  }

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new ArrowPathPreviewRenderer(this._points);
  }
}

// ---------------------------------------------------------------------------
// Ruler drag-preview renderer: live rectangle preview during ruler creation
// ---------------------------------------------------------------------------
class RulerDragPreviewRenderer implements IPrimitivePaneRenderer {
  private _x1: number;
  private _y1: number;
  private _x2: number;
  private _y2: number;
  private _metrics: RulerMetrics | null;
  private _decimals: number;

  constructor(x1: number, y1: number, x2: number, y2: number, metrics: RulerMetrics | null, decimals: number) {
    this._x1 = x1;
    this._y1 = y1;
    this._x2 = x2;
    this._y2 = y2;
    this._metrics = metrics;
    this._decimals = decimals;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const left = Math.min(this._x1, this._x2);
      const top = Math.min(this._y1, this._y2);
      const w = Math.abs(this._x2 - this._x1);
      const h = Math.abs(this._y2 - this._y1);

      if (w < 1 && h < 1) return;

      // Determine color based on direction
      const m = this._metrics;
      const isNegative = m ? m.priceChange < 0 : false;
      const rectRgb = isNegative ? '211, 47, 47' : '41, 98, 255'; // #d32f2f or #2962ff
      const labelRgb = isNegative ? '139, 34, 50' : '41, 98, 255'; // #8b2232 or #2962ff

      // Semi-transparent filled rectangle (no border)
      ctx.fillStyle = `rgba(${rectRgb}, 0.25)`;
      ctx.fillRect(left, top, w, h);

      // Crossing single-direction arrows inside rectangle (touching edges)
      const arrowColor = `rgba(${rectRgb}, 0.5)`;
      const headSize = 5;
      const cx = left + w / 2;
      const cy = top + h / 2;

      ctx.strokeStyle = arrowColor;
      ctx.fillStyle = arrowColor;
      ctx.lineWidth = 1.5;

      // Vertical arrow: up for positive, down for negative
      if (h > headSize * 3) {
        ctx.beginPath();
        ctx.moveTo(cx, top);
        ctx.lineTo(cx, top + h);
        ctx.stroke();
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

      // Label box with metrics
      if (!m) return;

      const priceStr = m.priceChange >= 0
        ? `+${m.priceChange.toFixed(this._decimals)}`
        : m.priceChange.toFixed(this._decimals);
      const pctStr = m.pctChange >= 0
        ? `(+${m.pctChange.toFixed(2)}%)`
        : `(${m.pctChange.toFixed(2)}%)`;
      const line1 = `${priceStr} ${pctStr}`;
      const line2 = `${m.barCount} bars, ${m.timeSpan}`;
      const line3 = `Vol ${formatVolume(m.volumeSum)}`;

      const fontFamily = FONT_FAMILY;
      const fontSize = 12;
      const lineHeight = Math.round(fontSize * 1.35);
      const padH = 8;
      const padV = 5;

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

      const gap = 6;
      let boxY = top - boxH - gap;
      if (boxY < 0) boxY = top + h + gap;

      // Background with rounded corners
      const radius = 4;
      ctx.fillStyle = `rgba(${labelRgb}, 0.85)`;
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

class RulerDragPreviewPaneView implements IPrimitivePaneView {
  private _x1: number;
  private _y1: number;
  private _x2: number;
  private _y2: number;
  private _metrics: RulerMetrics | null;
  private _decimals: number;

  constructor(x1: number, y1: number, x2: number, y2: number, metrics: RulerMetrics | null, decimals: number) {
    this._x1 = x1;
    this._y1 = y1;
    this._x2 = x2;
    this._y2 = y2;
    this._metrics = metrics;
    this._decimals = decimals;
  }

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new RulerDragPreviewRenderer(this._x1, this._y1, this._x2, this._y2, this._metrics, this._decimals);
  }
}

// ---------------------------------------------------------------------------
// Free draw preview renderer: live brush stroke preview during creation
// ---------------------------------------------------------------------------
class FreeDrawPreviewRenderer implements IPrimitivePaneRenderer {
  private _points: { x: number; y: number }[];
  private _color: string;
  private _strokeWidth: number;

  constructor(points: { x: number; y: number }[], color: string, strokeWidth: number) {
    this._points = points;
    this._color = color;
    this._strokeWidth = strokeWidth;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const pts = this._points;
      if (pts.length < 2) return;

      ctx.beginPath();
      ctx.strokeStyle = this._color;
      ctx.lineWidth = this._strokeWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    });
  }
}

class FreeDrawPreviewPaneView implements IPrimitivePaneView {
  private _points: { x: number; y: number }[];
  private _color: string;
  private _strokeWidth: number;

  constructor(points: { x: number; y: number }[], color: string, strokeWidth: number) {
    this._points = points;
    this._color = color;
    this._strokeWidth = strokeWidth;
  }

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new FreeDrawPreviewRenderer(this._points, this._color, this._strokeWidth);
  }
}

// ---------------------------------------------------------------------------
// FRVP creation preview: dashed vertical line with endpoint handles
// ---------------------------------------------------------------------------
class FRVPPreviewRenderer implements IPrimitivePaneRenderer {
  private _x: number;
  private _y1: number;
  private _y2: number;
  private _color: string;

  constructor(x: number, y1: number, y2: number, color: string) {
    this._x = x;
    this._y1 = y1;
    this._y2 = y2;
    this._color = color;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const top = Math.min(this._y1, this._y2);
      const bottom = Math.max(this._y1, this._y2);
      if (bottom - top < 1) return;

      ctx.strokeStyle = this._color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(this._x, top);
      ctx.lineTo(this._x, bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = COLOR_LABEL_TEXT;
      ctx.strokeStyle = COLOR_HANDLE_STROKE;
      ctx.lineWidth = 1.5;
      for (const hy of [top, bottom]) {
        ctx.beginPath();
        ctx.arc(this._x, hy, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    });
  }
}

class FRVPPreviewPaneView implements IPrimitivePaneView {
  private _x: number;
  private _y1: number;
  private _y2: number;
  private _color: string;

  constructor(x: number, y1: number, y2: number, color: string) {
    this._x = x;
    this._y1 = y1;
    this._y2 = y2;
    this._color = color;
  }

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new FRVPPreviewRenderer(this._x, this._y1, this._y2, this._color);
  }
}

// ---------------------------------------------------------------------------
// FRVP range creation preview: two dashed vertical lines with shaded fill
// ---------------------------------------------------------------------------
class FRVPRangePreviewRenderer implements IPrimitivePaneRenderer {
  private _x1: number;
  private _y1: number;
  private _x2: number;
  private _y2: number;
  private _color: string;

  constructor(x1: number, y1: number, x2: number, y2: number, color: string) {
    this._x1 = x1;
    this._y1 = y1;
    this._x2 = x2;
    this._y2 = y2;
    this._color = color;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const { _x1: x1, _y1: y1, _x2: x2, _y2: y2 } = this;

      ctx.strokeStyle = this._color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Endpoint dots
      ctx.fillStyle = this._color;
      for (const [x, y] of [[x1, y1], [x2, y2]] as [number, number][]) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  }
}

class FRVPRangePreviewPaneView implements IPrimitivePaneView {
  private _x1: number;
  private _y1: number;
  private _x2: number;
  private _y2: number;
  private _color: string;

  constructor(x1: number, y1: number, x2: number, y2: number, color: string) {
    this._x1 = x1;
    this._y1 = y1;
    this._x2 = x2;
    this._y2 = y2;
    this._color = color;
  }

  zOrder(): 'top' { return 'top'; }

  renderer(): IPrimitivePaneRenderer | null {
    return new FRVPRangePreviewRenderer(this._x1, this._y1, this._x2, this._y2, this._color);
  }
}

// ---------------------------------------------------------------------------
// Selection rectangle renderer: dashed rectangle during Ctrl+drag multi-select
// ---------------------------------------------------------------------------
class SelectionRectRenderer implements IPrimitivePaneRenderer {
  private _x1: number;
  private _y1: number;
  private _x2: number;
  private _y2: number;

  constructor(x1: number, y1: number, x2: number, y2: number) {
    this._x1 = x1;
    this._y1 = y1;
    this._x2 = x2;
    this._y2 = y2;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const left = Math.min(this._x1, this._x2);
      const top = Math.min(this._y1, this._y2);
      const w = Math.abs(this._x2 - this._x1);
      const h = Math.abs(this._y2 - this._y1);
      if (w < 1 && h < 1) return;

      // Semi-transparent fill
      ctx.fillStyle = 'rgba(41, 98, 255, 0.08)';
      ctx.fillRect(left, top, w, h);

      // Dashed border
      ctx.strokeStyle = 'rgba(41, 98, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(left, top, w, h);
      ctx.setLineDash([]);
    });
  }
}

class SelectionRectPaneView implements IPrimitivePaneView {
  private _x1: number;
  private _y1: number;
  private _x2: number;
  private _y2: number;

  constructor(x1: number, y1: number, x2: number, y2: number) {
    this._x1 = x1;
    this._y1 = y1;
    this._x2 = x2;
    this._y2 = y2;
  }

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new SelectionRectRenderer(this._x1, this._y1, this._x2, this._y2);
  }
}

// ---------------------------------------------------------------------------
// Price axis label for drawings (shows price on the right Y-axis scale)
// ---------------------------------------------------------------------------
function contrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Perceived brightness (ITU-R BT.709)
  return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? COLOR_LABEL_TEXT : '#ffffff';
}

class DrawingPriceAxisView implements ISeriesPrimitiveAxisView {
  _coordinate = 0;
  _text = '';
  _color = COLOR_TEXT_MUTED;
  _selected = false;

  update(coordinate: number, text: string, color: string, selected: boolean): void {
    this._coordinate = coordinate;
    this._text = text;
    this._color = color;
    this._selected = selected;
  }

  coordinate(): number { return this._coordinate; }
  text(): string { return this._text; }
  textColor(): string { return contrastTextColor(this._color); }
  backColor(): string { return this._color; }
  visible(): boolean { return !this._selected; }
  tickVisible(): boolean { return true; }
}

// Custom renderer for the selected drawing's price label (draws on top of everything)
class SelectedDrawingAxisRenderer implements IPrimitivePaneRenderer {
  private _text: string;
  private _y: number;
  private _bgColor: string;
  private _textColor: string;

  constructor(text: string, y: number, bgColor: string, textColor: string) {
    this._text = text;
    this._y = y;
    this._bgColor = bgColor;
    this._textColor = textColor;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const fontSize = 12;
      const vPad = 3;
      const totalHeight = fontSize + vPad * 2;
      const top = this._y - totalHeight / 2;

      ctx.fillStyle = this._bgColor;
      ctx.fillRect(0, top, mediaSize.width, totalHeight);

      ctx.fillStyle = this._textColor;
      ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(this._text, mediaSize.width / 2, top + vPad);
    });
  }
}

class SelectedDrawingAxisPaneView implements IPrimitivePaneView {
  _text = '';
  _y = 0;
  _bgColor = COLOR_TEXT_MUTED;
  _textColor = '#ffffff';

  update(text: string, y: number, bgColor: string, textColor: string): void {
    this._text = text;
    this._y = y;
    this._bgColor = bgColor;
    this._textColor = textColor;
  }

  renderer(): IPrimitivePaneRenderer {
    return new SelectedDrawingAxisRenderer(this._text, this._y, this._bgColor, this._textColor);
  }

  zOrder(): string {
    return 'top';
  }
}

// ---------------------------------------------------------------------------
// Main DrawingsPrimitive
// ---------------------------------------------------------------------------
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApiBase<Time> | null = null;
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;

  private _drawings: Drawing[] = [];
  private _selectedIds: string[] = [];
  private _paneViews: (HLinePaneView | RectPaneView | OvalPaneView | ArrowPathPaneView | RulerPaneView | FreeDrawPaneView | FRVPPaneView)[] = [];

  // Shared VP VolumeMap ref for FRVP anchor-mode drawings
  private _sharedVolumeMap: { current: Map<number, number> } = { current: new Map() };
  // Per-drawing volume maps for range-mode FRVP drawings (keyed by drawing ID)
  private _rangeVolumeMaps: Map<string, { current: Map<number, number> }> = new Map();
  // Raw bars for range-mode volume computation
  private _barsRef: Bar[] = [];
  private _tickSize = 0.01;

  // Drag preview (oval creation)
  private _dragPreview: DragPreviewPaneView | null = null;

  // Rect creation preview
  private _rectPreview: RectPreviewPaneView | null = null;

  // Arrow path creation preview
  private _arrowPathPreview: ArrowPathPreviewPaneView | null = null;

  // Ruler drag preview
  private _rulerDragPreview: RulerDragPreviewPaneView | null = null;

  // Free draw creation preview
  private _freeDrawPreview: FreeDrawPreviewPaneView | null = null;

  // FRVP creation preview (anchor mode: vertical drag)
  private _frvpPreview: FRVPPreviewPaneView | null = null;

  // FRVP creation preview (range mode: horizontal drag)
  private _frvpRangePreview: FRVPRangePreviewPaneView | null = null;

  // Latest bar time — used to resolve t2Auto for range FRVPs
  private _lastBarTime = 0;

  // Price axis labels for drawings
  private _decimals = 2;
  private _priceAxisTextCache = new Map<string, string>();
  private _priceAxisViewPool: DrawingPriceAxisView[] = [];
  private _emptyAxisViews: readonly ISeriesPrimitiveAxisView[] = [];
  private _selectedAxisPaneView = new SelectedDrawingAxisPaneView();
  private _selectedAxisPaneViewArr: readonly IPrimitivePaneView[] = [this._selectedAxisPaneView];
  private _emptyPaneViews: readonly IPrimitivePaneView[] = [];
  /** Cached de-overlapped Y for the selected hline (set in priceAxisViews) */
  private _selectedHLineAxisY: number | null = null;
  /** Current price from the countdown label — drawing labels avoid this zone */
  private _countdownPrice: number | null = null;

  /** When false, paneViews() returns empty — used to exclude drawings from screenshots */
  visible = true;

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._priceAxisViewPool = [];
  }

  // Selection rectangle preview
  private _selectionRect: SelectionRectPaneView | null = null;

  /** Called by React when store drawings change */
  setDrawings(drawings: Drawing[], selectedIds: string[]): void {
    this._drawings = drawings;
    this._selectedIds = selectedIds;
    this._rebuildViews();
    this._requestUpdate?.();
  }

  /** Feed current price so drawing labels can avoid the countdown label zone */
  setCountdownPrice(price: number | null): void {
    this._countdownPrice = price;
  }

  /** Update decimal places for price formatting (call when contract changes) */
  setDecimals(decimals: number): void {
    this._decimals = decimals;
  }

  /** Pass the live VolumeMap reference from VolumeProfilePrimitive for FRVP drawings */
  setSharedVolumeMap(map: Map<number, number>): void {
    this._sharedVolumeMap.current = map;
  }

  /** Update tick size for FRVP bar sizing (call when contract changes) */
  setTickSize(tickSize: number): void {
    this._tickSize = tickSize > 0 ? tickSize : 0.01;
  }

  /** Called when a range-mode FRVP's auto-computed bounds differ from the stored values */
  private _onRangeBoundsUpdate: ((id: string, pMin: number, pMax: number) => void) | null = null;
  /** Tracks last synced bounds per drawing to prevent infinite microtask loop */
  private _lastSyncedBounds = new Map<string, { pMin: number; pMax: number }>();

  /** Register a callback to sync auto-computed range bounds back to the store */
  setOnRangeBoundsUpdate(cb: (id: string, pMin: number, pMax: number) => void): void {
    this._onRangeBoundsUpdate = cb;
  }

  /** Feed raw bars for range-mode FRVP volume computation */
  setBarsRef(bars: Bar[]): void {
    this._barsRef = bars;
    const hasRange = this._drawings.some((d) => d.type === 'frvp' && (d as FRVPDrawing).mode === 'range');
    if (hasRange) {
      this._rebuildViews();
      this._requestUpdate?.();
    }
  }

  /** Single-pass: build volume map AND compute pMin/pMax from bars in [t1, t2]. */
  private _buildRangeData(t1: number, t2: number, tickSize: number): { volumeMap: Map<number, number>; pMin: number; pMax: number } | null {
    const ts = tickSize > 0 ? tickSize : 0.01;
    const tMin = Math.min(t1, t2);
    const tMax = Math.max(t1, t2);
    const map = new Map<number, number>();
    let pMin = Infinity, pMax = -Infinity;
    for (const bar of this._barsRef) {
      const barTime = Math.floor(new Date(bar.t).getTime() / 1000);
      if (barTime < tMin || barTime > tMax) continue;
      if (bar.l < pMin) pMin = bar.l;
      if (bar.h > pMax) pMax = bar.h;
      if (bar.v <= 0 || bar.h < bar.l) continue;
      const lowIdx = Math.round(bar.l / ts);
      const highIdx = Math.round(bar.h / ts);
      const numTicks = Math.max(highIdx - lowIdx + 1, 1);
      const volPerTick = bar.v / numTicks;
      for (let i = lowIdx; i <= highIdx; i++) {
        const price = i * ts;
        map.set(price, (map.get(price) ?? 0) + volPerTick);
      }
    }
    return pMin <= pMax ? { volumeMap: map, pMin, pMax } : null;
  }

  /** Compute pMin/pMax from bars in [t1, t2]. Returns null if no bars in range. */
  computeRangeBounds(t1: number, t2: number): { pMin: number; pMax: number } | null {
    const tMin = Math.min(t1, t2);
    const tMax = Math.max(t1, t2);
    let pMin = Infinity, pMax = -Infinity;
    for (const bar of this._barsRef) {
      const barTime = Math.floor(new Date(bar.t).getTime() / 1000);
      if (barTime < tMin || barTime > tMax) continue;
      if (bar.l < pMin) pMin = bar.l;
      if (bar.h > pMax) pMax = bar.h;
    }
    return pMin <= pMax ? { pMin, pMax } : null;
  }

  /** Show a diagonal line preview during range-mode FRVP drag creation */
  setFRVPRangePreview(x1: number, y1: number, x2: number, y2: number, color: string): void {
    this._frvpRangePreview = new FRVPRangePreviewPaneView(x1, y1, x2, y2, color);
    this._requestUpdate?.();
  }

  /** Clear the range-mode FRVP creation preview */
  clearFRVPRangePreview(): void {
    this._frvpRangePreview = null;
    this._requestUpdate?.();
  }

  /** Track latest bar time for t2Auto resolution in range FRVPs */
  setLastBarTime(t: number): void {
    this._lastBarTime = t;
    this._rebuildViews();
    this._requestUpdate?.();
  }

  /** Forward hover price to all FRVP pane views for bar highlight + label */
  setFRVPHoverPrice(price: number | null): void {
    let changed = false;
    for (const v of this._paneViews) {
      if (v instanceof FRVPPaneView) {
        if (v.setHoverPrice(price)) changed = true;
      }
    }
    if (changed) this._requestUpdate?.();
  }

  /** Show a dashed line during oval drag creation */
  setDragPreview(x1: number, y1: number, x2: number, y2: number, fillColor: string = ''): void {
    this._dragPreview = new DragPreviewPaneView(x1, y1, x2, y2, fillColor);
    this._requestUpdate?.();
  }

  /** Clear the drag preview */
  clearDragPreview(): void {
    this._dragPreview = null;
    this._requestUpdate?.();
  }

  /** Show a solid rect preview during rect click-click creation */
  setRectPreview(x1: number, y1: number, x2: number, y2: number, color: string, fillColor: string, strokeWidth: number): void {
    this._rectPreview = new RectPreviewPaneView(x1, y1, x2, y2, color, fillColor, strokeWidth);
    this._requestUpdate?.();
  }

  /** Clear the rect preview */
  clearRectPreview(): void {
    this._rectPreview = null;
    this._requestUpdate?.();
  }

  /** Show a polyline+arrow preview during arrow path creation */
  setArrowPathPreview(cssPoints: { x: number; y: number }[]): void {
    this._arrowPathPreview = new ArrowPathPreviewPaneView(cssPoints);
    this._requestUpdate?.();
  }

  /** Clear the arrow path preview */
  clearArrowPathPreview(): void {
    this._arrowPathPreview = null;
    this._requestUpdate?.();
  }

  /** Show a rectangle preview during ruler drag creation */
  setRulerDragPreview(x1: number, y1: number, x2: number, y2: number, metrics: RulerMetrics | null = null, decimals = 2): void {
    this._rulerDragPreview = new RulerDragPreviewPaneView(x1, y1, x2, y2, metrics, decimals);
    this._requestUpdate?.();
  }

  /** Clear the ruler drag preview */
  clearRulerDragPreview(): void {
    this._rulerDragPreview = null;
    this._requestUpdate?.();
  }

  /** Show a polyline preview during free draw creation */
  setFreeDrawPreview(cssPoints: { x: number; y: number }[], color: string, strokeWidth: number): void {
    this._freeDrawPreview = new FreeDrawPreviewPaneView(cssPoints, color, strokeWidth);
    this._requestUpdate?.();
  }

  /** Clear the free draw preview */
  clearFreeDrawPreview(): void {
    this._freeDrawPreview = null;
    this._requestUpdate?.();
  }

  /** Show a dashed vertical line preview during FRVP drag creation */
  setFRVPPreview(anchorX: number, y1: number, y2: number, color: string): void {
    this._frvpPreview = new FRVPPreviewPaneView(anchorX, y1, y2, color);
    this._requestUpdate?.();
  }

  /** Clear the FRVP creation preview */
  clearFRVPPreview(): void {
    this._frvpPreview = null;
    this._requestUpdate?.();
  }


  private _rebuildViews(): void {
    if (!this._series || !this._chart) {
      this._paneViews = [];
      return;
    }
    this._paneViews = this._drawings.map((d) => {
      const selected = this._selectedIds.includes(d.id);
      if (d.type === 'hline') {
        return new HLinePaneView(d, selected, this._series!, this._chart! as IChartApiBase<never>);
      } else if (d.type === 'rect') {
        return new RectPaneView(d, selected, this._series!, this._chart!);
      } else if (d.type === 'oval') {
        return new OvalPaneView(d, selected, this._series!, this._chart!);
      } else if (d.type === 'ruler') {
        return new RulerPaneView(d, selected, this._series!, this._chart!, this._decimals);
      } else if (d.type === 'arrowpath') {
        return new ArrowPathPaneView(d, selected, this._series!, this._chart!);
      } else if (d.type === 'marker') {
        return new MarkerPaneView(d, selected, this._series!, this._chart!);
      } else if (d.type === 'frvp') {
        const frvp = d as FRVPDrawing;
        if (frvp.mode === 'range' && frvp.t2 !== undefined) {
          // Resolve effective t2: auto-follow latest bar when t2Auto is true
          const effectiveT2 = frvp.t2Auto && this._lastBarTime > 0 ? this._lastBarTime : frvp.t2;
          const effectiveFrvp = effectiveT2 !== frvp.t2 ? { ...frvp, t2: effectiveT2 } : frvp;
          let mapRef = this._rangeVolumeMaps.get(d.id);
          if (!mapRef) { mapRef = { current: new Map() }; this._rangeVolumeMaps.set(d.id, mapRef); }
          const rangeData = this._buildRangeData(frvp.anchorTime, effectiveT2, this._tickSize);
          mapRef.current = rangeData?.volumeMap ?? new Map();
          // Auto-sync pMin/pMax from actual bar range if they differ (e.g. after mode switch).
          // Gate with _lastSyncedBounds to prevent microtask→updateDrawing→_rebuildViews loop.
          if (rangeData && this._onRangeBoundsUpdate) {
            const tol = this._tickSize;
            const last = this._lastSyncedBounds.get(frvp.id);
            const alreadySynced = last &&
              Math.abs(last.pMin - rangeData.pMin) <= tol &&
              Math.abs(last.pMax - rangeData.pMax) <= tol;
            if (!alreadySynced && (Math.abs(rangeData.pMin - frvp.pMin) > tol || Math.abs(rangeData.pMax - frvp.pMax) > tol)) {
              const cb = this._onRangeBoundsUpdate;
              const id = frvp.id;
              const { pMin, pMax } = rangeData;
              this._lastSyncedBounds.set(id, { pMin, pMax });
              queueMicrotask(() => cb(id, pMin, pMax));
            }
          }
          return new FRVPPaneView(effectiveFrvp, selected, this._series!, this._chart!, mapRef, this._tickSize, this._requestUpdate);
        }
        return new FRVPPaneView(d as FRVPDrawing, selected, this._series!, this._chart!, this._sharedVolumeMap, this._tickSize, this._requestUpdate);
      } else {
        return new FreeDrawPaneView(d, selected, this._series!, this._chart!);
      }
    });
  }

  updateAllViews(): void {
    // Called automatically by LWC on viewport change — no-op, renderers recalculate in draw
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.visible) return [];
    const extras: IPrimitivePaneView[] = [];
    if (this._dragPreview) extras.push(this._dragPreview);
    if (this._rectPreview) extras.push(this._rectPreview);
    if (this._arrowPathPreview) extras.push(this._arrowPathPreview);
    if (this._rulerDragPreview) extras.push(this._rulerDragPreview);
    if (this._freeDrawPreview) extras.push(this._freeDrawPreview);
    if (this._frvpPreview) extras.push(this._frvpPreview);
    if (this._frvpRangePreview) extras.push(this._frvpRangePreview);
    if (this._selectionRect) extras.push(this._selectionRect);
    if (extras.length > 0) return [...this._paneViews, ...extras];
    return this._paneViews;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    if (!this._series || !this.visible) return this._emptyAxisViews;

    // Collect all drawings that need price axis labels
    const hlines = this._drawings.filter((d) => d.type === 'hline');
    if (hlines.length === 0) return this._emptyAxisViews;

    // Grow pool if needed
    while (this._priceAxisViewPool.length < hlines.length) {
      this._priceAxisViewPool.push(new DrawingPriceAxisView());
    }

    // First pass: compute raw coordinates
    const items: { poolIdx: number; y: number; text: string; color: string; selected: boolean }[] = [];
    for (let i = 0; i < hlines.length; i++) {
      const d = hlines[i];
      if (d.type !== 'hline') continue;
      const y = this._series.priceToCoordinate(d.price);
      if (y === null) continue;
      const cacheKey = `${d.id}:${d.price}:${this._decimals}`;
      let text = this._priceAxisTextCache.get(cacheKey);
      if (text === undefined) {
        text = d.price.toLocaleString('en-US', {
          minimumFractionDigits: this._decimals,
          maximumFractionDigits: this._decimals,
        });
        this._priceAxisTextCache.set(cacheKey, text);
      }
      const selected = this._selectedIds.includes(d.id);
      items.push({ poolIdx: i, y, text, color: d.color, selected });
    }

    // Push drawing labels away from the countdown (current price) label zone
    if (this._countdownPrice !== null) {
      const cy = this._series.priceToCoordinate(this._countdownPrice);
      if (cy !== null) {
        const COUNTDOWN_ZONE = 25; // half-heights of countdown (~16) + drawing label (~9)
        for (const item of items) {
          const dist = item.y - (cy as number);
          if (Math.abs(dist) < COUNTDOWN_ZONE) {
            item.y = dist >= 0
              ? (cy as number) + COUNTDOWN_ZONE   // drawing below → push further down
              : (cy as number) - COUNTDOWN_ZONE;  // drawing above → push further up
          }
        }
      }
    }

    // Sort by Y coordinate and de-overlap: stack labels that are too close
    const LABEL_HEIGHT = 18;
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      if (items[i].y - items[i - 1].y < LABEL_HEIGHT) {
        items[i].y = items[i - 1].y + LABEL_HEIGHT;
      }
    }

    // Cache de-overlapped Y for the selected hline (used by priceAxisPaneViews)
    this._selectedHLineAxisY = null;
    const views: ISeriesPrimitiveAxisView[] = [];
    for (const item of items) {
      if (item.selected) this._selectedHLineAxisY = item.y;
      const axisView = this._priceAxisViewPool[item.poolIdx];
      axisView.update(item.y, item.text, item.color, item.selected);
      views.push(axisView);
    }

    return views;
  }

  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    if (!this._series || !this.visible || this._selectedIds.length !== 1) return this._emptyPaneViews;

    // Only render custom pane view for the selected hline
    const selected = this._drawings.find((d) => d.id === this._selectedIds[0] && d.type === 'hline');
    if (!selected || selected.type !== 'hline') return this._emptyPaneViews;

    // Use cached de-overlapped Y from priceAxisViews(), fall back to raw coordinate
    const y = this._selectedHLineAxisY ?? this._series.priceToCoordinate(selected.price);
    if (y === null) return this._emptyPaneViews;

    const text = selected.price.toLocaleString('en-US', {
      minimumFractionDigits: this._decimals,
      maximumFractionDigits: this._decimals,
    });
    const bgColor = selected.color;
    const textColor = contrastTextColor(bgColor);
    this._selectedAxisPaneView.update(text, y, bgColor, textColor);
    return this._selectedAxisPaneViewArr;
  }

  /** Check if (x, y) hits a resize handle on the selected oval or arrow path node. */
  getHandleAt(x: number, y: number): { drawingId: string; handle: string } | null {
    for (const view of this._paneViews) {
      if (view instanceof RectPaneView) {
        const handle = view.hitTestHandle(x, y);
        if (handle) return { drawingId: view.drawingId, handle };
      } else if (view instanceof OvalPaneView) {
        const handle = view.hitTestHandle(x, y);
        if (handle) return { drawingId: view.drawingId, handle };
      } else if (view instanceof ArrowPathPaneView) {
        const handle = view.hitTestHandle(x, y);
        if (handle) return { drawingId: view.drawingId, handle };
      } else if (view instanceof RulerPaneView) {
        const handle = view.hitTestHandle(x, y);
        if (handle) return { drawingId: view.drawingId, handle };
      } else if (view instanceof FRVPPaneView) {
        const handle = view.hitTestHandle(x, y);
        if (handle) return { drawingId: view.drawingId, handle };
      }
    }
    return null;
  }

  /** Show a dashed selection rectangle during Ctrl+drag */
  setSelectionRect(x1: number, y1: number, x2: number, y2: number): void {
    this._selectionRect = new SelectionRectPaneView(x1, y1, x2, y2);
    this._requestUpdate?.();
  }

  /** Clear the selection rectangle */
  clearSelectionRect(): void {
    this._selectionRect = null;
    this._requestUpdate?.();
  }

  /** Return IDs of drawings whose bounding box overlaps the given rectangle */
  getDrawingsInRect(x1: number, y1: number, x2: number, y2: number): string[] {
    const selLeft = Math.min(x1, x2);
    const selRight = Math.max(x1, x2);
    const selTop = Math.min(y1, y2);
    const selBottom = Math.max(y1, y2);
    const ids: string[] = [];
    for (const view of this._paneViews) {
      const bb = view.getBoundingBox();
      if (!bb) continue;
      // AABB overlap check
      if (bb.x1 <= selRight && bb.x2 >= selLeft && bb.y1 <= selBottom && bb.y2 >= selTop) {
        ids.push(view.drawingId);
      }
    }
    return ids;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    // Iterate in reverse (topmost first)
    for (let i = this._paneViews.length - 1; i >= 0; i--) {
      const view = this._paneViews[i];
      let hit = false;
      if (view instanceof HLinePaneView) {
        hit = view.hitTest(x, y);
      } else if (view instanceof RectPaneView) {
        hit = view.hitTest(x, y);
      } else if (view instanceof OvalPaneView) {
        hit = view.hitTest(x, y);
      } else if (view instanceof ArrowPathPaneView) {
        hit = view.hitTest(x, y);
      } else if (view instanceof RulerPaneView) {
        hit = view.hitTest(x, y);
      } else if (view instanceof FreeDrawPaneView) {
        hit = view.hitTest(x, y);
      } else if (view instanceof FRVPPaneView) {
        hit = view.hitTest(x, y);
      }
      if (hit) {
        return {
          externalId: view.drawingId,
          cursorStyle: undefined,
          zOrder: 'normal',
        };
      }
    }
    return null;
  }
}
