import { COLOR_TEXT_MUTED, COLOR_TEXT } from '../../../constants/colors';
import { FONT_FAMILY } from '../../../constants/layout';
import type { ChartEntry } from './chartRegistry';

const FONT = `12px ${FONT_FAMILY}`;

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
  totalWidth?: number,
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
      line.paintToCanvas(ctx, plotWidth, totalWidth);
    }
  }

  // Paint crosshair price label (HTML div — not captured by takeScreenshot).
  // Gate on style.top (not display) — when crosshair leaves, display is set to 'none'
  // but top retains the last position, so we can still paint it in snapshots.
  const crosshairEl = entry.crosshairLabelEl;
  if (crosshairEl && crosshairEl.style.top && crosshairEl.textContent) {
    const cy = parseFloat(crosshairEl.style.top);
    const cw = parseFloat(crosshairEl.style.width);
    const fullW = totalWidth ?? plotWidth;
    const h = 20;
    const text = crosshairEl.textContent || '';
    ctx.save();
    ctx.font = `bold ${FONT}`;
    ctx.fillStyle = crosshairEl.style.background;
    ctx.fillRect(fullW - cw, cy - h / 2, cw, h);
    ctx.fillStyle = crosshairEl.style.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, fullW - cw / 2, cy);
    ctx.restore();
  }
}
