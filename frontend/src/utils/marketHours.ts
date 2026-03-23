import { useState, useEffect } from 'react';

/**
 * Returns true if CME futures are currently in their regular trading session.
 * Closed windows:
 *   - Daily maintenance: 17:00–18:00 ET (Mon–Thu)
 *   - Weekend:           Friday 17:00 ET → Sunday 18:00 ET
 */
export function isFuturesMarketOpen(): boolean {
  const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const et = new Date(etStr);
  const day = et.getDay(); // 0=Sun … 6=Sat
  const h = et.getHours();
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
    const ny = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
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

/** Reactive hook — re-evaluates every second so components stay in sync. */
export function useMarketStatus(): boolean {
  const [open, setOpen] = useState(() => isFuturesMarketOpen());
  useEffect(() => {
    const id = setInterval(() => setOpen(isFuturesMarketOpen()), 1000);
    return () => clearInterval(id);
  }, []);
  return open;
}
