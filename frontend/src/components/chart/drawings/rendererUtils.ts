import type { LineStyle } from '../../../types/drawing';

/**
 * Applies the correct lineDash pattern to ctx based on lineStyle and strokeWidth.
 * Call before ctx.stroke(). After stroke, call ctx.setLineDash([]) to reset.
 * pixelRatio should be the relevant DPR for the stroke direction.
 */
export function applyLineDash(
  ctx: CanvasRenderingContext2D,
  lineStyle: LineStyle | undefined,
  strokeWidth: number,
  pixelRatio: number,
): void {
  if (!lineStyle || lineStyle === 'solid') {
    ctx.setLineDash([]);
    return;
  }
  const sw = strokeWidth;
  if (lineStyle === 'dashed') {
    ctx.setLineDash([sw * 4 * pixelRatio, sw * 3 * pixelRatio]);
    ctx.lineCap = 'butt';
  } else {
    // dotted
    ctx.setLineDash([sw * 1.2 * pixelRatio, sw * 2.5 * pixelRatio]);
    ctx.lineCap = 'round';
  }
}
