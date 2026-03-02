import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesPrimitiveAxisView,
  SeriesType,
  Time,
  ISeriesApi,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

// ---------------------------------------------------------------------------
// Renderer: draws the price + countdown label on the price axis canvas
// ---------------------------------------------------------------------------
class CountdownRenderer implements IPrimitivePaneRenderer {
  private _priceText: string;
  private _countdownText: string;
  private _y: number;

  constructor(priceText: string, countdownText: string, y: number) {
    this._priceText = priceText;
    this._countdownText = countdownText;
    this._y = y;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const fontSize = 12;
      const vPad = 3;
      const gap = 1;

      const hasCountdown = this._countdownText !== '';
      const totalHeight = hasCountdown
        ? fontSize + gap + fontSize + vPad * 2
        : fontSize + vPad * 2;

      const top = this._y - totalHeight / 2;

      // White background — full width of price axis
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, top, mediaSize.width, totalHeight);

      // Price text (bold, centred)
      ctx.fillStyle = '#131722';
      ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(this._priceText, mediaSize.width / 2, top + vPad);

      // Countdown text (same font, below price)
      if (hasCountdown) {
        ctx.fillStyle = '#131722';
        ctx.font = `${fontSize}px ${FONT_FAMILY}`;
        ctx.fillText(this._countdownText, mediaSize.width / 2, top + vPad + fontSize + gap);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// PaneView wrapper
// ---------------------------------------------------------------------------
class CountdownPaneView implements IPrimitivePaneView {
  _priceText = '';
  _countdownText = '';
  _y = 0;

  update(priceText: string, countdownText: string, y: number): void {
    this._priceText = priceText;
    this._countdownText = countdownText;
    this._y = y;
  }

  renderer(): IPrimitivePaneRenderer {
    return new CountdownRenderer(this._priceText, this._countdownText, this._y);
  }

  zOrder(): string {
    return 'top';
  }
}

// ---------------------------------------------------------------------------
// Axis view — tells LWC about our label position for overlap avoidance
// ---------------------------------------------------------------------------
class PriceLabelAxisView implements ISeriesPrimitiveAxisView {
  _coordinate = 0;
  _text = '';

  update(coordinate: number, text: string): void {
    this._coordinate = coordinate;
    this._text = text;
  }

  coordinate(): number { return -10000; }
  fixedCoordinate(): number { return this._coordinate; }
  text(): string { return this._text; }
  textColor(): string { return '#131722'; }
  backColor(): string { return '#ffffff'; }
  visible(): boolean { return false; }
  tickVisible(): boolean { return false; }
}

// ---------------------------------------------------------------------------
// CountdownPrimitive — attach to the candlestick series
// ---------------------------------------------------------------------------
export class CountdownPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;

  private _price = 0;
  private _priceText = '';
  private _countdownText = '';
  private _isLive = false;
  private _periodSec = 60;
  private _decimals = 2;
  private _intervalId: ReturnType<typeof setInterval> | null = null;

  private _paneView = new CountdownPaneView();
  private _paneViewsArr: readonly IPrimitivePaneView[] = [this._paneView];
  private _axisView = new PriceLabelAxisView();
  private _axisViewsArr: readonly ISeriesPrimitiveAxisView[] = [this._axisView];
  private _emptyPaneViews: readonly IPrimitivePaneView[] = [];
  private _emptyAxisViews: readonly ISeriesPrimitiveAxisView[] = [];

  // -- Lifecycle --

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this._startTimer();
  }

  detached(): void {
    this._stopTimer();
    this._series = null;
    this._requestUpdate = null;
  }

  // -- Public API --

  /** Update the displayed price (called on each quote OR after loading bars) */
  updatePrice(price: number, live: boolean): void {
    this._price = price;
    this._priceText = this._formatPrice(price);
    this._isLive = live;
    if (live) this._updateCountdown();
    else this._countdownText = '';
    this._requestUpdate?.();
  }

  /** Update candle period (call when timeframe changes) */
  setPeriod(periodSec: number): void {
    this._periodSec = periodSec;
  }

  /** Update decimal places (call when contract changes) */
  setDecimals(decimals: number): void {
    this._decimals = decimals;
  }

  /** Mark feed as disconnected (hides countdown, keeps price label) */
  setLive(live: boolean): void {
    this._isLive = live;
    if (!live) this._countdownText = '';
    this._requestUpdate?.();
  }

  // -- ISeriesPrimitive rendering --

  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    if (!this._series || this._price === 0) return this._emptyPaneViews;
    const y = this._series.priceToCoordinate(this._price);
    if (y === null) return this._emptyPaneViews;

    this._paneView.update(this._priceText, this._countdownText, y);
    return this._paneViewsArr;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    if (!this._series || this._price === 0) return this._emptyAxisViews;
    const y = this._series.priceToCoordinate(this._price);
    if (y === null) return this._emptyAxisViews;

    this._axisView.update(y, this._priceText);
    return this._axisViewsArr;
  }

  updateAllViews(): void {
    // Coordinates recalculated in priceAxisPaneViews / priceAxisViews
  }

  // -- Internals --

  private _formatPrice(price: number): string {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: this._decimals,
      maximumFractionDigits: this._decimals,
    });
  }

  private _updateCountdown(): void {
    // Only show countdown for intraday timeframes (< 1 day)
    if (!this._isLive || this._periodSec >= 86400) {
      this._countdownText = '';
      return;
    }

    const nowSec = Date.now() / 1000;
    const nextCandle = Math.ceil(nowSec / this._periodSec) * this._periodSec;
    const remaining = Math.max(0, Math.ceil(nextCandle - nowSec));

    if (remaining <= 0) {
      this._countdownText = '';
      return;
    }

    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;

    this._countdownText = h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  private _startTimer(): void {
    this._intervalId = setInterval(() => {
      if (!this._isLive) return;
      this._updateCountdown();
      this._requestUpdate?.();
    }, 1000);
  }

  private _stopTimer(): void {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }
}
