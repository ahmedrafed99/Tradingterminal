/**
 * Layout tokens — single source of truth for font family, font sizes,
 * z-index stack, box shadows, and border radii.
 *
 * Usage:
 *   import { FONT_FAMILY, FONT_SIZE, Z, SHADOW, RADIUS } from 'constants/layout';
 *
 * For canvas ctx.font strings:
 *   ctx.font = `${FONT_SIZE.BASE}px ${FONT_FAMILY}`;
 */

// ── CSS var reader (same pattern as colors.ts) ──
const root = getComputedStyle(document.documentElement);
const v = (name: string) => root.getPropertyValue(name).trim();
const px = (name: string) => parseInt(v(name), 10) || 0;

// ── Font Family ──
// Reads from --font-family in tokens.css
export const FONT_FAMILY =
  v('--font-family') || "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

// ── Font Sizes ──
// Reads from --font-size-* in tokens.css — never use a raw number, always reference FONT_SIZE.*
export const FONT_SIZE = {
  XXXS: px('--font-size-xxxs') || 8,   // tiny icon labels, density indicators
  XXS: px('--font-size-xxs') || 9,     // compact secondary text
  XS: px('--font-size-xs') || 10,      // small labels, captions
  SM: px('--font-size-sm') || 11,      // section labels, form fields, compact UI
  BASE: px('--font-size-base') || 12,  // body text, charts, default
  MD: px('--font-size-md') || 13,      // medium text, inputs
  LG: px('--font-size-lg') || 14,      // buttons, subheadings
  XL: px('--font-size-xl') || 16,      // section titles
  XXL: px('--font-size-xxl') || 18,    // modal titles, large headings
};

// ── Z-Index Stack ──
// Ordered layers — never use a raw number, always reference Z.*
export const Z = {
  HEADER: 10,      // sticky headers, loading overlays, labels
  OVERLAY: 20,     // overlay containers
  TOOLBAR: 30,     // drawing toolbar, quick-order, scroll buttons
  TOOLBAR_EDIT: 40,// drawing edit toolbar (above toolbar)
  DROPDOWN: 50,    // dropdowns, popovers, modals, selects
  TOAST: 100,      // toasts, top-level color popovers
} as const;

// ── Box Shadows ──
export const SHADOW = {
  SM: '0 1px 3px rgba(0,0,0,0.4)',
  MD: '0 4px 12px rgba(0,0,0,0.5)',
  LG: '0 4px 16px rgba(0,0,0,0.4)',
  XL: '0 4px 24px rgba(0,0,0,0.5)',
  XXL: '0 8px 32px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.06)',
  HERO: '0 24px 80px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.06)',
  /** Outline ring for selected swatches */
  ring: (color: string) => `0 0 0 1px ${color}`,
} as const;

// ── Border Radius ──
export const RADIUS = {
  XS: 1,
  SM: 2,
  MD: 3,
  LG: 4,
  XL: 8,
  PILL: 9,
  CIRCLE: '50%' as const,
} as const;
