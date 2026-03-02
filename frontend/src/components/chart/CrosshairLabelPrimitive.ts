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

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
const BG_COLOR = '#2a2e39';
const TEXT_COLOR = '#d1d4dc';

class CrosshairLabelRenderer implements IPrimitivePaneRenderer {
  private _text: string;
  private _y: number;

  constructor(text: string, y: number) {
    this._text = text;
    this._y = y;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const fontSize = 12;
      const vPad = 3;
      const totalHeight = fontSize + vPad * 2;
      const top = this._y - totalHeight / 2;

      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, top, mediaSize.width, totalHeight);

      ctx.fillStyle = TEXT_COLOR;
      ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(this._text, mediaSize.width / 2, top + vPad);
    });
  }
}

class CrosshairLabelPaneView implements IPrimitivePaneView {
  _text = '';
  _y = 0;

  update(text: string, y: number): void {
    this._text = text;
    this._y = y;
  }

  renderer(): IPrimitivePaneRenderer {
    return new CrosshairLabelRenderer(this._text, this._y);
  }

  zOrder(): string {
    return 'top';
  }
}

export class CrosshairLabelPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _price: number | null = null;
  private _decimals = 2;
  private _tickSize = 0;

  private _paneView = new CrosshairLabelPaneView();
  private _paneViewsArr: readonly IPrimitivePaneView[] = [this._paneView];
  private _emptyArr: readonly IPrimitivePaneView[] = [];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._series = null;
    this._requestUpdate = null;
  }

  setDecimals(decimals: number): void {
    this._decimals = decimals;
  }

  setTickSize(tickSize: number): void {
    this._tickSize = tickSize;
  }

  updateCrosshairPrice(price: number | null): void {
    this._price = price;
    this._requestUpdate?.();
  }

  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    if (!this._series || this._price === null) return this._emptyArr;
    // Snap price to tick size
    const price = this._tickSize > 0
      ? Math.round(this._price / this._tickSize) * this._tickSize
      : this._price;
    const y = this._series.priceToCoordinate(price);
    if (y === null) return this._emptyArr;

    const text = price.toLocaleString('en-US', {
      minimumFractionDigits: this._decimals,
      maximumFractionDigits: this._decimals,
    });
    this._paneView.update(text, y);
    return this._paneViewsArr;
  }

  updateAllViews(): void {
    // Coordinates recalculated in priceAxisPaneViews
  }
}
