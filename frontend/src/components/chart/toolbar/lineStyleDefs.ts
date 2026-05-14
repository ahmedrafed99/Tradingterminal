import type { LineStyle } from '../../../types/drawing';

export const LINE_STYLE_DEFS: { style: LineStyle; label: string; dasharray?: string; linecap?: string }[] = [
  { style: 'solid',  label: 'Solid' },
  { style: 'dashed', label: 'Dashed', dasharray: '6 4' },
  { style: 'dotted', label: 'Dotted', dasharray: '1.5 3', linecap: 'round' },
];
