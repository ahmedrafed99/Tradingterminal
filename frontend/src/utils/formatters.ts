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

// Reusable Intl formatters — avoids allocating a new one per call
const fmtDateTime = new Intl.DateTimeFormat('en-US', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  hour12: false, timeZone: 'America/New_York',
});
const fmtTimeOnly = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false, timeZone: 'America/New_York',
});

/** Format an ISO timestamp to HH:MM:SS (or MM/DD HH:MM if showDate) in New York time */
export function formatTime(iso: string, showDate = false): string {
  const date = new Date(iso);
  return showDate ? fmtDateTime.format(date) : fmtTimeOnly.format(date);
}

/** Duration between two ISO timestamps in milliseconds */
export function durationMs(entryIso: string, exitIso: string): number {
  return new Date(exitIso).getTime() - new Date(entryIso).getTime();
}

/** Format milliseconds as "Xh Xm Xs" / "Xm Xs" / "Xs" */
export function formatDuration(ms: number): string {
  if (ms < 0) return '\u2014';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Return the Tailwind color class for a P&L value.
 * Positive → green, negative → red, zero/null → neutral (default #d1d4dc).
 */
export function getPnlColorClass(value: number | null | undefined, neutral = 'text-(--color-text-muted)'): string {
  if (value == null) return neutral;
  return value > 0 ? 'text-(--color-buy)' : value < 0 ? 'text-(--color-sell)' : neutral;
}

/** "just now" / "5m ago" / "3h ago" / "10d ago" — null returns "never" */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

/** Seconds → "1-minute" / "5-minute" / "1-hour" / "1-day" / "unknown" */
export function formatTimeframe(seconds: number | null | undefined): string {
  if (!seconds) return 'unknown';
  if (seconds < 60) return `${seconds}-second`;
  if (seconds < 3600) return `${seconds / 60}-minute`;
  if (seconds < 86400) return `${seconds / 3600}-hour`;
  return `${seconds / 86400}-day`;
}

/** Unix epoch seconds → "YYYY-MM-DD HH:MM:SS UTC" */
export function formatEpochUtc(epoch: number): string {
  return new Date(epoch * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** Format TopstepX account names into { label, id } for selective privacy blur */
export function formatAccountName(raw: string): { label: string; id: string } {
  // Practice accounts: "PRAC..." → "Practice" + id
  if (/^prac/i.test(raw)) {
    const id = raw.split('-').pop() ?? raw;
    return { label: 'Practice', id };
  }
  // Combine accounts: "$50K TRADING COMBINE | 50KTC-V2-..." or just "50KTC-V2-..."
  const combineMatch = raw.match(/\$?(\d+)K\s*(?:TRADING\s*COMBINE)?/i) ?? raw.match(/^(\d+)KTC/i);
  if (combineMatch) {
    const size = combineMatch[1];
    const id = raw.split('-').pop() ?? raw;
    return { label: `${size}K Combine`, id };
  }
  // Fallback: treat whole name as label
  return { label: raw, id: '' };
}
