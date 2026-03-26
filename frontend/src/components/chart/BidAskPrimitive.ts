import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesType,
  Time,
  ISeriesApi,
  IChartApi,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { COLOR_BUY, COLOR_SELL } from '../../constants/colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LevelCounts {
  bidCount: number;
  askCount: number;
}

/** Prepared bar data for the renderer */
interface FootprintBar {
  y: number;       // top pixel of this price level
  height: number;  // pixel height (one tick)
  x: number;       // candle center X
  bidWidth: number; // px width of bid bar (extends left)
  askWidth: number; // px width of ask bar (extends right)
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const MAX_BAR_PX = 40;  // max width each side
const OPACITY = 0.40;

class FootprintRenderer implements IPrimitivePaneRenderer {
  private _bars: FootprintBar[];

  constructor(bars: FootprintBar[]) {
    this._bars = bars;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      if (this._bars.length === 0) return;

      ctx.globalAlpha = OPACITY;

      for (const b of this._bars) {
        const h = Math.max(b.height, 1);

        // Bid bar — extends LEFT from candle center
        if (b.bidWidth > 0) {
          ctx.fillStyle = COLOR_BUY;
          ctx.fillRect(b.x - b.bidWidth, b.y, b.bidWidth, h);
        }

        // Ask bar — extends RIGHT from candle center
        if (b.askWidth > 0) {
          ctx.fillStyle = COLOR_SELL;
          ctx.fillRect(b.x, b.y, b.askWidth, h);
        }
      }

      ctx.globalAlpha = 1;
    });
  }
}

// ---------------------------------------------------------------------------
// PaneView
// ---------------------------------------------------------------------------

class FootprintPaneView implements IPrimitivePaneView {
  _bars: FootprintBar[] = [];

  update(bars: FootprintBar[]): void {
    this._bars = bars;
  }

  renderer(): IPrimitivePaneRenderer {
    return new FootprintRenderer(this._bars);
  }

  zOrder(): string {
    return 'bottom';
  }
}

// ---------------------------------------------------------------------------
// BidAskPrimitive
// ---------------------------------------------------------------------------

export class BidAskPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: IChartApi | null = null;
  private _requestUpdate: (() => void) | null = null;

  // candleTime → (price → counts)
  private _data: Map<number, Map<number, LevelCounts>> = new Map();
  private _tickSize = 0.25;
  private _enabled = false;

  private _paneView = new FootprintPaneView();
  private _paneViewsArr: readonly IPrimitivePaneView[] = [this._paneView];
  private _emptyViews: readonly IPrimitivePaneView[] = [];

  // -- Lifecycle --

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this._series = param.series;
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._series = null;
    this._chart = null;
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

  isEnabled(): boolean {
    return this._enabled;
  }

  /** Increment bid/ask counts for a candle at the given prices */
  updateBidAsk(candleTime: number, bid: number | undefined, ask: number | undefined): void {
    if (bid == null && ask == null) return;

    let candle = this._data.get(candleTime);
    if (!candle) {
      candle = new Map();
      this._data.set(candleTime, candle);
    }

    if (bid != null && isFinite(bid)) {
      const level = candle.get(bid);
      if (level) {
        level.bidCount++;
      } else {
        candle.set(bid, { bidCount: 1, askCount: 0 });
      }
    }

    if (ask != null && isFinite(ask)) {
      const level = candle.get(ask);
      if (level) {
        level.askCount++;
      } else {
        candle.set(ask, { bidCount: 0, askCount: 1 });
      }
    }
    // Don't call requestUpdate — piggyback on the quote RAF flush
  }

  /** Clear all data */
  clear(): void {
    this._data.clear();
    this._requestUpdate?.();
  }

  // -- ISeriesPrimitive rendering --

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this._enabled || !this._series || !this._chart || this._data.size === 0) {
      return this._emptyViews;
    }

    const bars = this._buildBars();
    this._paneView.update(bars);
    return this._paneViewsArr;
  }

  updateAllViews(): void {
    // Recalculated in paneViews
  }

  // -- Internals --

  private _buildBars(): FootprintBar[] {
    const series = this._series!;
    const timeScale = this._chart!.timeScale();
    const halfTick = this._tickSize / 2;
    const result: FootprintBar[] = [];

    // Find global max count for normalization
    let maxCount = 1;
    for (const candle of this._data.values()) {
      for (const level of candle.values()) {
        if (level.bidCount > maxCount) maxCount = level.bidCount;
        if (level.askCount > maxCount) maxCount = level.askCount;
      }
    }

    for (const [time, candle] of this._data) {
      const x = timeScale.timeToCoordinate(time as Time);
      if (x === null) continue;

      for (const [price, level] of candle) {
        const yTop = series.priceToCoordinate(price + halfTick);
        const yBot = series.priceToCoordinate(price - halfTick);
        if (yTop === null || yBot === null) continue;

        const top = Math.min(yTop, yBot);
        const height = Math.abs(yBot - yTop);

        result.push({
          y: top,
          height,
          x,
          bidWidth: (level.bidCount / maxCount) * MAX_BAR_PX,
          askWidth: (level.askCount / maxCount) * MAX_BAR_PX,
        });
      }
    }

    return result;
  }
}
