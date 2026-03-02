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
