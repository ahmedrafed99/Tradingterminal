import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { COLOR_BG, COLOR_TEXT_MUTED, COLOR_LABEL_TEXT } from '../../constants/colors';

// ── Types ────────────────────────────────────────────────

export interface LabelSection {
  text: string;
  bg: string;
  color: string;
}

export interface PriceLevelLineConfig {
  price: number;
  series: ISeriesApi<'Candlestick'>;
  overlay: HTMLDivElement;
  chartApi: IChartApi;
  lineColor: string;
  lineStyle: 'solid' | 'dashed';
  lineWidth?: number;             // default 1
  axisLabelVisible?: boolean;     // default true
  tickSize?: number;              // for formatting price on axis label
  label?: LabelSection[] | null;
}

// ── Helpers ──────────────────────────────────────────────

const FONT = "-apple-system,BlinkMacSystemFont,'Trebuchet MS',Roboto,Ubuntu,sans-serif";

/** Contrast text color for axis labels (white on dark, dark on light). */
function contrastText(hex: string): string {
  const h = hex.replace('#', '').slice(0, 6);
  if (h.length < 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? COLOR_BG : '#fff';
}

/** Number of decimals needed to display tick-aligned prices. */
function decimalsFor(tickSize: number): number {
  if (tickSize >= 1) return 0;
  const s = tickSize.toString();
  const d = s.indexOf('.');
  return d === -1 ? 0 : s.length - d - 1;
}

// ── Class ────────────────────────────────────────────────

/**
 * A unified price-level element that draws a horizontal line,
 * an optional label pill (P&L / size / buttons), and an axis-label badge —
 * all as pure HTML in the chart's overlay div.
 *
 * Only dependency on LWC: `series.priceToCoordinate(price)` for Y positioning.
 */
export class PriceLevelLine {
  private _price: number;
  private _series: ISeriesApi<'Candlestick'>;
  private _overlay: HTMLDivElement;
  private _chart: IChartApi;
  private _color: string;
  private _style: 'solid' | 'dashed';
  private _width: number;
  private _axisVisible: boolean;
  private _decimals: number;
  private _visible = true;
  private _dead = false;
  private _labelLeft = 0.5;   // fraction of plot width (0..1)

  // DOM elements (all appended to overlay)
  private _lineEl: HTMLDivElement;
  private _labelEl: HTMLDivElement | null = null;
  private _axisEl: HTMLDivElement;
  private _cells: HTMLDivElement[] = [];

  constructor(cfg: PriceLevelLineConfig) {
    this._price = cfg.price;
    this._series = cfg.series;
    this._overlay = cfg.overlay;
    this._chart = cfg.chartApi;
    this._color = cfg.lineColor;
    this._style = cfg.lineStyle;
    this._width = cfg.lineWidth ?? 1;
    this._axisVisible = cfg.axisLabelVisible ?? true;
    this._decimals = decimalsFor(cfg.tickSize ?? 0.25);

    // ── Line element (horizontal rule via CSS border-top) ──
    this._lineEl = document.createElement('div');
    this._lineEl.style.cssText = 'position:absolute;left:0;height:0;pointer-events:none;';
    this._syncBorder();
    this._overlay.appendChild(this._lineEl);

    // ── Axis label (price badge over the price scale) ──
    this._axisEl = document.createElement('div');
    this._axisEl.style.cssText =
      `position:absolute;right:0;height:18px;font-size:12px;font-weight:bold;` +
      `font-family:${FONT};line-height:18px;text-align:center;pointer-events:none;` +
      `transform:translateY(-50%);box-sizing:border-box;z-index:20;`;
    this._syncAxis();
    if (!this._axisVisible) this._axisEl.style.display = 'none';
    this._overlay.appendChild(this._axisEl);

    // ── Label pill (optional) ──
    if (cfg.label) this._buildLabel(cfg.label);

    this.syncPosition();
  }

  // ── Price ──────────────────────────────────────────────

  setPrice(price: number): void {
    this._price = price;
    this._syncAxis();
  }

  getPrice(): number {
    return this._price;
  }

  // ── Appearance ─────────────────────────────────────────

  setLineColor(color: string): void {
    this._color = color;
    this._syncBorder();
    this._syncAxis();
  }

  setLineStyle(style: 'solid' | 'dashed'): void {
    this._style = style;
    this._syncBorder();
  }

  setLineWidth(width: number): void {
    this._width = width;
    this._syncBorder();
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    if (!visible) {
      this._lineEl.style.display = 'none';
      if (this._labelEl) this._labelEl.style.display = 'none';
      this._axisEl.style.display = 'none';
    }
    // When visible=true, syncPosition() will restore display
  }

  setAxisLabelVisible(visible: boolean): void {
    this._axisVisible = visible;
    if (!visible) this._axisEl.style.display = 'none';
  }

  /** Set horizontal position of the label pill as a fraction of plot width (0–1, default 0.5 = centered). */
  setLabelLeft(fraction: number): void {
    this._labelLeft = fraction;
    if (this._labelEl) {
      this._labelEl.style.left = `${fraction * 100}%`;
    }
  }

  // ── Label ──────────────────────────────────────────────

  /** Replace the entire label pill. Pass null to remove. */
  setLabel(sections: LabelSection[] | null): void {
    if (this._dead) return;
    if (this._labelEl) {
      this._labelEl.remove();
      this._labelEl = null;
      this._cells = [];
    }
    if (sections && sections.length > 0) {
      this._buildLabel(sections);
      this.syncPosition();
    }
  }

  /** Update a single cell's text / background / color in-place (no DOM rebuild). */
  updateSection(index: number, text?: string, bg?: string, color?: string): void {
    if (this._dead) return;
    const cell = this._cells[index];
    if (!cell) return;
    if (text != null) {
      // Cell 0 has a grip bar + span inside — update the span, not the whole cell
      if (index === 0 && cell.lastChild && cell.lastChild !== cell.firstChild) {
        cell.lastChild.textContent = text;
      } else {
        cell.textContent = text;
      }
    }
    if (bg != null) cell.style.background = bg;
    if (color != null) cell.style.color = color;
  }

  getLabelEl(): HTMLDivElement | null {
    return this._labelEl;
  }

  getCells(): HTMLDivElement[] {
    return this._cells;
  }

  // ── Sync (hot path — called on every scroll/zoom/resize/tick) ──

  syncPosition(): void {
    if (this._dead) return;

    const y = this._series.priceToCoordinate(this._price);
    if (y === null || !this._visible) {
      this._lineEl.style.display = 'none';
      if (this._labelEl) this._labelEl.style.display = 'none';
      this._axisEl.style.display = 'none';
      return;
    }

    // Price-scale width (for line width + axis label width)
    let psWidth = 56;
    try { psWidth = this._chart.priceScale('right').width(); } catch { /* */ }
    const plotWidth = this._overlay.clientWidth - psWidth;

    // Line
    this._lineEl.style.display = '';
    this._lineEl.style.top = `${y}px`;
    this._lineEl.style.width = `${plotWidth}px`;

    // Label
    if (this._labelEl) {
      this._labelEl.style.display = 'flex';
      this._labelEl.style.top = `${y}px`;
    }

    // Axis label
    if (this._axisVisible) {
      this._axisEl.style.display = '';
      this._axisEl.style.top = `${y}px`;
      this._axisEl.style.width = `${psWidth}px`;
    }
  }

  // ── Screenshot ─────────────────────────────────────────

  /** Paint this line + label + axis label onto a canvas context. */
  paintToCanvas(ctx: CanvasRenderingContext2D, plotWidth: number): void {
    if (this._dead) return;
    const y = this._series.priceToCoordinate(this._price);
    if (y === null || !this._visible) return;

    // 1. Horizontal line
    ctx.save();
    ctx.strokeStyle = this._color;
    ctx.lineWidth = this._width;
    if (this._style === 'dashed') ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotWidth, y);
    ctx.stroke();
    ctx.restore();

    // 2. Label cells (skip interactive buttons like ✕, +SL, +TP)
    if (this._labelEl && this._cells.length > 0) {
      ctx.font = `bold 12px ${FONT}`;
      const padH = 6;
      const cellH = 20;

      const vis: { text: string; bg: string; color: string }[] = [];
      const widths: number[] = [];
      let totalW = 0;

      for (const cell of this._cells) {
        const t = (cell as HTMLElement).dataset?.screenshotText || cell.textContent || '';
        if (t === '\u2715' || t === '+SL' || t === '+TP') continue;
        const w = Math.ceil(ctx.measureText(t).width) + padH * 2;
        widths.push(w);
        totalW += w;
        vis.push({
          text: t,
          bg: cell.style.background || cell.style.backgroundColor || COLOR_TEXT_MUTED,
          color: cell.style.color || COLOR_LABEL_TEXT,
        });
      }

      if (vis.length > 0) {
        let x = plotWidth * this._labelLeft - totalW / 2;
        for (let j = 0; j < vis.length; j++) {
          const v = vis[j];
          const w = widths[j];
          ctx.fillStyle = v.bg;
          ctx.fillRect(x, y - cellH / 2, w, cellH);
          if (j > 0) {
            ctx.fillStyle = COLOR_LABEL_TEXT;
            ctx.fillRect(x, y - cellH / 2, 1, cellH);
          }
          ctx.fillStyle = v.color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(v.text, x + w / 2, y);
          x += w;
        }
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }
    }

    // 3. Axis label
    if (this._axisVisible) {
      let psWidth = 56;
      try { psWidth = this._chart.priceScale('right').width(); } catch { /* */ }
      const priceText = this._price.toFixed(this._decimals);
      ctx.font = `bold 12px ${FONT}`;
      const axH = 18;
      ctx.fillStyle = this._color;
      ctx.fillRect(plotWidth, y - axH / 2, psWidth, axH);
      ctx.fillStyle = contrastText(this._color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(priceText, plotWidth + psWidth / 2, y);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  // ── Destroy ────────────────────────────────────────────

  destroy(): void {
    if (this._dead) return;
    this._dead = true;
    this._lineEl.remove();
    if (this._labelEl) this._labelEl.remove();
    this._axisEl.remove();
    this._cells = [];
  }

  // ── Private helpers ────────────────────────────────────

  private _buildLabel(sections: LabelSection[]): void {
    const row = document.createElement('div');
    row.style.cssText =
      `position:absolute;left:${this._labelLeft * 100}%;display:flex;height:20px;font-size:12px;font-weight:bold;` +
      `font-family:${FONT};line-height:20px;transform:translate(-50%,-50%);` +
      `white-space:nowrap;border-radius:3px;overflow:hidden;`;

    this._cells = [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      const cell = document.createElement('div');
      if (i === 0) {
        // First cell includes drag-handle grip bar
        cell.style.cssText =
          `display:flex;align-items:center;gap:0;background:${s.bg};color:${s.color};padding:0 6px 0 4px;` ;
        const bar = document.createElement('div');
        bar.style.cssText = `width:1px;height:14px;background:${COLOR_LABEL_TEXT};flex-shrink:0;margin-right:4px;`;
        cell.appendChild(bar);
        const text = document.createElement('span');
        text.textContent = s.text;
        cell.appendChild(text);
      } else {
        cell.style.cssText =
          `background:${s.bg};color:${s.color};padding:0 6px;border-left:1px solid ${COLOR_LABEL_TEXT};`;
        cell.textContent = s.text;
      }
      this._cells.push(cell);
      row.appendChild(cell);
    }
    this._overlay.appendChild(row);
    this._labelEl = row;
  }

  private _syncBorder(): void {
    this._lineEl.style.borderTop = `${this._width}px ${this._style} ${this._color}`;
  }

  private _syncAxis(): void {
    this._axisEl.style.background = this._color;
    this._axisEl.style.color = contrastText(this._color);
    this._axisEl.textContent = this._price.toFixed(this._decimals);
  }
}
