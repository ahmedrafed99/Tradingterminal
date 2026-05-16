/**
 * Semantic color tokens for JS/canvas contexts.
 * Reads from CSS custom properties defined in styles/tokens.css at runtime.
 *
 * tokens.css is the SINGLE source of truth — edit colors there only.
 *
 * For Tailwind classes: bg-(--color-surface)
 * For inline styles:    var(--color-surface)
 * For canvas/ctx code:  import { COLOR_SURFACE } from 'constants/colors'
 */

const root = getComputedStyle(document.documentElement);
const getCssVar = (name: string) => root.getPropertyValue(name).trim();

// ── Trade / Direction ──
export const COLOR_BUY = getCssVar('--color-buy');
export const COLOR_SELL = getCssVar('--color-sell');

// ── Accent ──
export const COLOR_ACCENT = getCssVar('--color-accent');
export const COLOR_ACCENT_HOVER = getCssVar('--color-accent-hover');
export const COLOR_ACCENT_TEXT = getCssVar('--color-accent-text');

// ── Text ──
export const COLOR_TEXT = getCssVar('--color-text');
export const COLOR_TEXT_BRIGHT = getCssVar('--color-text-bright');
export const COLOR_TEXT_MUTED = getCssVar('--color-text-muted');
export const COLOR_TEXT_DIM = getCssVar('--color-text-dim');
export const COLOR_TEXT_MEDIUM = getCssVar('--color-text-medium');

// ── Surface / Border ──
export const COLOR_SURFACE = getCssVar('--color-surface');
export const COLOR_BORDER = getCssVar('--color-border');
export const COLOR_BG = getCssVar('--color-bg');
export const COLOR_INPUT = getCssVar('--color-input');
export const COLOR_HOVER_ROW = getCssVar('--color-hover-row');
export const COLOR_HOVER_TOOLBAR = getCssVar('--color-hover-toolbar');
export const COLOR_TABLE_STRIPE = getCssVar('--color-table-stripe');
export const COLOR_POPOVER = getCssVar('--color-popover');
export const COLOR_FOCUS_RING = getCssVar('--color-focus-ring');

// ── Heatmap ──
export const COLOR_HEAT_GREEN = getCssVar('--color-heat-green');
export const COLOR_HEAT_RED = getCssVar('--color-heat-red');

// ── Status ──
export const COLOR_WARNING = getCssVar('--color-warning');
export const COLOR_ERROR = getCssVar('--color-error');

// ── News Events ──
export const COLOR_NEWS_EVENT = getCssVar('--color-news-event');
export const COLOR_NEWS_EVENT_HOVER = getCssVar('--color-news-event-hover');

// ── Buy / Sell Button Shades ──
export const COLOR_BTN_BUY = getCssVar('--color-btn-buy');
export const COLOR_BTN_BUY_HOVER = getCssVar('--color-btn-buy-hover');
export const COLOR_BTN_SELL = getCssVar('--color-btn-sell');
export const COLOR_BTN_SELL_HOVER = getCssVar('--color-btn-sell-hover');

// ── Chart Line Colors ──
export const COLOR_LINE_BUY = getCssVar('--color-line-buy');
export const COLOR_LINE_BUY_HOVER = getCssVar('--color-line-buy-hover');
export const COLOR_LINE_SELL = getCssVar('--color-line-sell');
export const COLOR_LINE_SELL_HOVER = getCssVar('--color-line-sell-hover');

// ── Label System ──
export const COLOR_LABEL_BG = getCssVar('--color-label-bg');
export const COLOR_CHART_LABEL_OVERLAY = getCssVar('--color-chart-label-overlay');
export const COLOR_LABEL_TEXT = getCssVar('--color-label-text');
export const COLOR_LABEL_CLOSE = getCssVar('--color-label-close');
export const COLOR_LABEL_CLOSE_HOVER = getCssVar('--color-label-close-hover');
export const COLOR_TRAIL_HOVER = getCssVar('--color-trail-hover');
export const COLOR_HANDLE_STROKE = getCssVar('--color-handle-stroke');
