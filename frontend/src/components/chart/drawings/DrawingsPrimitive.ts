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
import type { Drawing, RulerMetrics } from '../../../types/drawing';
import { HLinePaneView } from './HLineRenderer';
import { OvalPaneView } from './OvalRenderer';
import { ArrowPathPaneView } from './ArrowPathRenderer';
import { RulerPaneView } from './RulerRenderer';
import { formatVolume } from './rulerMetrics';

// ---------------------------------------------------------------------------
// Drag-preview renderer: live oval preview during oval drag creation
// ---------------------------------------------------------------------------
class DragPreviewRenderer implements IPrimitivePaneRenderer {
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
      const cx = (this._x1 + this._x2) / 2;
      const cy = (this._y1 + this._y2) / 2;
      const rx = Math.abs(this._x2 - this._x1) / 2;
      const ry = Math.abs(this._y2 - this._y1) / 2;

      if (rx < 1 || ry < 1) return;

      // Draw the ellipse preview
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }
}

class DragPreviewPaneView implements IPrimitivePaneView {
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
    return new DragPreviewRenderer(this._x1, this._y1, this._x2, this._y2);
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

      // Node dots at placed points (all except the last which is the cursor)
      ctx.fillStyle = '#f7c948';
      for (let i = 0; i < pts.length - 1; i++) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 3, 0, 2 * Math.PI);
        ctx.fill();
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

      const fontFamily = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
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
// Price axis label for drawings (shows price on the right Y-axis scale)
// ---------------------------------------------------------------------------
function contrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Perceived brightness (ITU-R BT.709)
  return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#000000' : '#ffffff';
}

class DrawingPriceAxisView implements ISeriesPrimitiveAxisView {
  _coordinate = 0;
  _text = '';
  _color = '#787b86';
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

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

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
  _bgColor = '#787b86';
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
  private _selectedId: string | null = null;
  private _paneViews: (HLinePaneView | OvalPaneView | ArrowPathPaneView | RulerPaneView)[] = [];

  // Drag preview (oval creation)
  private _dragPreview: DragPreviewPaneView | null = null;

  // Arrow path creation preview
  private _arrowPathPreview: ArrowPathPreviewPaneView | null = null;

  // Ruler drag preview
  private _rulerDragPreview: RulerDragPreviewPaneView | null = null;

  // Price axis labels for drawings
  private _decimals = 2;
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

  /** Called by React when store drawings change */
  setDrawings(drawings: Drawing[], selectedId: string | null): void {
    this._drawings = drawings;
    this._selectedId = selectedId;
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

  /** Show a dashed line during oval drag creation */
  setDragPreview(x1: number, y1: number, x2: number, y2: number): void {
    this._dragPreview = new DragPreviewPaneView(x1, y1, x2, y2);
    this._requestUpdate?.();
  }

  /** Clear the drag preview */
  clearDragPreview(): void {
    this._dragPreview = null;
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

  private _rebuildViews(): void {
    if (!this._series || !this._chart) {
      this._paneViews = [];
      return;
    }
    this._paneViews = this._drawings.map((d) => {
      const selected = d.id === this._selectedId;
      if (d.type === 'hline') {
        return new HLinePaneView(d, selected, this._series!, this._chart! as IChartApiBase<never>);
      } else if (d.type === 'oval') {
        return new OvalPaneView(d, selected, this._series!, this._chart!);
      } else if (d.type === 'ruler') {
        return new RulerPaneView(d, selected, this._series!, this._chart!, this._decimals);
      } else {
        return new ArrowPathPaneView(d, selected, this._series!, this._chart!);
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
    if (this._arrowPathPreview) extras.push(this._arrowPathPreview);
    if (this._rulerDragPreview) extras.push(this._rulerDragPreview);
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
      const text = d.price.toLocaleString('en-US', {
        minimumFractionDigits: this._decimals,
        maximumFractionDigits: this._decimals,
      });
      const selected = d.id === this._selectedId;
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
    if (!this._series || !this.visible || !this._selectedId) return this._emptyPaneViews;

    // Only render custom pane view for the selected hline
    const selected = this._drawings.find((d) => d.id === this._selectedId && d.type === 'hline');
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
      if (view instanceof OvalPaneView) {
        const handle = view.hitTestHandle(x, y);
        if (handle) return { drawingId: view.drawingId, handle };
      } else if (view instanceof ArrowPathPaneView) {
        const handle = view.hitTestHandle(x, y);
        if (handle) return { drawingId: view.drawingId, handle };
      } else if (view instanceof RulerPaneView) {
        const handle = view.hitTestHandle(x, y);
        if (handle) return { drawingId: view.drawingId, handle };
      }
    }
    return null;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    // Iterate in reverse (topmost first)
    for (let i = this._paneViews.length - 1; i >= 0; i--) {
      const view = this._paneViews[i];
      let hit = false;
      if (view instanceof HLinePaneView) {
        hit = view.hitTest(x, y);
      } else if (view instanceof OvalPaneView) {
        hit = view.hitTest(x, y);
      } else if (view instanceof ArrowPathPaneView) {
        hit = view.hitTest(x, y);
      } else if (view instanceof RulerPaneView) {
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
