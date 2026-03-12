/**
 * Shared formatting utilities used across bottom panel tabs, top bar, and order panel.
 */

/** "CON.F.US.MNQ.H26" → "MNQH6" (symbol + month code + last digit of year) */
export function shortSymbol(contractId: string): string {
  const parts = contractId.split('.');
  if (parts.length >= 5) {
    const sym = parts[3];          // MNQ
    const expiry = parts[4];       // H26
    return sym + expiry.charAt(0) + expiry.slice(-1); // MNQH6
  }
  return contractId;
}

/** Format a price with 2 decimal places and locale separators */
export function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format an ISO timestamp to HH:MM:SS (or MM/DD HH:MM if showDate) in New York time */
export function formatTime(iso: string, showDate = false): string {
  const d = new Date(iso);
  if (showDate) {
    return d.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    });
  }
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
  });
}

/** Duration between two ISO timestamps in milliseconds */
export function durationMs(entryIso: string, exitIso: string): number {
  return new Date(exitIso).getTime() - new Date(entryIso).getTime();
}

/** Format milliseconds as "Xh Xm Xs" / "Xm Xs" / "Xs" */
export function formatDuration(ms: number): string {
  if (ms < 0) return '\u2014';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Return the Tailwind color class for a P&L value.
 * Positive → green, negative → red, zero/null → neutral (default #d1d4dc).
 */
export function getPnlColorClass(value: number | null | undefined, neutral = 'text-(--color-text)'): string {
  if (value == null) return neutral;
  return value > 0 ? 'text-(--color-buy)' : value < 0 ? 'text-(--color-sell)' : neutral;
}
