import type { IChartApi, ISeriesApi } from 'lightweight-charts';

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
const BG_COLOR = '#2a2e39';
const TEXT_COLOR = '#d1d4dc';

/**
 * Crosshair price label rendered as an HTML element in the chart overlay.
 * Uses z-index:30 so it always renders above PriceLevelLine axis labels (z-index:20).
 */
export class CrosshairLabelPrimitive {
  private _overlay: HTMLDivElement;
  private _series: ISeriesApi<'Candlestick'>;
  private _chart: IChartApi;
  private _el: HTMLDivElement;
  private _decimals = 2;
  private _tickSize = 0;
  private _suppressed = false;

  constructor(overlay: HTMLDivElement, series: ISeriesApi<'Candlestick'>, chart: IChartApi) {
    this._overlay = overlay;
    this._series = series;
    this._chart = chart;

    this._el = document.createElement('div');
    this._el.style.cssText =
      `position:absolute;right:0;height:18px;font-size:12px;font-weight:bold;` +
      `font-family:${FONT_FAMILY};line-height:18px;text-align:center;` +
      `pointer-events:none;transform:translateY(-50%);box-sizing:border-box;` +
      `background:${BG_COLOR};color:${TEXT_COLOR};z-index:30;display:none;`;
    overlay.appendChild(this._el);
  }

  destroy(): void {
    this._el.remove();
  }

  setDecimals(decimals: number): void {
    this._decimals = decimals;
  }

  setTickSize(tickSize: number): void {
    this._tickSize = tickSize;
  }

  /** Hide the label while a drawing is being dragged (avoids 1-frame lag flicker) */
  suppress(suppressed: boolean): void {
    this._suppressed = suppressed;
    if (suppressed) this._el.style.display = 'none';
  }

  updateCrosshairPrice(price: number | null): void {
    if (this._suppressed) return;
    if (price === null) {
      this._el.style.display = 'none';
      return;
    }

    // Snap price to tick size
    const snapped = this._tickSize > 0
      ? Math.round(price / this._tickSize) * this._tickSize
      : price;
    const y = this._series.priceToCoordinate(snapped);
    if (y === null) {
      this._el.style.display = 'none';
      return;
    }

    let psWidth = 56;
    try { psWidth = this._chart.priceScale('right').width(); } catch { /* */ }

    this._el.style.display = '';
    this._el.style.top = `${y}px`;
    this._el.style.width = `${psWidth}px`;
    this._el.textContent = snapped.toLocaleString('en-US', {
      minimumFractionDigits: this._decimals,
      maximumFractionDigits: this._decimals,
    });
  }
}
