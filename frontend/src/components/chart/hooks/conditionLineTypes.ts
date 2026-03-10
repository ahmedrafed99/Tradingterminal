import type { PriceLevelLine } from '../PriceLevelLine';

// ── Shared ref types for condition line sub-hooks ──

export interface ArmedDragState {
  condId: string;
  lineIdx: number;
  originalPrice: number;
  startY: number;
  field: 'triggerPrice' | 'orderPrice';
}

export interface PreviewState {
  condLine: PriceLevelLine | null;
  orderLine: PriceLevelLine | null;
  slLine: PriceLevelLine | null;
  tpLines: { line: PriceLevelLine; price: number; size: number }[];
  condPrice: number;
  orderPrice: number;
  slPrice: number | null;
  size: number;
  isAbove: boolean;
  isMarket: boolean;
}

export interface PreviewDragState {
  target: 'cond' | 'order' | 'sl' | 'tp';
  startY: number;
  originalPrice: number;
  tpIndex?: number;
}

// ── Colors ──
export const CLR_ABOVE = '#2962ff';
export const CLR_BELOW = '#d32f2f';
export const CLR_BUY = '#00c805';
export const CLR_SELL = '#ff0000';
export const CLR_ARM_ABOVE = '#4a7dff';
export const CLR_ARM_BELOW = '#d32f2f';
export const CLR_SL = '#ff0000';
export const CLR_TP = '#00c805';
