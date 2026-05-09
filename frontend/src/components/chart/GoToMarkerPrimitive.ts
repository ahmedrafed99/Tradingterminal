import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitivePaneViewZOrder,
  SeriesType,
  Time,
  ISeriesApi,
  IChartApi,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { COLOR_BORDER, COLOR_TEXT } from '../../constants/colors';
import { FONT_FAMILY } from '../../constants/layout';
import { nyTimeFormatterRaw } from './chartTheme';

const LABEL_H = 20;
const LABEL_PAD_X = 8;
const TRI_H = 6;
const TRI_W = 9;
const GAP = 3; // gap between candle low and triangle tip
const FONT = `bold 12px ${FONT_FAMILY}`;

// ---------------------------------------------------------------------------
// Renderer — tooltip box + upward triangle anchored to the candle low
// ---------------------------------------------------------------------------
class GoToTooltipRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _x: number,       // candle centre X
    private _lowY: number,    // candle low Y coordinate
    private _text: string,
    private _paneW: number,
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.font = FONT;

      const textW = ctx.measureText(this._text).width;
      const boxW = textW + LABEL_PAD_X * 2;
      const boxH = LABEL_H;

      // Triangle tip sits just below the candle low
      const tipY   = this._lowY + GAP;
      const baseY  = tipY + TRI_H;   // top of the box
      const botY   = baseY + boxH;

      // Clamp box centre so it stays inside pane
      const half = boxW / 2;
      const cx = Math.max(half + 4, Math.min(this._x, this._paneW - half - 4));
      const boxL = cx - half;

      // Single path: triangle + box merged so there's no seam
      const r = 3;
      ctx.fillStyle = COLOR_BORDER;
      ctx.beginPath();
      ctx.moveTo(this._x, tipY);                          // triangle tip
      ctx.lineTo(this._x + TRI_W / 2, baseY);            // triangle right foot
      ctx.lineTo(boxL + boxW - r, baseY);                 // box top-right lead-in
      ctx.arcTo(boxL + boxW, baseY, boxL + boxW, baseY + r, r);
      ctx.lineTo(boxL + boxW, baseY + boxH - r);
      ctx.arcTo(boxL + boxW, baseY + boxH, boxL + boxW - r, baseY + boxH, r);
      ctx.lineTo(boxL + r, baseY + boxH);
      ctx.arcTo(boxL, baseY + boxH, boxL, baseY + boxH - r, r);
      ctx.lineTo(boxL, baseY + r);
      ctx.arcTo(boxL, baseY, boxL + r, baseY, r);
      ctx.lineTo(this._x - TRI_W / 2, baseY);            // triangle left foot
      ctx.closePath();
      ctx.fill();

      // Label text
      ctx.fillStyle = COLOR_TEXT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._text, cx, baseY + boxH / 2);

      ctx.restore();

      void botY; // consumed by layout; suppress lint
    });
  }
}

// ---------------------------------------------------------------------------
// PaneView
// ---------------------------------------------------------------------------
class GoToTooltipPaneView implements IPrimitivePaneView {
  private _x = 0;
  private _lowY = 0;
  private _text = '';
  private _paneW = 0;

  update(x: number, lowY: number, text: string, paneW: number) {
    this._x = x; this._lowY = lowY; this._text = text; this._paneW = paneW;
  }

  renderer(): IPrimitivePaneRenderer {
    return new GoToTooltipRenderer(this._x, this._lowY, this._text, this._paneW);
  }

  zOrder(): PrimitivePaneViewZOrder { return 'top'; }
}

// ---------------------------------------------------------------------------
// Public primitive
// ---------------------------------------------------------------------------
export class GoToMarkerPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: IChartApi | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _targetTime: number | null = null;

  private _view = new GoToTooltipPaneView();
  private _viewArr: readonly IPrimitivePaneView[] = [this._view];
  private _empty: readonly IPrimitivePaneView[] = [];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this._chart = (param as unknown as { chart: IChartApi }).chart ?? null;
  }

  detached(): void {
    this._series = null;
    this._requestUpdate = null;
    this._chart = null;
  }

  setTarget(utcSeconds: number | null): void {
    this._targetTime = utcSeconds;
    this._requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (this._targetTime === null || !this._chart || !this._series) return this._empty;

    const ts = this._chart.timeScale();
    const x = ts.timeToCoordinate(this._targetTime as unknown as Time);
    if (x === null) return this._empty;

    // Find the candle low at the target time to anchor the tooltip
    let lowY = 60; // fallback: near top of pane
    try {
      const data = (this._series as unknown as { data(): Array<{ time: number; low: number }> }).data();
      const candle = data.find(d => d.time === this._targetTime);
      if (candle) {
        const y = this._series!.priceToCoordinate(candle.low);
        if (y !== null) lowY = y;
      }
    } catch { /* ignore */ }

    const paneW = this._chart.chartElement().querySelector('canvas')?.clientWidth ?? 600;
    this._view.update(x, lowY, nyTimeFormatterRaw(this._targetTime), paneW);
    return this._viewArr;
  }

  updateAllViews(): void {}
}
