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

/** Reactive hook — re-evaluates every second so components stay in sync. */
export function useMarketStatus(): boolean {
  const [open, setOpen] = useState(() => isFuturesMarketOpen());
  useEffect(() => {
    const id = setInterval(() => setOpen(isFuturesMarketOpen()), 1000);
    return () => clearInterval(id);
  }, []);
  return open;
}
