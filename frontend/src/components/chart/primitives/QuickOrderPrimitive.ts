import type {
  ISeriesPrimitive,
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
import { COLOR_TEXT, COLOR_BORDER } from '../../../constants/colors';
import { BUY_COLOR, SELL_COLOR, BUY_HOVER, SELL_HOVER, LABEL_BG, LABEL_TEXT } from '../hooks/labelUtils';

// ── Constants ──────────────────────────────────────────────────────────────────
const CELL_HEIGHT = 20;
const CELL_PAD_H = 8;
const FONT_PX = 12;
const FONT = `bold ${FONT_PX}px ${FONT_FAMILY}`;
const FONT_ZONE_HOVER = `bold 14px ${FONT_FAMILY}`;
const PLUS_CELL_W = 20;
const DRAG_THRESHOLD_PX = 3;
const ZONE_PAD = 4;

// ── Types ──────────────────────────────────────────────────────────────────────
interface CellRect {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  leftZoneW: number;
  rightZoneW: number;
}

interface CellDef {
  text: string;
  bg: string;
  color: string;
  hoverBg?: string;
  leftText?: string;
  leftColor?: string;
  leftClick?: () => void;
  rightText?: string;
  rightColor?: string;
  rightClick?: () => void;
}

// ── Cursor helpers ─────────────────────────────────────────────────────────────
const QO_CURSOR_ID = 'qo-primitive-cursor-style';
let _cursorRefs = 0;

function _cursorEl(): HTMLStyleElement {
  let s = document.getElementById(QO_CURSOR_ID) as HTMLStyleElement | null;
  if (!s) {
    s = document.createElement('style');
    s.id = QO_CURSOR_ID;
    document.head.appendChild(s);
  }
  return s;
}

function applyCursor(cursor: 'pointer' | 'grabbing'): void {
  _cursorRefs++;
  _cursorEl().textContent = `.tv-lightweight-charts canvas{cursor:${cursor} !important}`;
}

function updateCursor(cursor: 'pointer' | 'grabbing'): void {
  if (_cursorRefs > 0) _cursorEl().textContent = `.tv-lightweight-charts canvas{cursor:${cursor} !important}`;
}

function removeCursor(): void {
  _cursorRefs = Math.max(0, _cursorRefs - 1);
  if (_cursorRefs > 0) return;
  document.getElementById(QO_CURSOR_ID)?.remove();
}

// ── brighten ───────────────────────────────────────────────────────────────────
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
      out = `rgba(${Math.min(255, Math.round(r * factor))},${Math.min(255, Math.round(g * factor))},${Math.min(255, Math.round(b * factor))},${(a / 255).toFixed(3)})`;
    }
  } catch { /* keep original */ }
  _brightenCache.set(k, out);
  return out;
}

// ── measureText ────────────────────────────────────────────────────────────────
let _measureCanvas: HTMLCanvasElement | null = null;
function _measureCtx(): CanvasRenderingContext2D {
  if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
  return _measureCanvas.getContext('2d')!;
}

// ── Renderer ───────────────────────────────────────────────────────────────────
class QORenderer implements IPrimitivePaneRenderer {
  constructor(
    private _y: number | null,
    private _plotWidth: number,
    private _cellRects: CellRect[],
    private _cells: Map<string, CellDef>,
    private _hoveredKey: string | null,
    private _hoveredZone: 'left' | 'right' | null,
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    if (this._y === null || this._cellRects.length === 0) return;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const y = this._y!;

      // Dashed horizontal line
      ctx.save();
      ctx.strokeStyle = COLOR_BORDER;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this._plotWidth, y);
      ctx.stroke();
      ctx.restore();

      // Cells
      ctx.save();
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      for (let i = 0; i < this._cellRects.length; i++) {
        const r = this._cellRects[i];
        const c = this._cells.get(r.key)!;
        const isHover = r.key === this._hoveredKey;
        const bg = isHover ? (c.hoverBg ?? brighten(c.bg, 1.25)) : c.bg;

        ctx.fillStyle = bg;
        ctx.fillRect(r.x, r.y, r.w, r.h);

        if (r.key === 'plus') {
          // Circle + cross icon (mimics the DOM SVG version)
          const cx = r.x + r.w / 2;
          const cy = r.y + r.h / 2;
          ctx.strokeStyle = COLOR_TEXT;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, 7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx, cy - 4);
          ctx.lineTo(cx, cy + 4);
          ctx.moveTo(cx - 4, cy);
          ctx.lineTo(cx + 4, cy);
          ctx.stroke();
          ctx.lineWidth = 1;
        } else {
          // Left zone
          if (r.leftZoneW > 0) {
            const zoneHot = isHover && this._hoveredZone === 'left';
            if (zoneHot) {
              ctx.fillStyle = brighten(bg, 1.3);
              ctx.fillRect(r.x, r.y, r.leftZoneW, r.h);
              ctx.font = FONT_ZONE_HOVER;
            }
            ctx.fillStyle = c.leftColor ?? c.color;
            ctx.fillText(c.leftText!, r.x + r.leftZoneW / 2, r.y + r.h / 2 + 0.5);
            if (zoneHot) ctx.font = FONT;
          }

          // Main text
          const mainLeft = r.x + r.leftZoneW;
          const mainW = r.w - r.leftZoneW - r.rightZoneW;
          ctx.fillStyle = c.color;
          ctx.fillText(c.text, mainLeft + mainW / 2, r.y + r.h / 2 + 0.5);

          // Right zone
          if (r.rightZoneW > 0) {
            const zoneHot = isHover && this._hoveredZone === 'right';
            if (zoneHot) {
              ctx.fillStyle = brighten(bg, 1.3);
              ctx.fillRect(r.x + r.w - r.rightZoneW, r.y, r.rightZoneW, r.h);
              ctx.font = FONT_ZONE_HOVER;
            }
            ctx.fillStyle = c.rightColor ?? c.color;
            ctx.fillText(c.rightText!, r.x + r.w - r.rightZoneW / 2, r.y + r.h / 2 + 0.5);
            if (zoneHot) ctx.font = FONT;
          }
        }
      }
      ctx.restore();
    });
  }
}

class QOPaneView implements IPrimitivePaneView {
  private _y: number | null = null;
  private _plotWidth = 0;
  private _cellRects: CellRect[] = [];
  private _cells: Map<string, CellDef> = new Map();
  private _hoveredKey: string | null = null;
  private _hoveredZone: 'left' | 'right' | null = null;

  update(
    y: number | null,
    plotWidth: number,
    cellRects: CellRect[],
    cells: Map<string, CellDef>,
    hoveredKey: string | null,
    hoveredZone: 'left' | 'right' | null,
  ): void {
    this._y = y;
    this._plotWidth = plotWidth;
    this._cellRects = cellRects;
    this._cells = cells;
    this._hoveredKey = hoveredKey;
    this._hoveredZone = hoveredZone;
  }

  renderer(): IPrimitivePaneRenderer {
    return new QORenderer(
      this._y, this._plotWidth, this._cellRects,
      this._cells, this._hoveredKey, this._hoveredZone,
    );
  }

  zOrder(): PrimitivePaneViewZOrder { return 'top'; }
}

// ── QuickOrderPrimitive ────────────────────────────────────────────────────────
export class QuickOrderPrimitive implements ISeriesPrimitive<Time> {
  // State
  private _price: number | null = null;
  private _isBuy = true;
  private _expanded = false;
  private _locked = false;
  private _orderSize = 1;
  private _maxSize: number | null = null;

  // Callbacks (wired by useQuickOrder)
  onDragEnd: ((price: number, didDrag: boolean) => void) | null = null;
  onDragUpdate: ((price: number) => void) | null = null;
  onSizeChange: ((delta: 1 | -1) => void) | null = null;
  onExpandChange: ((expanded: boolean) => void) | null = null;

  // LWC internals
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: IChartApi | null = null;
  private _chartEl: HTMLElement | null = null;
  private _requestUpdate: (() => void) | null = null;

  // Render cache (rebuilt each paneViews call)
  private _cellRects: CellRect[] = [];
  private _cellDefs: Map<string, CellDef> = new Map();

  // Hover/drag state
  private _hoveredKey: string | null = null;
  private _hoveredZone: 'left' | 'right' | null = null;
  private _cursorActive = false;
  private _dragArmed = false;
  private _dragActive = false;
  private _dragDownY = 0;
  private _cachedRect: DOMRect | null = null;

  private _paneView = new QOPaneView();
  private _paneViewsArr: readonly IPrimitivePaneView[] = [this._paneView];

  // ── Public API ──────────────────────────────────────────────────────────────

  setCrosshair(price: number | null, isBuy: boolean): void {
    this._price = price;
    this._isBuy = isBuy;
    if (price === null && this._expanded) {
      this._expanded = false;
      this.onExpandChange?.(false);
    }
    this._requestUpdate?.();
  }

  setOrderSize(size: number, max: number | null): void {
    this._orderSize = size;
    this._maxSize = max;
    this._requestUpdate?.();
  }

  /** Set expansion without firing onExpandChange (called programmatically by hook). */
  setExpanded(expanded: boolean): void {
    if (this._expanded === expanded) return;
    this._expanded = expanded;
    this._requestUpdate?.();
  }

  /** Prevent auto-collapse during awaiting-click phase. */
  setLocked(locked: boolean): void {
    this._locked = locked;
  }

  get isDragging(): boolean { return this._dragArmed || this._dragActive; }
  get isExpanded(): boolean { return this._expanded; }

  containsPoint(clientX: number, clientY: number): boolean {
    if (!this._chartEl) return false;
    if (!this._cachedRect) this._cachedRect = this._chartEl.getBoundingClientRect();
    const x = clientX - this._cachedRect.left;
    const y = clientY - this._cachedRect.top;
    return this._cellRects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  }

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

  // ── ISeriesPrimitive ────────────────────────────────────────────────────────

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this._chart = (param as unknown as { chart: IChartApi }).chart ?? null;
  }

  detached(): void {
    this._removeListeners();
    if (this._cursorActive) { removeCursor(); this._cursorActive = false; }
    this._removeWindowListeners();
    this._series = null;
    this._chart = null;
    this._chartEl = null;
    this._requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this._series || !this._chart) return [];

    const y = this._price !== null ? this._series.priceToCoordinate(this._price) : null;
    let psWidth = 0;
    try { psWidth = this._chart.priceScale('right').width(); } catch { /* */ }
    const tsWidth = this._chart.timeScale().width();
    const plotWidth = tsWidth || (this._chartEl?.clientWidth ?? 0) - psWidth;

    this._cellDefs = this._buildCellDefs();
    this._cellRects = y !== null ? this._computeCellRects(y as number, plotWidth) : [];

    this._paneView.update(
      y as number | null, plotWidth,
      this._cellRects, this._cellDefs,
      this._hoveredKey, this._hoveredZone,
    );
    return this._paneViewsArr;
  }

  updateAllViews(): void { /* recomputed in paneViews */ }

  // ── Cell definitions ────────────────────────────────────────────────────────

  private _buildCellDefs(): Map<string, CellDef> {
    const defs = new Map<string, CellDef>();
    const sizeBg = this._isBuy ? BUY_COLOR : SELL_COLOR;
    const sizeHoverBg = this._isBuy ? BUY_HOVER : SELL_HOVER;
    const minDisabled = this._orderSize <= 1;
    const plusDisabled = this._maxSize != null && this._orderSize >= this._maxSize;

    defs.set('label', {
      text: this._isBuy ? 'Buy Limit' : 'Sell Limit',
      bg: LABEL_BG,
      color: LABEL_TEXT,
      hoverBg: '#b0afb1',
    });
    defs.set('size', {
      text: String(this._orderSize),
      bg: sizeBg,
      color: LABEL_TEXT,
      hoverBg: sizeHoverBg,
      leftText: '−',
      leftColor: minDisabled ? 'rgba(255,255,255,0.3)' : LABEL_TEXT,
      leftClick: minDisabled ? undefined : () => { this.onSizeChange?.(-1); },
      rightText: '+',
      rightColor: plusDisabled ? 'rgba(255,255,255,0.3)' : LABEL_TEXT,
      rightClick: plusDisabled ? undefined : () => { this.onSizeChange?.(1); },
    });
    defs.set('plus', {
      text: '',
      bg: COLOR_BORDER,
      color: COLOR_TEXT,
    });
    return defs;
  }

  private _cellOrder(): string[] {
    return this._expanded ? ['label', 'size', 'plus'] : ['plus'];
  }

  // ── Layout ──────────────────────────────────────────────────────────────────

  private _computeCellRects(y: number, plotWidth: number): CellRect[] {
    const ctx = _measureCtx();
    ctx.font = FONT;
    const order = this._cellOrder();

    const items = order.map((key) => {
      if (key === 'plus') return { key, w: PLUS_CELL_W, leftZoneW: 0, rightZoneW: 0 };
      const cell = this._cellDefs.get(key)!;
      const hasLeft = cell.leftText != null;
      const hasRight = cell.rightText != null;
      const leftRaw = hasLeft ? Math.ceil(ctx.measureText(cell.leftText!).width) + ZONE_PAD * 2 : 0;
      const rightRaw = hasRight ? Math.ceil(ctx.measureText(cell.rightText!).width) + ZONE_PAD * 2 : 0;
      const symW = (hasLeft && hasRight) ? Math.max(leftRaw, rightRaw) : 0;
      const leftZoneW = hasLeft ? (symW || leftRaw) : 0;
      const rightZoneW = hasRight ? (symW || rightRaw) : 0;
      const mainPad = (hasLeft || hasRight) ? 4 : CELL_PAD_H;
      const mainW = Math.ceil(ctx.measureText(cell.text).width) + mainPad * 2;
      return { key, w: mainW + leftZoneW + rightZoneW, leftZoneW, rightZoneW };
    });

    const totalW = items.reduce((a, b) => a + b.w, 0);
    const startX = Math.max(0, plotWidth - totalW);
    const top = y - CELL_HEIGHT / 2;

    const rects: CellRect[] = [];
    let x = startX;
    for (const item of items) {
      rects.push({ key: item.key, x, y: top, w: item.w, h: CELL_HEIGHT, leftZoneW: item.leftZoneW, rightZoneW: item.rightZoneW });
      x += item.w;
    }
    return rects;
  }

  // ── Hit testing ─────────────────────────────────────────────────────────────

  private _hitTest(plotX: number, plotY: number): string | null {
    for (const r of this._cellRects) {
      if (plotX >= r.x && plotX <= r.x + r.w && plotY >= r.y && plotY <= r.y + r.h) return r.key;
    }
    return null;
  }

  private _detectZone(key: string, plotX: number): 'left' | 'right' | null {
    const r = this._cellRects.find((rect) => rect.key === key);
    if (!r) return null;
    if (r.leftZoneW > 0 && plotX < r.x + r.leftZoneW) return 'left';
    if (r.rightZoneW > 0 && plotX > r.x + r.w - r.rightZoneW) return 'right';
    return null;
  }

  // ── Internal expand logic ────────────────────────────────────────────────────

  private _doSetExpanded(expanded: boolean): void {
    if (this._expanded === expanded) return;
    this._expanded = expanded;
    this._requestUpdate?.();
    this.onExpandChange?.(expanded);
  }

  // ── Mouse events ─────────────────────────────────────────────────────────────

  private _onMouseMove = (e: MouseEvent): void => {
    if (!this._chartEl || this._dragArmed || this._dragActive) return;
    if (!this._cachedRect) this._cachedRect = this._chartEl.getBoundingClientRect();
    const x = e.clientX - this._cachedRect.left;
    const y = e.clientY - this._cachedRect.top;
    const hit = this._hitTest(x, y);
    const zone = hit ? this._detectZone(hit, x) : null;

    if (!this._locked) {
      if (!this._expanded && hit === 'plus') {
        this._doSetExpanded(true);
      } else if (this._expanded && hit === null) {
        this._doSetExpanded(false);
      }
    }

    const changed = hit !== this._hoveredKey || zone !== this._hoveredZone;
    if (changed) {
      this._hoveredKey = hit;
      this._hoveredZone = zone;
      if (hit) {
        if (!this._cursorActive) { applyCursor('pointer'); this._cursorActive = true; }
        else { updateCursor('pointer'); }
      } else if (this._cursorActive) {
        removeCursor();
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
      this._hoveredZone = null;
      if (this._cursorActive) { removeCursor(); this._cursorActive = false; }
      this._requestUpdate?.();
    }
    if (this._expanded && !this._locked) this._doSetExpanded(false);
  };

  private _onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0 || !this._chartEl) return;
    if (!this._cachedRect) this._cachedRect = this._chartEl.getBoundingClientRect();
    const x = e.clientX - this._cachedRect.left;
    const y = e.clientY - this._cachedRect.top;
    const hit = this._hitTest(x, y);
    if (!hit) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Zone clicks on size cell fire immediately; don't start drag
    if (hit === 'size') {
      const zone = this._detectZone('size', x);
      if (zone === 'left') {
        this._cellDefs.get('size')?.leftClick?.();
        return;
      }
      if (zone === 'right') {
        this._cellDefs.get('size')?.rightClick?.();
        return;
      }
      // size cell body — no action
      return;
    }

    // Label cell — no action on click
    if (hit === 'label') return;

    // Plus cell — start drag/click sequence
    this._chart?.applyOptions({ handleScroll: false, handleScale: false });
    if (this._cursorActive) updateCursor('grabbing');
    this._dragArmed = true;
    this._dragActive = false;
    this._dragDownY = e.clientY;
    window.addEventListener('mousemove', this._onWindowMove, true);
    window.addEventListener('mouseup', this._onWindowUp, true);
  };

  private _onWindowMove = (e: MouseEvent): void => {
    if (!this._dragArmed || !this._series || !this._chartEl) return;
    const dy = e.clientY - this._dragDownY;
    if (!this._dragActive) {
      if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      this._dragActive = true;
    }
    if (!this._cachedRect) this._cachedRect = this._chartEl.getBoundingClientRect();
    const localY = e.clientY - this._cachedRect.top;
    const newPrice = this._series.coordinateToPrice(localY);
    if (newPrice === null) return;
    this._price = newPrice as number;
    this._requestUpdate?.();
    this.onDragUpdate?.(newPrice as number);
  };

  private _onWindowUp = (_e: MouseEvent): void => {
    this._chart?.applyOptions({ handleScroll: true, handleScale: true });
    if (this._cursorActive) updateCursor('pointer');
    const wasActive = this._dragActive;
    const price = this._price;
    this._dragArmed = false;
    this._dragActive = false;
    this._removeWindowListeners();
    if (price !== null) {
      this.onDragEnd?.(price, wasActive);
    }
  };

  private _removeWindowListeners(): void {
    window.removeEventListener('mousemove', this._onWindowMove, true);
    window.removeEventListener('mouseup', this._onWindowUp, true);
  }
}
