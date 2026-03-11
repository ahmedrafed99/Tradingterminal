import type { Contract } from '../../../services/marketDataService';
import type { Order } from '../../../services/orderService';
import { OrderType, OrderSide, PositionType } from '../../../types/enums';
import { calcPnl } from '../../../utils/instrument';

// ── Shared colors ──────────────────────────────────────
export const LABEL_BG = '#cac9cb';
export const LABEL_TEXT = '#000';
export const CLOSE_BG = '#e0e0e0';
export const BUY_COLOR = '#00c805';
export const SELL_COLOR = '#ff0000';
export const BUY_HOVER = '#00a004';
export const SELL_HOVER = '#cc0000';

// ── Order line color ──────────────────────────────────

interface PositionRef {
  averagePrice: number;
  type: number; // PositionType enum
}

/**
 * Compute the color for an order line based on profit/loss relative to position.
 * Same-side entries (adding to position) use side-based color.
 * Orders with a position use green/red based on whether the price is in profit.
 * Fallback: stops are red, limits use side-based color.
 */
export function computeOrderLineColor(
  order: Order,
  price: number,
  pos: PositionRef | undefined,
): string {
  const isLong = pos ? pos.type === PositionType.Long : undefined;

  // Same-side limit orders (entries) use side-based color, not profit/loss
  const isSameSideEntry = pos && order.type === OrderType.Limit && (
    (isLong && order.side === OrderSide.Buy) ||
    (!isLong && order.side === OrderSide.Sell)
  );

  if (isSameSideEntry) {
    return order.side === OrderSide.Buy ? BUY_COLOR : SELL_COLOR;
  }
  if (pos) {
    const inProfit = isLong ? price >= pos.averagePrice : price <= pos.averagePrice;
    return inProfit ? BUY_COLOR : SELL_COLOR;
  }
  if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
    return SELL_COLOR;
  }
  return order.side === OrderSide.Sell ? SELL_COLOR : BUY_COLOR;
}

// ── PnL formatting ────────────────────────────────────

/** Format P&L as "+$X.XX" or "-$X.XX" given a price difference, contract, and size. */
export function formatPnl(priceDiff: number, contract: Contract, size: number): string {
  const pnl = calcPnl(priceDiff, contract, size);
  return pnl >= 0 ? `+$${Math.abs(pnl).toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
}

/** SL projected P&L text (always negative). */
export function formatSlPnl(
  orderPrice: number, slPrice: number, size: number, isBuy: boolean, contract: Contract,
): string {
  const diff = isBuy ? orderPrice - slPrice : slPrice - orderPrice;
  return formatPnl(-Math.abs(diff), contract, size).replace('+', '-');
}

/** TP projected P&L text (always positive). */
export function formatTpPnl(
  orderPrice: number, tpPrice: number, size: number, isBuy: boolean, contract: Contract,
): string {
  const diff = isBuy ? tpPrice - orderPrice : orderPrice - tpPrice;
  const pnl = calcPnl(diff, contract, size);
  return `+$${Math.abs(pnl).toFixed(2)}`;
}

// ── Size buttons ───────────────────────────────────────

export interface SizeButtonKit {
  minusEl: HTMLDivElement;
  countEl: HTMLDivElement;
  plusEl: HTMLDivElement;
  reveal(): void;
  hide(): void;
  setCount(n: number): void;
}

/**
 * Install +/- size buttons into a label size cell.
 * Creates the minus/count/plus DOM structure with hover scale animation.
 * Callers wire their own click logic via onMinus/onPlus callbacks.
 */
export function installSizeButtons(sizeCell: HTMLDivElement, opts: {
  initialCount: number;
  normalBg: string;
  hoverBg: string;
  onMinus: (e: MouseEvent) => void;
  onPlus: (e: MouseEvent) => void;
  isMinDisabled?: () => boolean;
  isPlusDisabled?: () => boolean;
}): SizeButtonKit {
  sizeCell.textContent = '';
  sizeCell.style.display = 'flex';
  sizeCell.style.alignItems = 'center';
  sizeCell.style.padding = '0';
  sizeCell.style.transition = 'background 0.15s';

  const minusEl = document.createElement('div');
  minusEl.textContent = '\u2212';
  minusEl.style.cssText = 'display:none;padding:0 4px;cursor:pointer;opacity:0;transition:opacity 0.15s, transform 0.15s;';
  minusEl.addEventListener('mouseenter', () => { minusEl.style.transform = 'scale(1.4)'; });
  minusEl.addEventListener('mouseleave', () => { minusEl.style.transform = ''; });
  minusEl.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    opts.onMinus(e);
  });

  const countEl = document.createElement('div');
  countEl.textContent = String(opts.initialCount);
  countEl.style.cssText = 'padding:0 4px;';

  const plusEl = document.createElement('div');
  plusEl.textContent = '+';
  plusEl.style.cssText = 'display:none;padding:0 4px;cursor:pointer;opacity:0;transition:opacity 0.15s, transform 0.15s;';
  plusEl.addEventListener('mouseenter', () => { plusEl.style.transform = 'scale(1.4)'; });
  plusEl.addEventListener('mouseleave', () => { plusEl.style.transform = ''; });
  plusEl.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    opts.onPlus(e);
  });

  sizeCell.appendChild(minusEl);
  sizeCell.appendChild(countEl);
  sizeCell.appendChild(plusEl);

  function updateDisabledState() {
    const minD = opts.isMinDisabled?.() ?? false;
    const plusD = opts.isPlusDisabled?.() ?? false;
    minusEl.style.opacity = minD ? '0.35' : '1';
    minusEl.style.cursor = minD ? 'default' : 'pointer';
    plusEl.style.opacity = plusD ? '0.35' : '1';
    plusEl.style.cursor = plusD ? 'default' : 'pointer';
  }

  function reveal() {
    minusEl.style.display = '';
    plusEl.style.display = '';
    sizeCell.style.background = opts.hoverBg;
    requestAnimationFrame(updateDisabledState);
  }

  function hide() {
    sizeCell.style.background = opts.normalBg;
    minusEl.style.opacity = '0';
    plusEl.style.opacity = '0';
    minusEl.style.display = 'none';
    plusEl.style.display = 'none';
  }

  sizeCell.addEventListener('mouseenter', reveal);
  sizeCell.addEventListener('mouseleave', hide);

  return {
    minusEl,
    countEl,
    plusEl,
    reveal,
    hide,
    setCount(n: number) { countEl.textContent = String(n); },
  };
}

// ── Label section helpers ──────────────────────────────

export interface LabelSection {
  text: string;
  bg: string;
  color: string;
}

/** Build a standard close (✕) section. */
export function closeSection(): LabelSection {
  return { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT };
}

/** Build a neutral text label section (grey bg, black text). */
export function textSection(text: string): LabelSection {
  return { text, bg: LABEL_BG, color: LABEL_TEXT };
}

/** Build a colored size section. */
export function sizeSection(size: number, bg: string): LabelSection {
  return { text: String(size), bg, color: LABEL_TEXT };
}

/** Build a PnL section for SL (red). */
export function slPnlSection(pnlText: string): LabelSection {
  return { text: pnlText, bg: SELL_COLOR, color: LABEL_TEXT };
}

/** Build a PnL section for TP (green). */
export function tpPnlSection(pnlText: string): LabelSection {
  return { text: pnlText, bg: BUY_COLOR, color: LABEL_TEXT };
}

// ── Drag initiation ────────────────────────────────────

/** Common drag-start boilerplate: set cursors, disable chart scroll/zoom. */
export function initiateDrag(
  labelEl: HTMLElement,
  container: HTMLElement | null,
  chart: { applyOptions(opts: Record<string, unknown>): void } | null,
) {
  labelEl.style.cursor = 'grabbing';
  if (container) container.style.cursor = 'grabbing';
  if (chart) chart.applyOptions({ handleScroll: false, handleScale: false });
}

/** Common drag-end boilerplate: restore cursors, re-enable chart scroll/zoom. */
export function endDrag(
  labelEl: HTMLElement | null,
  container: HTMLElement | null,
  chart: { applyOptions(opts: Record<string, unknown>): void } | null,
) {
  if (labelEl) labelEl.style.cursor = 'grab';
  if (container) container.style.cursor = '';
  if (chart) chart.applyOptions({ handleScroll: true, handleScale: true });
}

/** Update the count text inside a size cell without destroying +/- button DOM. */
export function updateSizeCellCount(cells: HTMLDivElement[], cellIdx: number, size: number) {
  const cell = cells[cellIdx];
  if (!cell) return;
  const countDiv = cell.querySelector('div:nth-child(2)') as HTMLDivElement | null;
  if (countDiv) countDiv.textContent = String(size);
  else cell.textContent = String(size);
}

/** Darken a hex color by a factor (0–1, where 0.82 = 18% darker). */
export function darken(hex: string, factor = 0.82): string {
  const h = hex.replace('#', '');
  const r = Math.round(parseInt(h.substring(0, 2), 16) * factor);
  const g = Math.round(parseInt(h.substring(2, 4), 16) * factor);
  const b = Math.round(parseInt(h.substring(4, 6), 16) * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
