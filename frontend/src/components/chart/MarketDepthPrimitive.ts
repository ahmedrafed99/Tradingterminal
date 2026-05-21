import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitivePaneViewZOrder,
  SeriesType,
  Time,
  ISeriesApi,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** price → total session DOM volume (resting orders) at that price */
export type VolumeMap = Map<number, number>;

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/** Parse a hex (#rrggbb) or rgba() string into [r, g, b, a] */
function parseColor(color: string): [number, number, number, number] {
  const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    return [
      parseInt(rgbaMatch[1]),
      parseInt(rgbaMatch[2]),
      parseInt(rgbaMatch[3]),
      rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    ];
  }
  const hexColor = color.replace('#', '');
  return [
    parseInt(hexColor.substring(0, 2), 16),
    parseInt(hexColor.substring(2, 4), 16),
    parseInt(hexColor.substring(4, 6), 16),
    1,
  ];
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---------------------------------------------------------------------------
// Renderer — draws horizontal histogram bars on the main pane canvas
// ---------------------------------------------------------------------------

const TOOLTIP_BG = 'rgba(19, 23, 34, 0.90)';
import { COLOR_TEXT } from '../../constants/colors';

const TOOLTIP_TEXT = COLOR_TEXT;
import { FONT_FAMILY } from '../../constants/layout';

/** Data passed from primitive → renderer (no width yet — computed in draw) */
interface BarData {
  y: number;          // top pixel
  height: number;     // pixel height
  volumeRatio: number; // volume / maxVolume (0..1)
  price: number;
  volume: number;
}

/** Extra pixels added to the hovered bar (top + bottom) when expand is enabled */
const EXPAND_PX = 3;
/** Lerp speed — fraction of remaining distance per frame (0..1) */
const EXPAND_LERP = 0.25;

// ---------------------------------------------------------------------------
// Bars renderer — draws histogram bars + dotted ref line (z-order: bottom)
// ---------------------------------------------------------------------------

class MarketDepthBarsRenderer implements IPrimitivePaneRenderer {
  private _bars: BarData[];
  private _hoverIdx: number;
  private _barColor: string;
  private _hoverColor: string;
  private _refLineColor: string;
  private _expandMap: Map<number, number>;
  private _hoverExpand: boolean;
  private _requestUpdate: (() => void) | null;
  private _barPlacement: 'left' | 'right' | 'middle';
  private _barOffset: number;
  private _barLength: number;

  constructor(
    bars: BarData[], hoverIdx: number,
    barColor: string, hoverColor: string, refLineColor: string,
    expandMap: Map<number, number>, hoverExpand: boolean,
    requestUpdate: (() => void) | null,
    barPlacement: 'left' | 'right' | 'middle',
    barOffset: number,
    barLength: number,
  ) {
    this._bars = bars;
    this._hoverIdx = hoverIdx;
    this._barColor = barColor;
    this._hoverColor = hoverColor;
    this._refLineColor = refLineColor;
    this._expandMap = expandMap;
    this._hoverExpand = hoverExpand;
    this._requestUpdate = requestUpdate;
    this._barPlacement = barPlacement;
    this._barOffset = barOffset;
    this._barLength = barLength;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const bars = this._bars;
      if (bars.length === 0) return;

      const maxBarWidth = mediaSize.width * (this._barLength / 100);
      const offset = this._barOffset;
      const placement = this._barPlacement;
      let needsAnim = false;

      // Animate expand values toward targets
      if (this._hoverExpand) {
        for (let i = 0; i < bars.length; i++) {
          const price = bars[i].price;
          const cur = this._expandMap.get(price) ?? 0;
          const target = i === this._hoverIdx ? EXPAND_PX : 0;
          if (Math.abs(cur - target) < 0.3) {
            if (cur !== target) this._expandMap.set(price, target);
          } else {
            this._expandMap.set(price, cur + (target - cur) * EXPAND_LERP);
            needsAnim = true;
          }
        }
      }

      // Draw all bars
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        const barWidth = bar.volumeRatio * maxBarWidth;
        const expand = this._hoverExpand ? (this._expandMap.get(bar.price) ?? 0) : 0;

        let barX: number;
        if (placement === 'right') {
          barX = mediaSize.width - offset - barWidth;
        } else if (placement === 'middle') {
          barX = mediaSize.width / 2 + offset;
        } else {
          barX = offset; // left
        }

        ctx.fillStyle = i === this._hoverIdx ? this._hoverColor : this._barColor;
        ctx.fillRect(barX, bar.y - expand, barWidth, Math.max(bar.height, 1) + expand * 2);
      }

      // Dotted reference line on hover
      if (this._hoverIdx >= 0 && this._hoverIdx < bars.length) {
        const hb = bars[this._hoverIdx];
        const hbWidth = hb.volumeRatio * maxBarWidth;

        ctx.strokeStyle = this._refLineColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        const lineY = hb.y + Math.max(hb.height, 1) / 2;

        let refStart: number, refEnd: number;
        if (placement === 'right') {
          refStart = 0;
          refEnd = mediaSize.width - offset - hbWidth;
        } else if (placement === 'middle') {
          refStart = mediaSize.width / 2 + offset + hbWidth;
          refEnd = mediaSize.width;
        } else {
          refStart = offset + hbWidth;
          refEnd = mediaSize.width;
        }

        ctx.beginPath();
        ctx.moveTo(refStart, lineY);
        ctx.lineTo(refEnd, lineY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (needsAnim) this._requestUpdate?.();
    });
  }
}

// ---------------------------------------------------------------------------
// Tooltip renderer — draws hover label (z-order: top, above candles)
// ---------------------------------------------------------------------------

class MarketDepthTooltipRenderer implements IPrimitivePaneRenderer {
  private _bars: BarData[];
  private _hoverIdx: number;
  private _expandMap: Map<number, number>;
  private _hoverExpand: boolean;
  private _barPlacement: 'left' | 'right' | 'middle';
  private _barOffset: number;
  private _barLength: number;

  constructor(
    bars: BarData[], hoverIdx: number,
    expandMap: Map<number, number>, hoverExpand: boolean,
    barPlacement: 'left' | 'right' | 'middle',
    barOffset: number,
    barLength: number,
  ) {
    this._bars = bars;
    this._hoverIdx = hoverIdx;
    this._expandMap = expandMap;
    this._hoverExpand = hoverExpand;
    this._barPlacement = barPlacement;
    this._barOffset = barOffset;
    this._barLength = barLength;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (this._hoverIdx < 0 || this._hoverIdx >= this._bars.length) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const hb = this._bars[this._hoverIdx];
      const expand = this._hoverExpand ? (this._expandMap.get(hb.price) ?? 0) : 0;
      const maxBarWidth = mediaSize.width * (this._barLength / 100);
      const hbWidth = hb.volumeRatio * maxBarWidth;
      const offset = this._barOffset;
      const placement = this._barPlacement;

      const volText = hb.volume.toLocaleString();
      ctx.font = `11px ${FONT_FAMILY}`;
      const textWidth = ctx.measureText(volText).width;
      const pad = 5;
      const tooltipW = textWidth + pad * 2;
      const tooltipH = 18;

      // Position tooltip near the bar edge, inside the bar area
      let tooltipX: number;
      if (placement === 'right') {
        const barX = mediaSize.width - offset - hbWidth;
        tooltipX = barX + 4;
      } else if (placement === 'middle') {
        tooltipX = mediaSize.width / 2 + offset + 4;
      } else {
        tooltipX = offset + 4;
      }
      // Clamp so tooltip doesn't overflow right edge
      tooltipX = Math.min(tooltipX, mediaSize.width - tooltipW - 4);

      const barTop = hb.y - expand;
      const barH = Math.max(hb.height, 1) + expand * 2;
      const tooltipY = barTop + barH / 2 - tooltipH / 2;

      ctx.fillStyle = TOOLTIP_BG;
      ctx.beginPath();
      ctx.roundRect(tooltipX, tooltipY, tooltipW, tooltipH, 3);
      ctx.fill();

      ctx.fillStyle = TOOLTIP_TEXT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(volText, tooltipX + pad, tooltipY + tooltipH / 2);
    });
  }
}

// ---------------------------------------------------------------------------
// PaneView wrappers
// ---------------------------------------------------------------------------

class MarketDepthBarsPaneView implements IPrimitivePaneView {
  _bars: BarData[] = [];
  _hoverIdx = -1;
  _barColor = '';
  _hoverColor = '';
  _refLineColor = '';
  _expandMap: Map<number, number> = new Map();
  _hoverExpand = true;
  _requestUpdate: (() => void) | null = null;
  _barPlacement: 'left' | 'right' | 'middle' = 'left';
  _barOffset = 0;
  _barLength = 30;

  update(
    bars: BarData[], hoverIdx: number,
    barColor: string, hoverColor: string, refLineColor: string,
    hoverExpand: boolean, requestUpdate: (() => void) | null,
    barPlacement: 'left' | 'right' | 'middle',
    barOffset: number,
    barLength: number,
  ): void {
    this._bars = bars;
    this._hoverIdx = hoverIdx;
    this._barColor = barColor;
    this._hoverColor = hoverColor;
    this._refLineColor = refLineColor;
    this._hoverExpand = hoverExpand;
    this._requestUpdate = requestUpdate;
    this._barPlacement = barPlacement;
    this._barOffset = barOffset;
    this._barLength = barLength;
  }

  renderer(): IPrimitivePaneRenderer {
    return new MarketDepthBarsRenderer(
      this._bars, this._hoverIdx,
      this._barColor, this._hoverColor, this._refLineColor,
      this._expandMap, this._hoverExpand, this._requestUpdate,
      this._barPlacement, this._barOffset, this._barLength,
    );
  }

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }
}

class MarketDepthTooltipPaneView implements IPrimitivePaneView {
  _bars: BarData[] = [];
  _hoverIdx = -1;
  _expandMap: Map<number, number>; // shared ref with bars view
  _hoverExpand = true;
  _barPlacement: 'left' | 'right' | 'middle' = 'left';
  _barOffset = 0;
  _barLength = 30;

  constructor(expandMap: Map<number, number>) {
    this._expandMap = expandMap;
  }

  update(
    bars: BarData[], hoverIdx: number, hoverExpand: boolean,
    barPlacement: 'left' | 'right' | 'middle',
    barOffset: number,
    barLength: number,
  ): void {
    this._bars = bars;
    this._hoverIdx = hoverIdx;
    this._hoverExpand = hoverExpand;
    this._barPlacement = barPlacement;
    this._barOffset = barOffset;
    this._barLength = barLength;
  }

  renderer(): IPrimitivePaneRenderer {
    return new MarketDepthTooltipRenderer(
      this._bars, this._hoverIdx,
      this._expandMap, this._hoverExpand,
      this._barPlacement, this._barOffset, this._barLength,
    );
  }

  zOrder(): PrimitivePaneViewZOrder {
    return 'top';
  }
}

// ---------------------------------------------------------------------------
// MarketDepthPrimitive — attach to the candlestick series
// ---------------------------------------------------------------------------

export class MarketDepthPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;

  private _volumeMap: VolumeMap = new Map();
  private _maxVolume = 0;
  private _tickSize = 0.25;
  private _enabled = false;
  private _hoverPrice: number | null = null;
  private _hoverExpand = true;

  // Row layout settings
  private _rowSizeMode: 'count' | 'price' = 'price';
  private _numRows = 20;       // used when rowSizeMode === 'count'
  private _rowSizeTicks = 1;   // used when rowSizeMode === 'price'
  private _lastRowHeight = 0;  // computed in _buildBars; used for hover hit-test

  // Bar style settings
  private _barPlacement: 'left' | 'right' | 'middle' = 'left';
  private _barOffset = 0;
  private _barLength = 30; // 1–100 (% of chart width)

  // Derived color strings (from hex)
  private _barColor = 'rgba(128, 128, 128, 0.22)';
  private _hoverColor = 'rgba(128, 128, 128, 0.40)';
  private _refLineColor = 'rgba(128, 128, 128, 0.25)';

  private _barsView = new MarketDepthBarsPaneView();
  private _tooltipView = new MarketDepthTooltipPaneView(this._barsView._expandMap);
  private _paneViewsArr: readonly IPrimitivePaneView[] = [this._barsView, this._tooltipView];
  private _emptyViews: readonly IPrimitivePaneView[] = [];

  // -- Lifecycle --

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._series = null;
    this._requestUpdate = null;
  }

  // -- Public API --

  setTickSize(tickSize: number): void {
    this._tickSize = tickSize;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this._requestUpdate?.();
  }

  /** Set the bar color from a hex or rgba string */
  setColor(color: string): void {
    const [r, g, b, a] = parseColor(color);
    this._barColor = rgba(r, g, b, a * 0.22);
    this._hoverColor = rgba(r, g, b, a * 0.40);
    this._refLineColor = rgba(r, g, b, a * 0.25);
    this._requestUpdate?.();
  }

  setHoverExpand(enabled: boolean): void {
    this._hoverExpand = enabled;
    this._requestUpdate?.();
  }

  setRowLayout(mode: 'count' | 'price', rowSize: number): void {
    this._rowSizeMode = mode;
    if (mode === 'count') this._numRows = Math.max(1, rowSize);
    else this._rowSizeTicks = Math.max(1, rowSize);
    this._requestUpdate?.();
  }

  setBarPlacement(placement: 'left' | 'right' | 'middle'): void {
    this._barPlacement = placement;
    this._requestUpdate?.();
  }

  setBarOffset(offset: number): void {
    this._barOffset = Math.max(0, offset);
    this._requestUpdate?.();
  }

  setBarLength(length: number): void {
    this._barLength = Math.max(1, Math.min(100, length));
    this._requestUpdate?.();
  }

  /** Replace the entire volume map (used on snapshot) */
  setVolumeMap(map: VolumeMap): void {
    this._volumeMap = map;
    this._recomputeMax();
    this._requestUpdate?.();
  }

  /** Update a single price level (used on incremental depth updates) */
  updateLevel(price: number, volume: number): void {
    this._volumeMap.set(price, volume);
    if (volume > this._maxVolume) {
      this._maxVolume = volume;
    }
    this._requestUpdate?.();
  }

  /** Clear all data (used on contract change) */
  clear(): void {
    this._volumeMap.clear();
    this._maxVolume = 0;
    this._requestUpdate?.();
  }

  /** Set hover price (called from chart mousemove) */
  setHoverPrice(price: number | null): void {
    if (price === this._hoverPrice) return;
    const prev = this._hoverPrice;
    this._hoverPrice = price;
    // Skip repaint if hover stays on the same row
    const rh = this._lastRowHeight > 0 ? this._lastRowHeight : this._tickSize;
    const prevBar = prev !== null ? Math.floor(prev / rh) : null;
    const newBar  = price !== null ? Math.floor(price / rh) : null;
    if (prevBar !== newBar) this._requestUpdate?.();
  }

  /** Get the volume map (for FRVP anchor mode) */
  getVolumeMap(): VolumeMap {
    return this._volumeMap;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  // -- ISeriesPrimitive rendering --

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this._enabled || !this._series || this._volumeMap.size === 0) {
      return this._emptyViews;
    }

    const bars = this._buildBars();
    const hoverIdx = this._findHoverIdx(bars);
    this._barsView.update(
      bars, hoverIdx, this._barColor, this._hoverColor, this._refLineColor,
      this._hoverExpand, this._requestUpdate,
      this._barPlacement, this._barOffset, this._barLength,
    );
    this._tooltipView.update(
      bars, hoverIdx, this._hoverExpand,
      this._barPlacement, this._barOffset, this._barLength,
    );
    return this._paneViewsArr;
  }

  updateAllViews(): void {
    // Coordinates recalculated in paneViews
  }

  // -- Internals --

  private _recomputeMax(): void {
    let max = 0;
    for (const v of this._volumeMap.values()) {
      if (v > max) max = v;
    }
    this._maxVolume = max;
  }

  private _buildBars(): BarData[] {
    const series = this._series;
    if (!series) return [];
    if (this._maxVolume === 0) return [];

    const tickSize = this._tickSize;

    // Compute row height in price units
    let rowHeight: number;
    if (this._rowSizeMode === 'count') {
      let minP = Infinity, maxP = -Infinity;
      for (const p of this._volumeMap.keys()) {
        if (p < minP) minP = p;
        if (p > maxP) maxP = p;
      }
      if (!isFinite(minP)) return [];
      const priceRange = maxP - minP + tickSize;
      rowHeight = priceRange / Math.max(1, this._numRows);
    } else {
      // price mode: N ticks per row
      rowHeight = tickSize * Math.max(1, this._rowSizeTicks);
    }
    this._lastRowHeight = rowHeight;

    // Bucket volume map into rows
    const buckets = new Map<number, { volume: number; priceSum: number; count: number }>();
    for (const [price, volume] of this._volumeMap) {
      const key = Math.floor((price + tickSize * 0.5) / rowHeight);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.volume += volume;
        bucket.priceSum += price;
        bucket.count++;
      } else {
        buckets.set(key, { volume, priceSum: price, count: 1 });
      }
    }

    // Max bucket volume (for ratio normalization)
    let maxBucketVol = 0;
    for (const { volume } of buckets.values()) {
      if (volume > maxBucketVol) maxBucketVol = volume;
    }

    const bars: BarData[] = [];
    for (const [key, { volume, priceSum, count }] of buckets) {
      const priceCenter = priceSum / count;
      const priceBottom = key * rowHeight;
      const priceTop = priceBottom + rowHeight;

      const yTop = series.priceToCoordinate(priceTop);
      const yBottom = series.priceToCoordinate(priceBottom);
      if (yTop === null || yBottom === null) continue;

      const top = Math.min(yTop, yBottom);
      const height = Math.abs(yBottom - yTop);

      bars.push({
        y: top,
        height,
        volumeRatio: volume / maxBucketVol,
        price: priceCenter,
        volume,
      });
    }

    return bars;
  }

  private _findHoverIdx(bars: BarData[]): number {
    if (this._hoverPrice === null) return -1;
    const hp = this._hoverPrice;
    const halfRow = (this._lastRowHeight > 0 ? this._lastRowHeight : this._tickSize) / 2;
    for (let i = 0; i < bars.length; i++) {
      if (Math.abs(bars[i].price - hp) <= halfRow + 0.0001) return i;
    }
    return -1;
  }
}
