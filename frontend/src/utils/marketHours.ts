import { useState, useEffect } from 'react';

// Cached formatters for NY timezone conversion — avoids per-call Intl allocation
const fmtNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' });
const fmtNYFull = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

/** Extract ET day-of-week and hour from the current time. */
function getETComponents(): { day: number; h: number } {
  const parts = fmtNYFull.formatToParts(new Date());
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
  const month = get('month');
  const dayOfMonth = get('day');
  const year = get('year');
  const h = get('hour') % 24; // hour12:false can return 24 for midnight in some engines
  // Build a UTC date from ET date components just to get day-of-week
  const day = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
  return { day, h };
}

/**
 * Returns true if CME futures are currently in their regular trading session.
 * Closed windows:
 *   - Daily maintenance: 17:00–18:00 ET (Mon–Thu)
 *   - Weekend:           Friday 17:00 ET → Sunday 18:00 ET
 */
export function isFuturesMarketOpen(): boolean {
  const { day, h } = getETComponents();
  if (day === 6) return false;            // all Saturday
  if (day === 5 && h >= 17) return false; // Friday 17:00+ → weekend start
  if (day === 0 && h < 18) return false;  // Sunday before 18:00 → weekend end
  if (h === 17) return false;             // daily maintenance 17:00–18:00 ET (Mon–Thu)
  return true;
}

/**
 * Trading-hours-only duration between two timestamps in milliseconds.
 * Excludes CME closed periods:
 *   - Weekend: Friday 17:00 ET → Sunday 18:00 ET
 *   - Daily maintenance: Mon–Thu 17:00–18:00 ET
 */
export function tradingDurationMs(entryIso: string, exitIso: string): number {
  const entryMs = new Date(entryIso).getTime();
  const exitMs = new Date(exitIso).getTime();
  const wallMs = exitMs - entryMs;
  if (wallMs <= 0) return 0;
  if (wallMs < 3_600_000) return wallMs; // < 1h can't span a closed window

  function computeOffset(utcMs: number): number {
    const d = new Date(utcMs);
    const ny = new Date(fmtNY.format(d));
    return ny.getTime() - d.getTime();
  }

  function isClosed(utcMs: number, offset: number): boolean {
    const ny = new Date(utcMs + offset);
    const day = ny.getUTCDay();
    const hour = ny.getUTCHours();
    if (day === 6) return true;               // Saturday
    if (day === 5 && hour >= 17) return true;  // Friday 17:00+
    if (day === 0 && hour < 18) return true;   // Sunday before 18:00
    if (hour === 17) return true;              // Mon–Thu maintenance
    return false;
  }

  const STEP = 60_000; // 1-minute resolution
  let offset = computeOffset(entryMs);
  let lastOffsetCheck = entryMs;
  let closedMs = 0;

  for (let t = entryMs; t < exitMs; t += STEP) {
    if (t - lastOffsetCheck > 43_200_000) {
      offset = computeOffset(t);
      lastOffsetCheck = t;
    }
    if (isClosed(t, offset)) {
      closedMs += Math.min(STEP, exitMs - t);
    }
  }

  return Math.max(0, wallMs - closedMs);
}

/** Human-readable label for when the market next reopens. */
export function getNextOpenLabel(): string {
  const { day, h } = getETComponents();
  // Mon–Thu maintenance (17:00–18:00) or Sunday before 18:00 → reopens same day
  if ((day >= 1 && day <= 4 && h === 17) || (day === 0 && h < 18)) {
    return 'reopens today 18:00 ET';
  }
  // Weekend: Friday 17:00+ or Saturday
  return 'reopens Sun 18:00 ET';
}

/** Reactive hook — re-evaluates every second so components stay in sync. */
export function useMarketStatus(): { open: boolean; reopenLabel: string } {
  const [status, setStatus] = useState(() => ({
    open: isFuturesMarketOpen(),
    reopenLabel: getNextOpenLabel(),
  }));
  useEffect(() => {
    const id = setInterval(() => {
      setStatus({ open: isFuturesMarketOpen(), reopenLabel: getNextOpenLabel() });
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return status;
}
