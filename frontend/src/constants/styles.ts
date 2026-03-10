/**
 * Reusable Tailwind class-string constants for repeated UI patterns.
 */

// ── Section label (appears 14+ times) ──
export const SECTION_LABEL = 'text-[10px] uppercase tracking-wider text-[#787b86]';

// ── Table row stripe (bottom-panel tabs) ──
export const TABLE_ROW_STRIPE = 'bg-[#0d1117]/40';
export const TABLE_ROW_HOVER = 'hover:bg-[#1e222d]/50 transition-colors';
export const TABLE_ROW = `${TABLE_ROW_HOVER}`;

// ── Input variants ──
export const INPUT_BASE = 'w-full border rounded-lg text-sm text-white placeholder-[#434651] focus:outline-none focus:border-[#2962ff] disabled:opacity-50 transition-colors';
export const INPUT_DARK = `${INPUT_BASE} bg-[#111] border-[#2a2e39]`;
export const INPUT_SURFACE = `${INPUT_BASE} bg-[#131722] border-[#2a2e39] text-[13px] text-[#d1d4dc] placeholder-[#363a45]`;
