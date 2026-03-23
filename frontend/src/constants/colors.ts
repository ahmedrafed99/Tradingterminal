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
const v = (name: string) => root.getPropertyValue(name).trim();

// ── Trade / Direction ──
export const COLOR_BUY = v('--color-buy');
export const COLOR_SELL = v('--color-sell');

// ── Accent ──
export const COLOR_ACCENT = v('--color-accent');
export const COLOR_ACCENT_HOVER = v('--color-accent-hover');
export const COLOR_ACCENT_TEXT = v('--color-accent-text');

// ── Text ──
export const COLOR_TEXT = v('--color-text');
export const COLOR_TEXT_BRIGHT = v('--color-text-bright');
export const COLOR_TEXT_MUTED = v('--color-text-muted');
export const COLOR_TEXT_DIM = v('--color-text-dim');
export const COLOR_TEXT_MEDIUM = v('--color-text-medium');

// ── Surface / Border ──
export const COLOR_SURFACE = v('--color-surface');
export const COLOR_BORDER = v('--color-border');
export const COLOR_BG = v('--color-bg');
export const COLOR_INPUT = v('--color-input');
export const COLOR_HOVER_ROW = v('--color-hover-row');
export const COLOR_HOVER_TOOLBAR = v('--color-hover-toolbar');
export const COLOR_TABLE_STRIPE = v('--color-table-stripe');
export const COLOR_POPOVER = v('--color-popover');
export const COLOR_FOCUS_RING = v('--color-focus-ring');

// ── Heatmap ──
export const COLOR_HEAT_GREEN = v('--color-heat-green');
export const COLOR_HEAT_RED = v('--color-heat-red');

// ── Status ──
export const COLOR_WARNING = v('--color-warning');
export const COLOR_ERROR = v('--color-error');

// ── Buy / Sell Button Shades ──
export const COLOR_BTN_BUY = v('--color-btn-buy');
export const COLOR_BTN_BUY_HOVER = v('--color-btn-buy-hover');
export const COLOR_BTN_SELL = v('--color-btn-sell');
export const COLOR_BTN_SELL_HOVER = v('--color-btn-sell-hover');

// ── Chart Line Colors ──
export const COLOR_LINE_BUY = v('--color-line-buy');
export const COLOR_LINE_BUY_HOVER = v('--color-line-buy-hover');
export const COLOR_LINE_SELL = v('--color-line-sell');
export const COLOR_LINE_SELL_HOVER = v('--color-line-sell-hover');

// ── Label System ──
export const COLOR_LABEL_BG = v('--color-label-bg');
export const COLOR_LABEL_TEXT = v('--color-label-text');
export const COLOR_LABEL_CLOSE = v('--color-label-close');
export const COLOR_LABEL_CLOSE_HOVER = v('--color-label-close-hover');
export const COLOR_HANDLE_STROKE = v('--color-handle-stroke');
