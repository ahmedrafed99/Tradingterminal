import type { IChartApi } from 'lightweight-charts';
import type { DrawingsPrimitive } from '../drawings/DrawingsPrimitive';
import type { TradeZonePrimitive } from '../TradeZonePrimitive';
import type { PriceLevelLine } from '../PriceLevelLine';
import type { OrderLineMeta } from '../hooks/types';

export interface ScreenshotOptions {
  showDrawings: boolean;
  showPositions: boolean;
  showTrades: boolean;
}

export interface ChartEntry {
  chart: IChartApi;
  primitive: DrawingsPrimitive | null;
  overlayEl: HTMLElement | null;
  tradeZonePrimitive: TradeZonePrimitive | null;
  instrumentEl: HTMLElement | null;
  ohlcEl: HTMLElement | null;
  /** Container div — used by recording to access the live canvas */
  containerEl: HTMLElement | null;
  /** Mutable ref to live order/position price lines (SL, TP, entry) */
  orderLinesRef: { current: PriceLevelLine[] };
  /** Mutable ref to parallel metadata for each order line */
  orderLineMetaRef: { current: OrderLineMeta[] };
  /** Mutable ref to preview bracket price lines */
  previewLinesRef: { current: PriceLevelLine[] };
}

const entries = new Map<string, ChartEntry>();

export function registerChart(id: string, entry: ChartEntry) {
  entries.set(id, entry);
}

export function unregisterChart(id: string) {
  entries.delete(id);
}

export function getChartEntry(id: string): ChartEntry | null {
  return entries.get(id) ?? null;
}
