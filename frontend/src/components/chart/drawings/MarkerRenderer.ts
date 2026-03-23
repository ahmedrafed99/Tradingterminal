import type { IChartApiBase, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { MarkerDrawing } from '../../../types/drawing';
import { drawMarkerLabel } from './markerLabel';

class MarkerRendererImpl implements IPrimitivePaneRenderer {
  private _drawing: MarkerDrawing;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;

  constructor(drawing: MarkerDrawing, series: ISeriesApi<SeriesType>, chart: IChartApiBase<Time>) {
    this._drawing = drawing;
    this._series = series;
    this._chart = chart;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, verticalPixelRatio: vpr, horizontalPixelRatio: hpr }) => {
      const cssX = this._chart.timeScale().timeToCoordinate(this._drawing.time as unknown as Time);
      if (cssX === null) return;

      // Look up candle data to anchor at high/low instead of the price itself
      const seriesData = this._series.data() as any[];
      const bar = seriesData.find((d: any) => d.time === this._drawing.time);

      let anchorPrice: number;
      if (this._drawing.placement === 'below') {
        // Arrow below candle — anchor to candle low
        anchorPrice = bar?.low ?? this._drawing.price;
      } else {
        // Arrow above candle — anchor to candle high
        anchorPrice = bar?.high ?? this._drawing.price;
      }

      const cssAnchorY = this._series.priceToCoordinate(anchorPrice);
      if (cssAnchorY === null) return;

      drawMarkerLabel(ctx, {
        x: cssX * hpr,
        anchorY: cssAnchorY * vpr,
        text: this._drawing.label,
        arrowColor: this._drawing.color,
        placement: this._drawing.placement,
        vpr,
        hpr,
      });
    });
  }
}

export class MarkerPaneView implements IPrimitivePaneView {
  private _drawing: MarkerDrawing;
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApiBase<Time>;

  constructor(drawing: MarkerDrawing, _selected: boolean, series: ISeriesApi<SeriesType>, chart: IChartApiBase<Time>) {
    this._drawing = drawing;
    this._series = series;
    this._chart = chart;
  }

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new MarkerRendererImpl(this._drawing, this._series, this._chart);
  }
}
