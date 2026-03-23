/**
 * Shared marker label renderer — draws an arrow + pill label at a given
 * position on the canvas. Used by both the MarkerRenderer (drawing system)
 * and TradeZonePrimitive (trade entry/exit labels).
 *
 * All coordinates are in bitmap (device pixel) space.
 */

import { FONT_FAMILY } from '../../../constants/layout';
import { COLOR_LABEL_TEXT, COLOR_TEXT } from '../../../constants/colors';

export interface MarkerLabelOptions {
  /** Bitmap X coordinate of the anchor point */
  x: number;
  /** Bitmap Y coordinate of the anchor point (candle extreme) */
  anchorY: number;
  /** Label text displayed in the pill */
  text: string;
  /** Color of the arrow line and arrowhead */
  arrowColor: string;
  /** 'above' = pill above anchor, arrow points down; 'below' = pill below */
  placement: 'above' | 'below';
  /** Vertical pixel ratio (device pixels per CSS pixel) */
  vpr: number;
  /** Horizontal pixel ratio */
  hpr: number;
  /** Optional font size in CSS pixels (default 12) */
  fontSize?: number;
}

export function drawMarkerLabel(ctx: CanvasRenderingContext2D, opts: MarkerLabelOptions): void {
  const { x, anchorY, text, arrowColor, placement, vpr, hpr } = opts;
  const fontSize = Math.round((opts.fontSize ?? 12) * vpr);
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;

  const textWidth = ctx.measureText(text).width;

  const padH = Math.round(6 * hpr);
  const padV = Math.round(3 * vpr);
  const pillW = textWidth + padH * 2;
  const pillH = fontSize + padV * 2;
  const arrowLen = Math.round(18 * vpr);
  const gap = Math.round(14 * vpr);

  let pillY: number;
  let arrowStartY: number;
  let arrowEndY: number;

  if (placement === 'above') {
    pillY = anchorY - gap - arrowLen - pillH;
    arrowStartY = pillY + pillH;
    arrowEndY = anchorY - gap;
  } else {
    pillY = anchorY + gap + arrowLen;
    arrowStartY = pillY;
    arrowEndY = anchorY + gap;
  }

  // Arrow line
  ctx.strokeStyle = arrowColor;
  ctx.lineWidth = Math.round(1.5 * hpr);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x, arrowStartY);
  ctx.lineTo(x, arrowEndY);
  ctx.stroke();

  // Arrowhead
  const headSize = Math.round(4 * vpr);
  ctx.beginPath();
  if (placement === 'above') {
    ctx.moveTo(x, arrowEndY + headSize);
    ctx.lineTo(x - headSize, arrowEndY);
    ctx.lineTo(x + headSize, arrowEndY);
  } else {
    ctx.moveTo(x, arrowEndY - headSize);
    ctx.lineTo(x - headSize, arrowEndY);
    ctx.lineTo(x + headSize, arrowEndY);
  }
  ctx.closePath();
  ctx.fillStyle = arrowColor;
  ctx.fill();

  // Label text (white with dark outline for contrast)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textY = pillY + pillH / 2;
  ctx.strokeStyle = COLOR_LABEL_TEXT;
  ctx.lineWidth = Math.round(3 * vpr);
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, textY);
  ctx.fillStyle = COLOR_TEXT;
  ctx.fillText(text, x, textY);
}
