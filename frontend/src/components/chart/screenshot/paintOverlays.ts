import type { ChartEntry } from './chartRegistry';

/**
 * Paint HTML overlay elements (instrument label, OHLC tooltip) onto a canvas context.
 *
 * All font sizes, weights, families, and colours are read directly from the live DOM
 * via getComputedStyle — the screenshot always mirrors the real chart automatically,
 * with no hardcoded constants to maintain.
 */
export function paintOverlays(
  ctx: CanvasRenderingContext2D,
  entry: ChartEntry,
  plotWidth: number,
  canvasHeight: number,
  _totalWidth?: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, plotWidth, canvasHeight);
  ctx.clip();

  ctx.textBaseline = 'alphabetic';

  let x = 10;
  const textY = 18;

  // ── Instrument label (symbol · timeframe) ────────────────────────────────
  const instrEl = entry.instrumentEl;
  if (instrEl?.textContent) {
    const cs = getComputedStyle(instrEl);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.fillStyle = cs.color;
    ctx.fillText(instrEl.textContent, x, textY);
    x += ctx.measureText(instrEl.textContent).width + 10;
  }

  // ── OHLC tooltip ─────────────────────────────────────────────────────────
  // The tooltip is built from alternating label spans (O H L C) and value spans,
  // each with its own colour. We walk child nodes and paint each individually
  // so colours match the live chart exactly.
  const ohlcEl = entry.ohlcEl;
  if (ohlcEl?.textContent) {
    const cs = getComputedStyle(ohlcEl);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

    // Background pill — read directly from element's computed style
    const bg = cs.backgroundColor;
    const totalW = ctx.measureText(ohlcEl.textContent).width;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      ctx.fillStyle = bg;
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
    }
    ctx.fillRect(x - 3, textY - 12, totalW + 6, 16);

    // Paint each child node with its own computed colour
    let cx = x;
    for (const child of ohlcEl.childNodes) {
      const text = child.textContent;
      if (!text) continue;
      if (child.nodeType === Node.ELEMENT_NODE) {
        ctx.fillStyle = getComputedStyle(child as HTMLElement).color;
      } else {
        // text node (space separator) — inherit parent colour
        ctx.fillStyle = cs.color;
      }
      ctx.fillText(text, cx, textY);
      cx += ctx.measureText(text).width;
    }
  }

  ctx.restore();
}
