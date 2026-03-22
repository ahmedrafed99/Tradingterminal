/** Shared helpers for stats components. */

/** Convert a hex color like '#26a69a' to 'rgba(38, 166, 154, alpha)'. */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function pnlColor(v: number): string {
  if (v > 0) return 'var(--color-buy)';
  if (v < 0) return 'var(--color-sell)';
  return 'var(--color-text-muted)';
}

export function fmtDollar(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

/** Pick a human-friendly grid step for a given value range. */
export function niceStep(range: number, targetLines: number): number {
  const rough = range / targetLines;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let nice: number;
  if (norm <= 1.5) nice = 1;
  else if (norm <= 3.5) nice = 2;
  else if (norm <= 7.5) nice = 5;
  else nice = 10;
  return nice * mag || 1;
}
