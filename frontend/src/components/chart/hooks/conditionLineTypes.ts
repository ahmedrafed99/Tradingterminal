import type { PriceLevelPrimitive } from '../primitives/PriceLevelPrimitive';
import { COLOR_ACCENT, COLOR_LINE_BUY, COLOR_LINE_SELL } from '../../../constants/colors';

// ── Shared ref types for condition line sub-hooks ──

export interface ArmedDragState {
  condId: string;
  lineIdx: number;
  originalPrice: number;
  field: 'triggerPrice' | 'orderPrice' | 'slPrice' | 'tpPrice';
  tpIndex?: number;   // for tpPrice
  refPrice?: number;  // for slPrice/tpPrice: the order/trigger ref
  isBuy?: boolean;    // for slPrice/tpPrice: direction
}

export interface PreviewState {
  condLine: PriceLevelPrimitive | null;
  orderLine: PriceLevelPrimitive | null;
  slLine: PriceLevelPrimitive | null;
  tpLines: { line: PriceLevelPrimitive; price: number; size: number }[];
  condPrice: number;
  orderPrice: number;
  slPrice: number | null;
  size: number;
  isAbove: boolean;
  isMarket: boolean;
}

// ── Colors ──
export const CLR_ABOVE = COLOR_ACCENT;
export const CLR_BELOW = '#d32f2f';
export const CLR_BUY = COLOR_LINE_BUY;
export const CLR_SELL = COLOR_LINE_SELL;
export const CLR_ARM_ABOVE = '#4a7dff';
export const CLR_ARM_BELOW = '#d32f2f';
export const CLR_SL = COLOR_LINE_SELL;
export const CLR_TP = COLOR_LINE_BUY;
