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
import { COLOR_BORDER, COLOR_TEXT } from '../../constants/colors';
import { FONT_FAMILY } from '../../constants/layout';

const BG_COLOR = COLOR_BORDER;
const TEXT_COLOR = COLOR_TEXT;
const LABEL_H = 20;
const FONT = `bold 12px ${FONT_FAMILY}`;

class CrosshairAxisRenderer implements IPrimitivePaneRenderer {
  private _y: number;
  private _text: string;

  constructor(y: number, text: string) {
    this._y = y;
    this._text = text;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const top = this._y - LABEL_H / 2;
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, top, mediaSize.width, LABEL_H);
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._text, mediaSize.width / 2, this._y);
    });
  }
}

class CrosshairAxisPaneView implements IPrimitivePaneView {
  private _y = 0;
  private _text = '';

  update(y: number, text: string): void {
    this._y = y;
    this._text = text;
  }

  renderer(): IPrimitivePaneRenderer {
    return new CrosshairAxisRenderer(this._y, this._text);
  }

  zOrder(): PrimitivePaneViewZOrder { return 'top'; }
}

export class CrosshairLabelPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _price: number | null = null;
  private _decimals = 2;
  private _tickSize = 0;
  private _suppressed = false;

  private _paneView = new CrosshairAxisPaneView();
  private _paneViewArr: readonly IPrimitivePaneView[] = [this._paneView];
  private _emptyPaneViews: readonly IPrimitivePaneView[] = [];

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

  suppress(suppressed: boolean): void {
    this._suppressed = suppressed;
    this._requestUpdate?.();
  }

  updateCrosshairPrice(price: number | null): void {
    this._price = price;
    this._requestUpdate?.();
  }

  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    if (this._price === null || this._suppressed || !this._series) return this._emptyPaneViews;
    const snapped = this._tickSize > 0
      ? Math.round(this._price / this._tickSize) * this._tickSize
      : this._price;
    const y = this._series.priceToCoordinate(snapped);
    if (y === null) return this._emptyPaneViews;
    const text = snapped.toLocaleString('en-US', {
      minimumFractionDigits: this._decimals,
      maximumFractionDigits: this._decimals,
    });
    this._paneView.update(y as number, text);
    return this._paneViewArr;
  }

  updateAllViews(): void {}
}
