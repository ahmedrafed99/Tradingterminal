import { COLOR_TEXT, COLOR_BORDER, COLOR_LABEL_TEXT } from '../../../constants/colors';
import { FONT_FAMILY } from '../../../constants/layout';

/**
 * Composites a time-banner strip above the chart canvas.
 * The banner is only added to the copied PNG — the preview stays unchanged.
 *
 * Font and color are read from the live [data-ny-clock] span so the banner
 * always matches the toolbar clock automatically.
 *
 * All sizes are scaled by DPR because chartCanvas is at physical pixel resolution
 * (from LWC's takeScreenshot(true)), while getComputedStyle returns CSS pixels.
 */
export function addTimeBanner(chartCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const dpr = window.devicePixelRatio || 1;

  const now = new Date();
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const timeText = `${dateFmt.format(now)}  ${timeFmt.format(now)} New York`;

  // Read font + color from the live clock element — getComputedStyle returns CSS px
  const clockEl = document.querySelector('[data-ny-clock]') as HTMLElement | null;
  let cssFontSize = 12;
  let fontWeight = '400';
  let fontFamily = FONT_FAMILY;
  let color = COLOR_TEXT;
  if (clockEl) {
    const cs = getComputedStyle(clockEl);
    cssFontSize = parseFloat(cs.fontSize) || 12;
    fontWeight = cs.fontWeight;
    fontFamily = cs.fontFamily;
    color = cs.color;
  }

  // Scale CSS px → physical px for the bitmap canvas
  const bannerHeight = Math.round(30 * dpr);
  const separatorHeight = Math.round(1 * dpr);
  const canvasWidth = chartCanvas.width;
  const canvasHeight = bannerHeight + separatorHeight + chartCanvas.height;

  const out = document.createElement('canvas');
  out.width = canvasWidth;
  out.height = canvasHeight;
  const ctx = out.getContext('2d')!;

  // Banner background
  ctx.fillStyle = COLOR_LABEL_TEXT;
  ctx.fillRect(0, 0, canvasWidth, bannerHeight);

  // Time text — top-left, font scaled to physical pixels
  ctx.font = `${fontWeight} ${cssFontSize * dpr}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(timeText, Math.round(10 * dpr), bannerHeight / 2);

  // Separator line
  ctx.fillStyle = COLOR_BORDER;
  ctx.fillRect(0, bannerHeight, canvasWidth, separatorHeight);

  // Chart image below
  ctx.drawImage(chartCanvas, 0, bannerHeight + separatorHeight);

  return out;
}
