/** Return the UTC ISO timestamp for the CME session start (6 pm New York). */
export function getCmeSessionStart(): string {
  const now = new Date();
  // Get current NY time as a Date (parsed in local TZ frame)
  const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const sessionStart = new Date(nyNow);
  sessionStart.setHours(18, 0, 0, 0);
  if (nyNow.getHours() < 18) sessionStart.setDate(sessionStart.getDate() - 1);
  // Convert back to real UTC, strip milliseconds
  const offsetMs = nyNow.getTime() - now.getTime();
  const utc = new Date(sessionStart.getTime() - offsetMs);
  utc.setMilliseconds(0);
  return utc.toISOString();
}

// ---------------------------------------------------------------------------
// Date preset helpers
// ---------------------------------------------------------------------------

export type DatePreset = 'today' | 'week' | 'month';

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
};

/** Convert a NY-local Date to UTC ISO string (no milliseconds). */
function nyToUtcIso(nyDate: Date): string {
  const now = new Date();
  const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const offsetMs = nyNow.getTime() - now.getTime();
  const utc = new Date(nyDate.getTime() - offsetMs);
  utc.setMilliseconds(0);
  return utc.toISOString();
}

function getTodayStart(): string {
  const now = new Date();
  const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  nyNow.setHours(0, 0, 0, 0);
  return nyToUtcIso(nyNow);
}

function getWeekStart(): string {
  const now = new Date();
  const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = nyNow.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // Monday = start of week
  nyNow.setDate(nyNow.getDate() - diff);
  nyNow.setHours(0, 0, 0, 0);
  return nyToUtcIso(nyNow);
}

function getMonthStart(): string {
  const now = new Date();
  const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  nyNow.setDate(1);
  nyNow.setHours(0, 0, 0, 0);
  return nyToUtcIso(nyNow);
}

export function getDateRange(preset: DatePreset): { startTimestamp: string; endTimestamp?: string } {
  switch (preset) {
    case 'today': return { startTimestamp: getTodayStart() };
    case 'week': return { startTimestamp: getWeekStart() };
    case 'month': return { startTimestamp: getMonthStart() };
  }
}
