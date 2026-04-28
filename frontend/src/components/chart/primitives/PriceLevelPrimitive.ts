import type {
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitivePaneViewZOrder,
  SeriesType,
  Time,
  ISeriesApi,
  IChartApi,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

import { FONT_FAMILY } from '../../../constants/layout';
import { COLOR_LABEL_TEXT, COLOR_BG } from '../../../constants/colors';
import { contrastText } from '../hooks/labelUtils';

// ── Types ──────────────────────────────────────────────────────────
export type LabelPosition = 'left' | 'mid' | 'right';

export interface PriceLevelCell {
  text: string;
  bg: string;
  color: string;
  hoverBg?: string;
  onClick?: () => void;
  leftText?: string;
  leftColor?: string;
  leftClick?: () => void;
  rightText?: string;
  rightColor?: string;
  rightClick?: () => void;
}

export type PriceLevelCells = Record<string, PriceLevelCell>;

export interface PriceLevelPriceLabel {
  visible?: boolean;
  tickSize?: number;
}

export interface PriceLevelPrimitiveOptions {
  price: number;
  cellOrder: string[];
  cells: PriceLevelCells;
  labelPosition?: LabelPosition;
  lineColor?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed';
  priceLabel?: PriceLevelPriceLabel;
  onDragStart?: (originalPrice: number) => void;
  onDrag?: (price: number) => void;
  onDragEnd?: (newPrice: number) => void;
  /** When false, drag fires callbacks but the line's own price doesn't move (e.g. position line). */
  allowPriceMove?: boolean;
}

type CellKey = string;

interface CellRect {
  key: CellKey;
  x: number;
  y: number;
  w: number;
  h: number;
  leftZoneW: number;
  rightZoneW: number;
}

const DRAG_THRESHOLD_PX = 4;
const SIDE_ZONE_W = 20;
const CELL_HEIGHT = 20;
const CELL_PAD_H = 8;
const FONT_PX = 12;
const FONT = `bold ${FONT_PX}px ${FONT_FAMILY}`;

// Cursor override (single style tag, shared across all primitive instances)
const CURSOR_STYLE_ID = 'pricelevel-primitive-cursor-style';
let _cursorRefs = 0;
function _cursorStyleEl(): HTMLStyleElement {
  let s = document.getElementById(CURSOR_STYLE_ID) as HTMLStyleElement | null;
  if (!s) {
    s = document.createElement('style');
    s.id = CURSOR_STYLE_ID;
    document.head.appendChild(s);
  }
  return s;
}
function applyCursorOverride(cursor: 'grab' | 'grabbing' | 'pointer'): void {
  _cursorRefs++;
  _cursorStyleEl().textContent = `.tv-lightweight-charts canvas{cursor:${cursor} !important}`;
}
function updateCursorOverride(cursor: 'grab' | 'grabbing' | 'pointer'): void {
  if (_cursorRefs > 0) _cursorStyleEl().textContent = `.tv-lightweight-charts canvas{cursor:${cursor} !important}`;
}
function removeCursorOverride(): void {
  _cursorRefs = Math.max(0, _cursorRefs - 1);
  if (_cursorRefs > 0) return;
  document.getElementById(CURSOR_STYLE_ID)?.remove();
}

function decimalsFor(tickSize: number): number {
  if (!tickSize || tickSize >= 1) return 0;
  const s = tickSize.toString();
  const d = s.indexOf('.');
  return d === -1 ? 0 : s.length - d - 1;
}

// Brighten any CSS color via offscreen canvas — used for default hover.
const _brightenCache = new Map<string, string>();
function brighten(color: string, factor = 1.25): string {
  const k = `${color}|${factor}`;
  const cached = _brightenCache.get(k);
  if (cached) return cached;
  let out = color;
  try {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      const br = Math.min(255, Math.round(r * factor));
      const bg = Math.min(255, Math.round(g * factor));
      const bb = Math.min(255, Math.round(b * factor));
      out = `rgba(${br},${bg},${bb},${(a / 255).toFixed(3)})`;
    }
  } catch { /* keep original */ }
  _brightenCache.set(k, out);
  return out;
}

// ── Renderer ─────────────────────────────────────────────────────────
class PriceLevelRenderer implements IPrimitivePaneRenderer {
  private _y: number | null;
  private _plotWidth: number;
  private _lineColor: string;
  private _lineWidth: number;
  private _lineStyle: 'solid' | 'dashed';
  private _cellRects: CellRect[];
  private _cells: PriceLevelCells;
  private _hoveredKey: CellKey | null;

  constructor(
    y: number | null,
    plotWidth: number,
    lineColor: string,
    lineWidth: number,
    lineStyle: 'solid' | 'dashed',
    cellRects: CellRect[],
    cells: PriceLevelCells,
    hoveredKey: CellKey | null,
  ) {
    this._y = y;
    this._plotWidth = plotWidth;
    this._lineColor = lineColor;
    this._lineWidth = lineWidth;
    this._lineStyle = lineStyle;
    this._cellRects = cellRects;
    this._cells = cells;
    this._hoveredKey = hoveredKey;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (this._y === null) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const w = this._plotWidth || mediaSize.width;
      const y = this._y!;

      // Line
      ctx.save();
      ctx.strokeStyle = this._lineColor;
      ctx.lineWidth = this._lineWidth;
      if (this._lineStyle === 'dashed') ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.restore();

      // Cells
      ctx.save();
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (let i = 0; i < this._cellRects.length; i++) {
        const r = this._cellRects[i];
        const c = this._cells[r.key];
        const isHover = r.key === this._hoveredKey;
        const bg = isHover ? (c.hoverBg ?? brighten(c.bg, 1.25)) : c.bg;

        ctx.fillStyle = bg;
        ctx.fillRect(r.x, r.y, r.w, r.h);

        if (i > 0) {
          ctx.fillStyle = COLOR_LABEL_TEXT;
          ctx.fillRect(r.x, r.y, 1, r.h);
        }

        // Left zone (e.g. − button)
        if (r.leftZoneW > 0) {
          ctx.fillStyle = COLOR_LABEL_TEXT;
          ctx.fillRect(r.x + r.leftZoneW, r.y, 1, r.h);
          ctx.fillStyle = c.leftColor ?? c.color;
          ctx.fillText(c.leftText!, r.x + r.leftZoneW / 2, r.y + r.h / 2 + 0.5);
        }

        // Main text centered between zones
        const mainLeft = r.x + r.leftZoneW;
        const mainW = r.w - r.leftZoneW - r.rightZoneW;
        ctx.fillStyle = c.color;
        ctx.fillText(c.text, mainLeft + mainW / 2, r.y + r.h / 2 + 0.5);

        // Right zone (e.g. + button)
        if (r.rightZoneW > 0) {
          ctx.fillStyle = COLOR_LABEL_TEXT;
          ctx.fillRect(r.x + r.w - r.rightZoneW, r.y, 1, r.h);
          ctx.fillStyle = c.rightColor ?? c.color;
          ctx.fillText(c.rightText!, r.x + r.w - r.rightZoneW / 2, r.y + r.h / 2 + 0.5);
        }
      }

      ctx.restore();
    });
  }
}

class PriceLevelPaneView implements IPrimitivePaneView {
  private _y: number | null = null;
  private _plotWidth = 0;
  private _lineColor = '#2962ff';
  private _lineWidth = 1;
  private _lineStyle: 'solid' | 'dashed' = 'solid';
  private _cellRects: CellRect[] = [];
  private _cells!: PriceLevelCells;
  private _hoveredKey: CellKey | null = null;

  update(
    y: number | null,
    plotWidth: number,
    lineColor: string,
    lineWidth: number,
    lineStyle: 'solid' | 'dashed',
    cellRects: CellRect[],
    cells: PriceLevelCells,
    hoveredKey: CellKey | null,
  ): void {
    this._y = y;
    this._plotWidth = plotWidth;
    this._lineColor = lineColor;
    this._lineWidth = lineWidth;
    this._lineStyle = lineStyle;
    this._cellRects = cellRects;
    this._cells = cells;
    this._hoveredKey = hoveredKey;
  }

  renderer(): IPrimitivePaneRenderer {
    return new PriceLevelRenderer(
      this._y, this._plotWidth, this._lineColor, this._lineWidth, this._lineStyle,
      this._cellRects, this._cells, this._hoveredKey,
    );
  }

  zOrder(): PrimitivePaneViewZOrder {
    return 'normal';
  }
}

// ── Axis label (native LWC badge — paints in price scale, no DOM) ──
class PriceLevelAxisView implements ISeriesPrimitiveAxisView {
  private _y: number;
  private _text: string;
  private _bg: string;
  private _fg: string;
  constructor(y: number, text: string, bg: string, fg: string) {
    this._y = y; this._text = text; this._bg = bg; this._fg = fg;
  }
  coordinate(): number { return this._y; }
  text(): string { return this._text; }
  textColor(): string { return this._fg; }
  backColor(): string { return this._bg; }
}

// ── Primitive ──────────────────────────────────────────────────────
export class PriceLevelPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: IChartApi | null = null;
  private _chartEl: HTMLElement | null = null;
  private _requestUpdate: (() => void) | null = null;

  private _price: number;
  private _labelPos: LabelPosition;
  private _lineColor: string;
  private _lineWidth: number;
  private _lineStyle: 'solid' | 'dashed';
  private _cells: PriceLevelCells;
  private _priceLabelVisible: boolean;
  private _decimals: number;
  private _cellOrder: string[];
  private _onDragStart?: (originalPrice: number) => void;
  private _onDrag?: (price: number) => void;
  private _onDragEnd?: (price: number) => void;
  private _allowPriceMove: boolean;

  // Layout cache (recomputed during paneViews)
  private _cellRects: CellRect[] = [];

  // Hover/drag state
  private _hoveredKey: CellKey | null = null;
  private _cursorActive = false;
  private _dragArmed = false;
  private _dragActive = false;
  private _dragDownX = 0;
  private _dragDownY = 0;
  private _dragCellKey: CellKey | null = null;
  private _cachedRect: DOMRect | null = null;

  private _paneView = new PriceLevelPaneView();
  private _paneViewsArr: readonly IPrimitivePaneView[] = [this._paneView];

  constructor(opts: PriceLevelPrimitiveOptions) {
    this._price = opts.price;
    this._cellOrder = opts.cellOrder;
    this._cells = opts.cells;
    this._labelPos = opts.labelPosition ?? 'mid';
    this._lineColor = opts.lineColor ?? '#2962ff';
    this._lineWidth = opts.lineWidth ?? 1;
    this._lineStyle = opts.lineStyle ?? 'solid';
    this._priceLabelVisible = opts.priceLabel?.visible ?? true;
    this._decimals = decimalsFor(opts.priceLabel?.tickSize ?? 0.01);
    this._onDragStart = opts.onDragStart;
    this._onDrag = opts.onDrag;
    this._onDragEnd = opts.onDragEnd;
    this._allowPriceMove = opts.allowPriceMove ?? true;
  }

  // ── Lifecycle ──
  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this._chart = (param as unknown as { chart: IChartApi }).chart ?? null;
  }

  detached(): void {
    this._removeListeners();
    if (this._cursorActive) { removeCursorOverride(); this._cursorActive = false; }
    this._removeWindowListeners();
    this._series = null;
    this._chart = null;
    this._chartEl = null;
    this._requestUpdate = null;
  }

  /** Attach DOM listeners to chart container for hit-test/drag/hover. */
  setChartElement(chartEl: HTMLElement): void {
    this._chartEl = chartEl;
    chartEl.addEventListener('mousedown', this._onMouseDown, true);
    chartEl.addEventListener('mousemove', this._onMouseMove);
    chartEl.addEventListener('mouseleave', this._onMouseLeave);
  }

  private _removeListeners(): void {
    const el = this._chartEl;
    if (!el) return;
    el.removeEventListener('mousedown', this._onMouseDown, true);
    el.removeEventListener('mousemove', this._onMouseMove);
    el.removeEventListener('mouseleave', this._onMouseLeave);
  }

  // ── Public API ──
  setPrice(price: number): void {
    this._price = price;
    this._requestUpdate?.();
  }

  getPrice(): number { return this._price; }

  setLabelPosition(pos: LabelPosition): void {
    this._labelPos = pos;
    this._requestUpdate?.();
  }

  setLineColor(color: string): void {
    this._lineColor = color;
    this._requestUpdate?.();
  }

  setLineStyle(style: 'solid' | 'dashed'): void {
    this._lineStyle = style;
    this._requestUpdate?.();
  }

  setPriceLabelVisible(visible: boolean): void {
    this._priceLabelVisible = visible;
    this._requestUpdate?.();
  }

  setTickSize(tickSize: number): void {
    this._decimals = decimalsFor(tickSize);
    this._requestUpdate?.();
  }

  setCell(key: string, patch: Partial<PriceLevelCell>): void {
    this._cells[key] = { ...this._cells[key], ...patch };
    this._requestUpdate?.();
  }

  setCellOrder(order: string[]): void {
    this._cellOrder = order;
    this._requestUpdate?.();
  }

  // ── ISeriesPrimitive ──
  paneViews(): readonly IPrimitivePaneView[] {
    if (!this._series || !this._chart) return [];

    const y = this._series.priceToCoordinate(this._price);
    let psWidth = 0;
    try { psWidth = this._chart.priceScale('right').width(); } catch { /* */ }
    const tsWidth = this._chart.timeScale().width();
    const plotWidth = tsWidth || (this._chartEl?.clientWidth ?? 0) - psWidth;

    this._cellRects = (y === null) ? [] : this._computeCellRects(y, plotWidth);

    this._paneView.update(
      y, plotWidth, this._lineColor, this._lineWidth, this._lineStyle,
      this._cellRects, this._cells, this._hoveredKey,
    );
    return this._paneViewsArr;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    if (!this._priceLabelVisible || !this._series) return [];
    const y = this._series.priceToCoordinate(this._price);
    if (y === null) return [];
    return [new PriceLevelAxisView(
      y,
      this._price.toFixed(this._decimals),
      this._lineColor,
      contrastText(this._lineColor, COLOR_BG),
    )];
  }

  updateAllViews(): void { /* recomputed in paneViews */ }

  // ── Layout ──
  private _computeCellRects(y: number, plotWidth: number): CellRect[] {
    const ctx = _measureCtx();
    ctx.font = FONT;
    const items = this._cellOrder.map((key) => {
      const cell = this._cells[key];
      const mainW = Math.ceil(ctx.measureText(cell.text).width) + CELL_PAD_H * 2;
      const leftZoneW = cell.leftText != null ? SIDE_ZONE_W : 0;
      const rightZoneW = cell.rightText != null ? SIDE_ZONE_W : 0;
      return { key, w: mainW + leftZoneW + rightZoneW, leftZoneW, rightZoneW };
    });
    const totalW = items.reduce((a, b) => a + b.w, 0);

    let startX: number;
    if (this._labelPos === 'left') startX = 4;
    else if (this._labelPos === 'right') startX = Math.max(4, plotWidth * 0.88 - totalW);
    else startX = (plotWidth - totalW) / 2;

    const top = y - CELL_HEIGHT / 2;
    const rects: CellRect[] = [];
    let x = startX;
    for (const item of items) {
      rects.push({ key: item.key, x, y: top, w: item.w, h: CELL_HEIGHT, leftZoneW: item.leftZoneW, rightZoneW: item.rightZoneW });
      x += item.w;
    }
    return rects;
  }

  // ── Hit testing ──
  private _hitTest(plotX: number, plotY: number): CellKey | null {
    for (const r of this._cellRects) {
      if (plotX >= r.x && plotX <= r.x + r.w && plotY >= r.y && plotY <= r.y + r.h) {
        return r.key;
      }
    }
    return null;
  }

  // ── Hover ──
  private _onMouseMove = (e: MouseEvent): void => {
    if (!this._chartEl) return;
    if (this._dragArmed || this._dragActive) return;
    if (!this._cachedRect) this._cachedRect = this._chartEl.getBoundingClientRect();
    const x = e.clientX - this._cachedRect.left;
    const y = e.clientY - this._cachedRect.top;
    const hit = this._hitTest(x, y);
    if (hit !== this._hoveredKey) {
      this._hoveredKey = hit;
      if (hit) {
        const cell = this._cells[hit];
        const isClickable = !!(cell.onClick || cell.leftClick || cell.rightClick || cell.leftText || cell.rightText);
        const cursor = isClickable ? 'pointer' : 'grab';
        if (!this._cursorActive) { applyCursorOverride(cursor); this._cursorActive = true; }
        else { updateCursorOverride(cursor); }
      } else if (this._cursorActive) {
        removeCursorOverride();
        this._cursorActive = false;
      }
      this._requestUpdate?.();
    }
  };

  private _onMouseLeave = (): void => {
    if (this._dragArmed || this._dragActive) return;
    this._cachedRect = null;
    if (this._hoveredKey !== null) {
      this._hoveredKey = null;
      if (this._cursorActive) { removeCursorOverride(); this._cursorActive = false; }
      this._requestUpdate?.();
    }
  };

  // ── Click + drag ──
  private _onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0 || !this._chartEl) return;
    if (!this._cachedRect) this._cachedRect = this._chartEl.getBoundingClientRect();
    const x = e.clientX - this._cachedRect.left;
    const y = e.clientY - this._cachedRect.top;
    const hit = this._hitTest(x, y);
    if (!hit) return;
    // Block LWC's pan/scroll so dragging label doesn't pan chart.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    this._chart?.applyOptions({ handleScroll: false, handleScale: false });
    // onDragStart is deferred to _onWindowMove so it only fires when drag is confirmed.
    if (this._cursorActive) updateCursorOverride('grabbing');
    this._dragArmed = true;
    this._dragActive = false;
    this._dragCellKey = hit;
    this._dragDownX = e.clientX;
    this._dragDownY = e.clientY;
    window.addEventListener('mousemove', this._onWindowMove, true);
    window.addEventListener('mouseup', this._onWindowUp, true);
  };

  private _onWindowMove = (e: MouseEvent): void => {
    if (!this._dragArmed || !this._series || !this._chartEl) return;
    const dx = e.clientX - this._dragDownX;
    const dy = e.clientY - this._dragDownY;
    if (!this._dragActive) {
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      this._dragActive = true;
      this._onDragStart?.(this._price);
    }
    if (!this._cachedRect) this._cachedRect = this._chartEl.getBoundingClientRect();
    const localY = e.clientY - this._cachedRect.top;
    const newPrice = this._series.coordinateToPrice(localY);
    if (newPrice === null) return;
    if (this._allowPriceMove) this._price = newPrice;
    this._requestUpdate?.();
    this._onDrag?.(newPrice);
  };

  private _onWindowUp = (_e: MouseEvent): void => {
    this._chart?.applyOptions({ handleScroll: true, handleScale: true });
    if (this._cursorActive) {
      const cell = this._hoveredKey ? this._cells[this._hoveredKey] : null;
      const isClickable = cell && !!(cell.onClick || cell.leftClick || cell.rightClick || cell.leftText || cell.rightText);
      updateCursorOverride(isClickable ? 'pointer' : 'grab');
    }
    const wasActive = this._dragActive;
    const cellKey = this._dragCellKey;
    this._dragArmed = false;
    this._dragActive = false;
    this._dragCellKey = null;
    this._removeWindowListeners();
    if (wasActive) {
      this._onDragEnd?.(this._price);
    } else if (cellKey) {
      const cell = this._cells[cellKey];
      const rect = this._cellRects.find((r) => r.key === cellKey);
      const clickX = this._dragDownX - (this._cachedRect?.left ?? 0);
      if (rect && rect.leftZoneW > 0 && clickX < rect.x + rect.leftZoneW) {
        cell.leftClick?.();
      } else if (rect && rect.rightZoneW > 0 && clickX > rect.x + rect.w - rect.rightZoneW) {
        cell.rightClick?.();
      } else {
        cell.onClick?.();
      }
    }
  };

  private _removeWindowListeners(): void {
    window.removeEventListener('mousemove', this._onWindowMove, true);
    window.removeEventListener('mouseup', this._onWindowUp, true);
  }
}

// ── Shared offscreen 2D context for measureText ──
let _measureCanvas: HTMLCanvasElement | null = null;
function _measureCtx(): CanvasRenderingContext2D {
  if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
  return _measureCanvas.getContext('2d')!;
}
