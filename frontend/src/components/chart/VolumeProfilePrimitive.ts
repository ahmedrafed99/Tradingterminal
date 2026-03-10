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

/** Parse a hex color (#rrggbb) into [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
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

class VolumeProfileRenderer implements IPrimitivePaneRenderer {
  private _bars: BarData[];
  private _hoverIdx: number;
  private _barColor: string;
  private _hoverColor: string;
  private _refLineColor: string;

  constructor(bars: BarData[], hoverIdx: number, barColor: string, hoverColor: string, refLineColor: string) {
    this._bars = bars;
    this._hoverIdx = hoverIdx;
    this._barColor = barColor;
    this._hoverColor = hoverColor;
    this._refLineColor = refLineColor;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const bars = this._bars;
      if (bars.length === 0) return;

      const maxBarWidth = mediaSize.width * MAX_WIDTH_RATIO;

      // Draw all bars
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const w = b.volumeRatio * maxBarWidth;
        ctx.fillStyle = i === this._hoverIdx ? this._hoverColor : this._barColor;
        ctx.fillRect(0, b.y, w, Math.max(b.height, 1));
      }

      // Hover effects
      if (this._hoverIdx >= 0 && this._hoverIdx < bars.length) {
        const hb = bars[this._hoverIdx];
        const hbWidth = hb.volumeRatio * maxBarWidth;

        // Dotted reference line across chart
        ctx.strokeStyle = this._refLineColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        const lineY = hb.y + hb.height / 2;
        ctx.beginPath();
        ctx.moveTo(hbWidth, lineY);
        ctx.lineTo(mediaSize.width, lineY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Tooltip
        const volText = hb.volume.toLocaleString();
        ctx.font = `11px ${FONT_FAMILY}`;
        const textWidth = ctx.measureText(volText).width;
        const pad = 5;
        const tooltipW = textWidth + pad * 2;
        const tooltipH = 18;
        const tooltipX = Math.min(hbWidth + 6, mediaSize.width - tooltipW - 4);
        const tooltipY = hb.y + hb.height / 2 - tooltipH / 2;

        ctx.fillStyle = TOOLTIP_BG;
        ctx.beginPath();
        ctx.roundRect(tooltipX, tooltipY, tooltipW, tooltipH, 3);
        ctx.fill();

        ctx.fillStyle = TOOLTIP_TEXT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(volText, tooltipX + pad, tooltipY + tooltipH / 2);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// PaneView wrapper
// ---------------------------------------------------------------------------

class VolumeProfilePaneView implements IPrimitivePaneView {
  _bars: BarData[] = [];
  _hoverIdx = -1;
  _barColor = '';
  _hoverColor = '';
  _refLineColor = '';

  update(bars: BarData[], hoverIdx: number, barColor: string, hoverColor: string, refLineColor: string): void {
    this._bars = bars;
    this._hoverIdx = hoverIdx;
    this._barColor = barColor;
    this._hoverColor = hoverColor;
    this._refLineColor = refLineColor;
  }

  renderer(): IPrimitivePaneRenderer {
    return new VolumeProfileRenderer(this._bars, this._hoverIdx, this._barColor, this._hoverColor, this._refLineColor);
  }

  zOrder(): string {
    return 'bottom';
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

  // Derived color strings (from hex)
  private _barColor = 'rgba(128, 128, 128, 0.22)';
  private _hoverColor = 'rgba(128, 128, 128, 0.40)';
  private _refLineColor = 'rgba(128, 128, 128, 0.25)';

  private _paneView = new VolumeProfilePaneView();
  private _paneViewsArr: readonly IPrimitivePaneView[] = [this._paneView];
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

  /** Set the bar color from a hex string (e.g. '#808080') */
  setColor(hex: string): void {
    const [r, g, b] = hexToRgb(hex);
    this._barColor = rgba(r, g, b, 0.22);
    this._hoverColor = rgba(r, g, b, 0.40);
    this._refLineColor = rgba(r, g, b, 0.25);
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
    this._paneView.update(bars, hoverIdx, this._barColor, this._hoverColor, this._refLineColor);
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
