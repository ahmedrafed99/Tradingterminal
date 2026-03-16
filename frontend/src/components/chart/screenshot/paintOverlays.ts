import { COLOR_TEXT_MUTED, COLOR_TEXT } from '../../../constants/colors';
import type { ChartEntry } from './chartRegistry';

const FONT = "12px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

/**
 * Paint HTML overlay elements (instrument label, OHLC tooltip, position/order lines)
 * onto a canvas context. Used by both screenshots and video recording.
 */
export function paintOverlays(
  ctx: CanvasRenderingContext2D,
  entry: ChartEntry,
  plotWidth: number,
  canvasHeight: number,
  options: { showPositions: boolean },
): void {
  // Clip to plot area so text doesn't bleed into price scale
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, plotWidth, canvasHeight);
  ctx.clip();

  const instrText = entry.instrumentEl?.textContent || '';
  const ohlcText = entry.ohlcEl?.textContent || '';

  ctx.font = `500 ${FONT}`;
  let x = 10;
  const y = 18;

  if (instrText) {
    ctx.fillStyle = COLOR_TEXT_MUTED;
    ctx.fillText(instrText, x, y);
    x += ctx.measureText(instrText).width + 10;
  }
  if (ohlcText) {
    const metrics = ctx.measureText(ohlcText);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 3, y - 12, metrics.width + 6, 16);
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(ohlcText, x, y);
  }

  ctx.restore();

  // Paint position entry + associated orders (SL/TP)
  if (options.showPositions) {
    const lines = entry.orderLinesRef.current;
    for (const line of lines) {
      line.paintToCanvas(ctx, plotWidth);
    }
  }
}
