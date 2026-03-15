import type {
  IChartApiBase,
  ISeriesApi,
  SeriesType,
  Time,
  SeriesAttachedParameter,
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { Trade } from '../../services/tradeService';
import { OrderSide } from '../../types/enums';
import { floorToCandlePeriod } from './barUtils';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TradeZone {
  entryTrade: Trade;
  exitTrade: Trade;
  profitable: boolean;
}

// ── Trade Matching ─────────────────────────────────────────────────────────

/**
 * Build a map of closing-trade-ID → matched opening trade for all trades
 * in the session. Uses FIFO matching across ALL round-trips so that
 * opening trades from earlier completed round-trips are properly consumed.
 */
export function buildEntryMap(sessionTrades: Trade[]): Map<number, Trade> {
  const map = new Map<number, Trade>();

  // Group by contractId
  const byContract = new Map<string, { opens: Trade[]; closes: Trade[] }>();
  for (const t of sessionTrades) {
    if (t.voided) continue;
    const cid = String(t.contractId);
    if (!byContract.has(cid)) byContract.set(cid, { opens: [], closes: [] });
    const group = byContract.get(cid)!;
    if (t.profitAndLoss === null) group.opens.push(t);
    else group.closes.push(t);
  }

  for (const { opens, closes } of byContract.values()) {
    // Sort chronologically
    opens.sort(
      (a, b) =>
        new Date(a.creationTimestamp).getTime() -
        new Date(b.creationTimestamp).getTime(),
    );
    closes.sort(
      (a, b) =>
        new Date(a.creationTimestamp).getTime() -
        new Date(b.creationTimestamp).getTime(),
    );

    // Track remaining unclaimed size per entry trade (supports partial exits)
    const remaining = new Map<number, number>();
    for (const o of opens) remaining.set(o.id, o.size);

    for (const exit of closes) {
      const exitTime = new Date(exit.creationTimestamp).getTime();
      // Entry has opposite side: if exit is buy (side 0), entry is sell (side !== 0) and vice versa
      const entryIsBuy = exit.side !== OrderSide.Buy;

      const entry = opens.find(
        (t) =>
          (entryIsBuy ? t.side === OrderSide.Buy : t.side !== OrderSide.Buy) &&
          (remaining.get(t.id) ?? 0) > 0 &&
          new Date(t.creationTimestamp).getTime() <= exitTime,
      );

      if (entry) {
        remaining.set(entry.id, (remaining.get(entry.id) ?? 0) - exit.size);
        map.set(exit.id, entry);
      }
    }
  }

  return map;
}

/**
 * Match visible closing trades to their opening half-turns.
 * Returns a TradeZone for each successfully matched pair.
 */
export function matchTrades(
  sessionTrades: Trade[],
  visibleTradeIds: number[],
  contractId: string,
): TradeZone[] {
  const entryMap = buildEntryMap(sessionTrades);
  const zones: TradeZone[] = [];

  for (const tradeId of visibleTradeIds) {
    const exit = sessionTrades.find(
      (t) =>
        t.id === tradeId &&
        String(t.contractId) === String(contractId) &&
        t.profitAndLoss != null &&
        !t.voided,
    );
    if (!exit) continue;
    const entry = entryMap.get(exit.id);
    if (!entry) continue;

    zones.push({
      entryTrade: entry,
      exitTrade: exit,
      profitable: (exit.profitAndLoss ?? 0) > 0,
    });
  }

  return zones;
}

// ── Renderer ───────────────────────────────────────────────────────────────

import { COLOR_BUY, COLOR_SELL, COLOR_LABEL_TEXT, COLOR_TEXT, COLOR_BTN_SELL_HOVER } from '../../constants/colors';

const GREEN = COLOR_BUY;
const RED = COLOR_SELL;
const MIN_RECT_W = 6; // minimum rectangle width in CSS px

class TradeZoneRenderer implements IPrimitivePaneRenderer {
  private _zones: TradeZone[];
  private _series: ISeriesApi<SeriesType, Time>;
  private _chart: IChartApiBase<Time>;
  private _periodSec: number;
  private _decimals: number;
  private _extendRight: boolean;

  constructor(
    zones: TradeZone[],
    series: ISeriesApi<SeriesType, Time>,
    chart: IChartApiBase<Time>,
    periodSec: number,
    decimals: number,
    extendRight: boolean,
  ) {
    this._zones = zones;
    this._series = series;
    this._chart = chart;
    this._periodSec = periodSec;
    this._decimals = decimals;
    this._extendRight = extendRight;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(
      ({ context: ctx, verticalPixelRatio: vpr, horizontalPixelRatio: hpr, bitmapSize }) => {
        for (const zone of this._zones) {
          this._drawZone(ctx, zone, vpr, hpr, bitmapSize.width);
        }
      },
    );
  }

  private _drawZone(
    ctx: CanvasRenderingContext2D,
    zone: TradeZone,
    vpr: number,
    hpr: number,
    canvasWidth: number,
  ): void {
    const entryTs = Math.floor(
      new Date(zone.entryTrade.creationTimestamp).getTime() / 1000,
    );
    const exitTs = Math.floor(
      new Date(zone.exitTrade.creationTimestamp).getTime() / 1000,
    );
    const entryCandle = floorToCandlePeriod(entryTs, this._periodSec);
    const exitCandle = floorToCandlePeriod(exitTs, this._periodSec);

    const cssX1 = this._chart
      .timeScale()
      .timeToCoordinate(entryCandle as unknown as Time);
    const cssY1 = this._series.priceToCoordinate(zone.entryTrade.price);
    const cssX2 = this._chart
      .timeScale()
      .timeToCoordinate(exitCandle as unknown as Time);
    const cssY2 = this._series.priceToCoordinate(zone.exitTrade.price);

    if (cssX1 === null || cssY1 === null || cssX2 === null || cssY2 === null)
      return;

    // Ensure minimum width
    let adjCssX2 = cssX2;
    if (Math.abs(cssX2 - cssX1) < MIN_RECT_W) {
      adjCssX2 = cssX1 + MIN_RECT_W;
    }

    const x1 = cssX1 * hpr;
    const y1 = cssY1 * vpr;
    const x2 = adjCssX2 * hpr;
    const y2 = cssY2 * vpr;

    const color = zone.profitable ? GREEN : RED;

    const rectLeft = Math.min(x1, x2);
    const rectTop = Math.min(y1, y2);
    const rectRight = this._extendRight ? canvasWidth : Math.max(x1, x2);
    const rectW = rectRight - rectLeft;
    const rectH = Math.abs(y2 - y1) || Math.round(2 * vpr); // min 2px if same price

    // Semi-transparent fill
    ctx.fillStyle = color + '25';
    ctx.fillRect(rectLeft, rectTop, rectW, rectH);

    // Dashed horizontal lines at entry and exit price across the rectangle
    ctx.setLineDash([Math.round(4 * hpr), Math.round(3 * hpr)]);
    ctx.strokeStyle = color + '90';
    ctx.lineWidth = Math.round(1 * hpr);
    ctx.beginPath();
    ctx.moveTo(rectLeft, y1);
    ctx.lineTo(rectLeft + rectW, y1);
    ctx.moveTo(rectLeft, y2);
    ctx.lineTo(rectLeft + rectW, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Look up candle data so labels sit outside the candle body
    const seriesData = this._series.data() as any[];
    const entryBar = seriesData.find((d: any) => d.time === entryCandle);
    const exitBar = seriesData.find((d: any) => d.time === exitCandle);

    // Long (entry side=0 buy): entry below candle, exit above
    // Short (entry side!=0 sell): entry above candle, exit below
    const isLong = zone.entryTrade.side === OrderSide.Buy;

    const entryAnchorPrice = isLong
      ? (entryBar?.low ?? zone.entryTrade.price)
      : (entryBar?.high ?? zone.entryTrade.price);
    const cssEntryAnchorY = this._series.priceToCoordinate(entryAnchorPrice);
    const entryAnchorY = cssEntryAnchorY !== null ? cssEntryAnchorY * vpr : y1;

    this._drawLabel(ctx, x1, entryAnchorY, 'Entry', zone.entryTrade, '#4a80b0', vpr, hpr, isLong ? 'below' : 'above');

    const exitAnchorPrice = isLong
      ? (exitBar?.high ?? zone.exitTrade.price)
      : (exitBar?.low ?? zone.exitTrade.price);
    const cssExitAnchorY = this._series.priceToCoordinate(exitAnchorPrice);
    const exitAnchorY = cssExitAnchorY !== null ? cssExitAnchorY * vpr : y2;

    this._drawLabel(ctx, x2, exitAnchorY, 'Exit', zone.exitTrade, COLOR_BTN_SELL_HOVER, vpr, hpr, isLong ? 'above' : 'below');

    // Dashed line from entry to exit
    ctx.setLineDash([Math.round(4 * hpr), Math.round(4 * hpr)]);
    ctx.strokeStyle = color + '60';
    ctx.lineWidth = Math.round(1 * hpr);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private _drawLabel(
    ctx: CanvasRenderingContext2D,
    x: number,
    anchorY: number,
    label: string,
    trade: Trade,
    arrowColor: string,
    vpr: number,
    hpr: number,
    placement: 'above' | 'below',
  ): void {
    const fontSize = Math.round(12 * vpr);
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif`;

    const priceText = trade.price.toFixed(this._decimals);
    const text = `${label}  ${trade.size} @ ${priceText}`;
    const textWidth = ctx.measureText(text).width;

    const padH = Math.round(6 * hpr);
    const padV = Math.round(3 * vpr);
    const pillW = textWidth + padH * 2;
    const pillH = fontSize + padV * 2;
    const arrowLen = Math.round(18 * vpr);
    const gap = Math.round(14 * vpr);

    // Pill position relative to candle extreme (anchorY)
    let pillY: number;
    let arrowStartY: number;
    let arrowEndY: number;

    if (placement === 'above') {
      pillY = anchorY - gap - arrowLen - pillH;
      arrowStartY = pillY + pillH;
      arrowEndY = anchorY - gap;
    } else {
      pillY = anchorY + gap + arrowLen;
      arrowStartY = pillY;
      arrowEndY = anchorY + gap;
    }

    const pillX = x - pillW / 2;

    // Arrow line
    ctx.strokeStyle = arrowColor;
    ctx.lineWidth = Math.round(1.5 * hpr);
    ctx.beginPath();
    ctx.moveTo(x, arrowStartY);
    ctx.lineTo(x, arrowEndY);
    ctx.stroke();

    // Arrowhead
    const headSize = Math.round(4 * vpr);
    ctx.beginPath();
    if (placement === 'above') {
      ctx.moveTo(x, arrowEndY + headSize);
      ctx.lineTo(x - headSize, arrowEndY);
      ctx.lineTo(x + headSize, arrowEndY);
    } else {
      ctx.moveTo(x, arrowEndY - headSize);
      ctx.lineTo(x - headSize, arrowEndY);
      ctx.lineTo(x + headSize, arrowEndY);
    }
    ctx.closePath();
    ctx.fillStyle = arrowColor;
    ctx.fill();

    // Label text (white with dark outline for contrast)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textY = pillY + pillH / 2;
    ctx.strokeStyle = COLOR_LABEL_TEXT;
    ctx.lineWidth = Math.round(3 * vpr);
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, textY);
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(text, x, textY);
  }
}

// ── PaneView ───────────────────────────────────────────────────────────────

class TradeZonePaneView implements IPrimitivePaneView {
  private _zones: TradeZone[] = [];
  private _primitive: TradeZonePrimitive;

  constructor(primitive: TradeZonePrimitive) {
    this._primitive = primitive;
  }

  setZones(zones: TradeZone[]): void {
    this._zones = zones;
  }

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    const chart = this._primitive.getChart();
    const series = this._primitive.getSeries();
    if (!chart || !series || this._zones.length === 0) return null;
    return new TradeZoneRenderer(
      this._zones,
      series,
      chart,
      this._primitive.getPeriodSec(),
      this._primitive.getDecimals(),
      this._primitive.getExtendRight(),
    );
  }
}

// ── Primitive ──────────────────────────────────────────────────────────────

export class TradeZonePrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApiBase<Time> | null = null;
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _zones: TradeZone[] = [];
  private _periodSec = 60;
  private _decimals = 2;
  private _extendRight = false;
  private _paneView: TradeZonePaneView;
  private _paneViewsArr: readonly IPrimitivePaneView[];
  private _emptyPaneViews: readonly IPrimitivePaneView[] = [];
  visible = true;

  constructor() {
    this._paneView = new TradeZonePaneView(this);
    this._paneViewsArr = [this._paneView];
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  setData(zones: TradeZone[]): void {
    this._zones = zones;
    this._paneView.setZones(zones);
    this._requestUpdate?.();
  }

  setPeriod(periodSec: number): void {
    this._periodSec = periodSec;
  }

  setDecimals(decimals: number): void {
    this._decimals = decimals;
  }

  getChart(): IChartApiBase<Time> | null {
    return this._chart;
  }

  getSeries(): ISeriesApi<SeriesType, Time> | null {
    return this._series;
  }

  getPeriodSec(): number {
    return this._periodSec;
  }

  getDecimals(): number {
    return this._decimals;
  }

  setExtendRight(extend: boolean): void {
    this._extendRight = extend;
    this._requestUpdate?.();
  }

  getExtendRight(): boolean {
    return this._extendRight;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.visible || this._zones.length === 0) return this._emptyPaneViews;
    return this._paneViewsArr;
  }

  updateAllViews(): void {
    // no-op — renderer recalculates coordinates each frame
  }
}
