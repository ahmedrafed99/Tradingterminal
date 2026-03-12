import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  ISeriesPrimitiveAxisView,
  IChartApi,
  SeriesType,
  Time,
  ISeriesApi,
} from 'lightweight-charts';

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

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
//
// Renders the current-price + bar-countdown label as an HTML overlay element
// (z-index:25) so it stacks above PriceLevelLine axis labels (z-index:20)
// but below the crosshair label (z-index:30).
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

  private _axisView = new PriceLabelAxisView();
  private _axisViewsArr: readonly ISeriesPrimitiveAxisView[] = [this._axisView];
  private _emptyPaneViews: readonly IPrimitivePaneView[] = [];
  private _emptyAxisViews: readonly ISeriesPrimitiveAxisView[] = [];

  // HTML overlay elements
  private _overlay: HTMLDivElement | null = null;
  private _chartApi: IChartApi | null = null;
  private _htmlEl: HTMLDivElement | null = null;
  private _priceEl: HTMLDivElement | null = null;
  private _countdownEl: HTMLDivElement | null = null;

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
    if (this._htmlEl) {
      this._htmlEl.remove();
      this._htmlEl = null;
    }
  }

  // -- Public API --

  /** Provide the overlay div and chart API so we render as HTML above order labels. */
  setOverlay(overlay: HTMLDivElement, chart: IChartApi): void {
    if (this._overlay === overlay && this._chartApi === chart) return;
    // Clean up previous HTML if re-initialized
    if (this._htmlEl) {
      this._htmlEl.remove();
      this._htmlEl = null;
    }
    this._overlay = overlay;
    this._chartApi = chart;
    this._buildHtml();
  }

  /** Update the displayed price (called on each quote OR after loading bars) */
  updatePrice(price: number, live: boolean): void {
    this._price = price;
    this._priceText = this._formatPrice(price);
    this._isLive = live;
    if (live) this._updateCountdown();
    else this._countdownText = '';
    this._syncHtml();
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
    this._syncHtml();
    this._requestUpdate?.();
  }

  // -- ISeriesPrimitive rendering --

  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    // Sync HTML position on every LWC render (scroll/zoom/resize)
    this._syncHtml();
    return this._emptyPaneViews;
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

  private _buildHtml(): void {
    if (!this._overlay) return;

    const el = document.createElement('div');
    el.style.cssText =
      `position:absolute;right:0;text-align:center;pointer-events:none;` +
      `transform:translateY(-50%);box-sizing:border-box;z-index:25;` +
      `font-family:${FONT_FAMILY};display:none;background:#fff;`;
    this._overlay.appendChild(el);
    this._htmlEl = el;

    const priceEl = document.createElement('div');
    priceEl.style.cssText = 'font-size:12px;font-weight:bold;color:#131722;line-height:1;padding:3px 0 0;';
    el.appendChild(priceEl);
    this._priceEl = priceEl;

    const countdownEl = document.createElement('div');
    countdownEl.style.cssText = 'font-size:12px;color:#131722;line-height:1;padding:1px 0 3px;';
    el.appendChild(countdownEl);
    this._countdownEl = countdownEl;
  }

  private _syncHtml(): void {
    if (!this._htmlEl || !this._series || !this._chartApi) return;

    if (this._price === 0) {
      this._htmlEl.style.display = 'none';
      return;
    }

    const y = this._series.priceToCoordinate(this._price);
    if (y === null) {
      this._htmlEl.style.display = 'none';
      return;
    }

    let psWidth = 56;
    try { psWidth = this._chartApi.priceScale('right').width(); } catch { /* */ }

    this._htmlEl.style.display = '';
    this._htmlEl.style.top = `${y}px`;
    this._htmlEl.style.width = `${psWidth}px`;
    this._priceEl!.textContent = this._priceText;

    if (this._countdownText) {
      this._countdownEl!.style.display = '';
      this._countdownEl!.textContent = this._countdownText;
      this._priceEl!.style.padding = '3px 0 0';
    } else {
      this._countdownEl!.style.display = 'none';
      this._priceEl!.style.padding = '3px 0 3px';
    }
  }

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
      this._syncHtml();
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
