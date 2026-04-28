import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesPrimitiveAxisView,
  PrimitivePaneViewZOrder,
  SeriesType,
  Time,
  ISeriesApi,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { COLOR_BG } from '../../constants/colors';
import { FONT_FAMILY } from '../../constants/layout';
import { contrastText } from './hooks/labelUtils';

// ---------------------------------------------------------------------------
// Invisible axis view — tells LWC about our label position for overlap avoidance
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
  textColor(): string { return COLOR_BG; }
  backColor(): string { return '#ffffff'; }
  visible(): boolean { return false; }
  tickVisible(): boolean { return false; }
}

// ---------------------------------------------------------------------------
// Canvas renderer — draws the price + optional countdown badge on the price
// axis pane canvas at zOrder 'normal' (crosshair label paints over it at 'top')
// ---------------------------------------------------------------------------
const FONT_BOLD = `bold 12px ${FONT_FAMILY}`;
const FONT_NORMAL = `12px ${FONT_FAMILY}`;
const PRICE_ROW_H = 20;
const TIMER_ROW_H = 16;

class CountdownAxisRenderer implements IPrimitivePaneRenderer {
  private _y: number;
  private _priceText: string;
  private _countdownText: string;
  private _bgColor: string;
  private _textColor: string;

  constructor(y: number, priceText: string, countdownText: string, bgColor: string, textColor: string) {
    this._y = y;
    this._priceText = priceText;
    this._countdownText = countdownText;
    this._bgColor = bgColor;
    this._textColor = textColor;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const hasTimer = this._countdownText !== '';
      const totalH = hasTimer ? PRICE_ROW_H + TIMER_ROW_H : PRICE_ROW_H;
      const top = this._y - totalH / 2;

      ctx.fillStyle = this._bgColor;
      ctx.fillRect(0, top, mediaSize.width, totalH);

      ctx.fillStyle = this._textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cx = mediaSize.width / 2;

      ctx.font = FONT_BOLD;
      ctx.fillText(this._priceText, cx, top + PRICE_ROW_H / 2);

      if (hasTimer) {
        ctx.font = FONT_NORMAL;
        ctx.fillText(this._countdownText, cx, top + PRICE_ROW_H + TIMER_ROW_H / 2);
      }
    });
  }
}

class CountdownAxisPaneView implements IPrimitivePaneView {
  private _y = 0;
  private _priceText = '';
  private _countdownText = '';
  private _bgColor = '#26a69a';
  private _textColor = '#000000';

  update(y: number, priceText: string, countdownText: string, bgColor: string, textColor: string): void {
    this._y = y;
    this._priceText = priceText;
    this._countdownText = countdownText;
    this._bgColor = bgColor;
    this._textColor = textColor;
  }

  renderer(): IPrimitivePaneRenderer {
    return new CountdownAxisRenderer(this._y, this._priceText, this._countdownText, this._bgColor, this._textColor);
  }

  zOrder(): PrimitivePaneViewZOrder { return 'normal'; }
}

// ---------------------------------------------------------------------------
// CountdownPrimitive — attach to the candlestick series
// ---------------------------------------------------------------------------
export class CountdownPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;

  private _price = 0;
  private _open = 0;
  private _upColor = '#26a69a';
  private _downColor = '#ef5350';
  private _priceText = '';
  private _countdownText = '';
  private _isLive = false;
  private _periodSec = 60;
  private _formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  private _intervalId: ReturnType<typeof setInterval> | null = null;

  private _axisView = new PriceLabelAxisView();
  private _axisViewsArr: readonly ISeriesPrimitiveAxisView[] = [this._axisView];
  private _emptyAxisViews: readonly ISeriesPrimitiveAxisView[] = [];
  private _axisPaneView = new CountdownAxisPaneView();
  private _axisPaneViewArr: readonly IPrimitivePaneView[] = [this._axisPaneView];
  private _emptyPaneViews: readonly IPrimitivePaneView[] = [];

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

  updatePrice(price: number, live: boolean): void {
    const priceChanged = this._price !== price;
    this._price = price;
    this._isLive = live;
    if (live) this._updateCountdown();
    else this._countdownText = '';
    if (priceChanged) {
      this._priceText = this._formatPrice(price);
      this._requestUpdate?.();
    }
  }

  setPeriod(periodSec: number): void {
    this._periodSec = periodSec;
  }

  setColors(upColor: string, downColor: string): void {
    this._upColor = upColor;
    this._downColor = downColor;
    this._requestUpdate?.();
  }

  setOpen(open: number): void {
    this._open = open;
    this._requestUpdate?.();
  }

  setDecimals(decimals: number): void {
    this._formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

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

    const candleColor = (this._open === 0 || this._price >= this._open) ? this._upColor : this._downColor;
    const textColor = contrastText(candleColor, COLOR_BG);
    this._axisPaneView.update(y as number, this._priceText, this._countdownText, candleColor, textColor);
    return this._axisPaneViewArr;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    if (!this._series || this._price === 0) return this._emptyAxisViews;
    const y = this._series.priceToCoordinate(this._price);
    if (y === null) return this._emptyAxisViews;

    this._axisView.update(y as number, this._priceText);
    return this._axisViewsArr;
  }

  updateAllViews(): void {}

  // -- Internals --

  private _formatPrice(price: number): string {
    return this._formatter.format(price);
  }

  private _updateCountdown(): void {
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
