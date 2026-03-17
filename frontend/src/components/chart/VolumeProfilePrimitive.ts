import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesType,
  Time,
  ISeriesApi,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** price → total session volume at that price */
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
  const h = color.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
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
const MAX_WIDTH_RATIO = 0.30;
const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

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

class VolumeProfileBarsRenderer implements IPrimitivePaneRenderer {
  private _bars: BarData[];
  private _hoverIdx: number;
  private _barColor: string;
  private _hoverColor: string;
  private _refLineColor: string;
  private _expandMap: Map<number, number>;
  private _hoverExpand: boolean;
  private _requestUpdate: (() => void) | null;

  constructor(
    bars: BarData[], hoverIdx: number,
    barColor: string, hoverColor: string, refLineColor: string,
    expandMap: Map<number, number>, hoverExpand: boolean,
    requestUpdate: (() => void) | null,
  ) {
    this._bars = bars;
    this._hoverIdx = hoverIdx;
    this._barColor = barColor;
    this._hoverColor = hoverColor;
    this._refLineColor = refLineColor;
    this._expandMap = expandMap;
    this._hoverExpand = hoverExpand;
    this._requestUpdate = requestUpdate;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const bars = this._bars;
      if (bars.length === 0) return;

      const maxBarWidth = mediaSize.width * MAX_WIDTH_RATIO;
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
        const b = bars[i];
        const w = b.volumeRatio * maxBarWidth;
        const expand = this._hoverExpand ? (this._expandMap.get(b.price) ?? 0) : 0;
        ctx.fillStyle = i === this._hoverIdx ? this._hoverColor : this._barColor;
        ctx.fillRect(0, b.y - expand, w, Math.max(b.height, 1) + expand * 2);
      }

      // Dotted reference line on hover
      if (this._hoverIdx >= 0 && this._hoverIdx < bars.length) {
        const hb = bars[this._hoverIdx];
        const hbWidth = hb.volumeRatio * maxBarWidth;

        ctx.strokeStyle = this._refLineColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        const lineY = hb.y + hb.height / 2;
        ctx.beginPath();
        ctx.moveTo(hbWidth, lineY);
        ctx.lineTo(mediaSize.width, lineY);
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

class VolumeProfileTooltipRenderer implements IPrimitivePaneRenderer {
  private _bars: BarData[];
  private _hoverIdx: number;
  private _expandMap: Map<number, number>;
  private _hoverExpand: boolean;

  constructor(
    bars: BarData[], hoverIdx: number,
    expandMap: Map<number, number>, hoverExpand: boolean,
  ) {
    this._bars = bars;
    this._hoverIdx = hoverIdx;
    this._expandMap = expandMap;
    this._hoverExpand = hoverExpand;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (this._hoverIdx < 0 || this._hoverIdx >= this._bars.length) return;

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const hb = this._bars[this._hoverIdx];
      const expand = this._hoverExpand ? (this._expandMap.get(hb.price) ?? 0) : 0;

      const volText = hb.volume.toLocaleString();
      ctx.font = `11px ${FONT_FAMILY}`;
      const textWidth = ctx.measureText(volText).width;
      const pad = 5;
      const tooltipW = textWidth + pad * 2;
      const tooltipH = 18;
      const tooltipX = 4;
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

class VolumeProfileBarsPaneView implements IPrimitivePaneView {
  _bars: BarData[] = [];
  _hoverIdx = -1;
  _barColor = '';
  _hoverColor = '';
  _refLineColor = '';
  _expandMap: Map<number, number> = new Map();
  _hoverExpand = true;
  _requestUpdate: (() => void) | null = null;

  update(
    bars: BarData[], hoverIdx: number,
    barColor: string, hoverColor: string, refLineColor: string,
    hoverExpand: boolean, requestUpdate: (() => void) | null,
  ): void {
    this._bars = bars;
    this._hoverIdx = hoverIdx;
    this._barColor = barColor;
    this._hoverColor = hoverColor;
    this._refLineColor = refLineColor;
    this._hoverExpand = hoverExpand;
    this._requestUpdate = requestUpdate;
  }

  renderer(): IPrimitivePaneRenderer {
    return new VolumeProfileBarsRenderer(
      this._bars, this._hoverIdx,
      this._barColor, this._hoverColor, this._refLineColor,
      this._expandMap, this._hoverExpand, this._requestUpdate,
    );
  }

  zOrder(): string {
    return 'bottom';
  }
}

class VolumeProfileTooltipPaneView implements IPrimitivePaneView {
  _bars: BarData[] = [];
  _hoverIdx = -1;
  _expandMap: Map<number, number>; // shared ref with bars view
  _hoverExpand = true;

  constructor(expandMap: Map<number, number>) {
    this._expandMap = expandMap;
  }

  update(bars: BarData[], hoverIdx: number, hoverExpand: boolean): void {
    this._bars = bars;
    this._hoverIdx = hoverIdx;
    this._hoverExpand = hoverExpand;
  }

  renderer(): IPrimitivePaneRenderer {
    return new VolumeProfileTooltipRenderer(
      this._bars, this._hoverIdx,
      this._expandMap, this._hoverExpand,
    );
  }

  zOrder(): string {
    return 'top';
  }
}

// ---------------------------------------------------------------------------
// VolumeProfilePrimitive — attach to the candlestick series
// ---------------------------------------------------------------------------

export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;

  private _volumeMap: VolumeMap = new Map();
  private _maxVolume = 0;
  private _tickSize = 0.25;
  private _enabled = false;
  private _hoverPrice: number | null = null;
  private _hoverExpand = true;

  // Derived color strings (from hex)
  private _barColor = 'rgba(128, 128, 128, 0.22)';
  private _hoverColor = 'rgba(128, 128, 128, 0.40)';
  private _refLineColor = 'rgba(128, 128, 128, 0.25)';

  private _barsView = new VolumeProfileBarsPaneView();
  private _tooltipView = new VolumeProfileTooltipPaneView(this._barsView._expandMap);
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
    this._hoverPrice = price;
    this._requestUpdate?.();
  }

  /** Get the volume map (for VP trade mode click hit-test in the component) */
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
    this._barsView.update(bars, hoverIdx, this._barColor, this._hoverColor, this._refLineColor, this._hoverExpand, this._requestUpdate);
    this._tooltipView.update(bars, hoverIdx, this._hoverExpand);
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

    const maxVol = this._maxVolume;
    if (maxVol === 0) return [];

    const bars: BarData[] = [];
    const tickSize = this._tickSize;

    for (const [price, volume] of this._volumeMap) {
      // Bar spans one tick — from price-tickSize/2 to price+tickSize/2
      const yTop = series.priceToCoordinate(price + tickSize / 2);
      const yBottom = series.priceToCoordinate(price - tickSize / 2);
      if (yTop === null || yBottom === null) continue;

      const top = Math.min(yTop, yBottom);
      const height = Math.abs(yBottom - yTop);

      bars.push({
        y: top,
        height,
        volumeRatio: volume / maxVol,
        price,
        volume,
      });
    }

    return bars;
  }

  private _findHoverIdx(bars: BarData[]): number {
    if (this._hoverPrice === null) return -1;
    const hp = this._hoverPrice;
    const halfTick = this._tickSize / 2;
    for (let i = 0; i < bars.length; i++) {
      if (Math.abs(bars[i].price - hp) < halfTick + 0.0001) return i;
    }
    return -1;
  }
}
