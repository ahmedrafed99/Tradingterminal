/**
 * Reusable Tailwind class-string constants for repeated UI patterns.
 * Colors reference CSS custom properties from styles/tokens.css.
 */

// ── Section label (appears 14+ times) ──
export const SECTION_LABEL = 'text-[10px] uppercase tracking-wider text-(--color-text-muted)';

// ── Table row stripe (bottom-panel tabs) ──
export const TABLE_ROW_STRIPE = 'bg-(--color-table-stripe)/40';
export const TABLE_ROW_HOVER = 'hover:bg-(--color-surface)/50 transition-colors';
export const TABLE_ROW = `${TABLE_ROW_HOVER}`;

// ── Input variants ──
export const INPUT_BASE = 'w-full border rounded-lg text-sm text-white placeholder-(--color-text-dim) focus:outline-none focus:border-(--color-accent) disabled:opacity-50 transition-colors';
export const INPUT_DARK = `${INPUT_BASE} bg-(--color-input) border-(--color-border)`;
export const INPUT_SURFACE = `${INPUT_BASE} bg-(--color-bg) border-(--color-border) text-[13px] text-(--color-text) placeholder-(--color-hover-toolbar)`;
