import type { IChartApi } from 'lightweight-charts';
import type { DrawingsPrimitive } from '../drawings/DrawingsPrimitive';
import type { TradeZonePrimitive } from '../TradeZonePrimitive';

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
