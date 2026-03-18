import { COLOR_TEXT_MUTED, COLOR_BORDER, COLOR_LABEL_TEXT } from '../../../constants/colors';
import { FONT_FAMILY } from '../../../constants/layout';

/**
 * Composites a time-banner strip above the chart canvas.
 * The banner is only added to the copied PNG — the preview stays unchanged.
 */
export function addTimeBanner(chartCanvas: HTMLCanvasElement): HTMLCanvasElement {
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

  const bannerH = 30;
  const sepH = 1;
  const w = chartCanvas.width;
  const h = bannerH + sepH + chartCanvas.height;

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;

  // Banner background
  ctx.fillStyle = COLOR_LABEL_TEXT;
  ctx.fillRect(0, 0, w, bannerH);

  // Time text — top-left
  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.fillStyle = COLOR_TEXT_MUTED;
  ctx.textBaseline = 'middle';
  ctx.fillText(timeText, 10, bannerH / 2);

  // Separator line
  ctx.fillStyle = COLOR_BORDER;
  ctx.fillRect(0, bannerH, w, sepH);

  // Chart image below
  ctx.drawImage(chartCanvas, 0, bannerH + sepH);

  return out;
}
