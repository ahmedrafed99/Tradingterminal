import { useState, useEffect } from 'react';

// Cached formatters for NY timezone conversion — avoids per-call Intl allocation
const fmtNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' });
const fmtNYWithMin = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

// ---------------------------------------------------------------------------
// Holiday store — populated imperatively after API fetch
// ---------------------------------------------------------------------------

interface HolidayInfo {
  name: string;
  closesAt: string;   // CT time e.g. "11:45", or "closed" for full-day
  fullClose: boolean;
}

let _holidayDates: Set<string> = new Set();
let _holidayInfo: Map<string, HolidayInfo> = new Map();

export function setHolidays(holidays: { date: string; name: string; closesAt: string; fullClose: boolean }[]): void {
  _holidayDates = new Set(holidays.map(h => h.date));
  _holidayInfo = new Map(holidays.map(h => [h.date, { name: h.name, closesAt: h.closesAt, fullClose: h.fullClose }]));
}

export function getTodayET(): string {
  const parts = fmtNYWithMin.formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isHolidayToday(): { holiday: false } | { holiday: true; name: string; closesAt: string; fullClose: boolean } {
  const today = getTodayET();
  const info = _holidayInfo.get(today);
  if (info) return { holiday: true, ...info };
  return { holiday: false };
}

export function getHolidayName(dateStr: string): string | undefined {
  return _holidayInfo.get(dateStr)?.name;
}

/** Convert CT "HH:MM" to ET hour+minute (CT + 1 = ET). */
function ctToET(ct: string): { h: number; m: number } {
  const [hh, mm] = ct.split(':').map(Number);
  return { h: hh + 1, m: mm };
}

// ---------------------------------------------------------------------------

/** Extract ET day-of-week, hour, and minute from the current time. */
function getETComponents(): { day: number; h: number; m: number } {
  const parts = fmtNYWithMin.formatToParts(new Date());
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
  const month = get('month');
  const dayOfMonth = get('day');
  const year = get('year');
  const h = get('hour') % 24; // hour12:false can return 24 for midnight in some engines
  const m = get('minute');
  // Build a UTC date from ET date components just to get day-of-week
  const day = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
  return { day, h, m };
}

/**
 * Returns true if CME futures are currently in their regular trading session.
 * Closed windows:
 *   - Daily maintenance: 17:00–18:00 ET (Mon–Thu)
 *   - Weekend:           Friday 17:00 ET → Sunday 18:00 ET
 */
export function isFuturesMarketOpen(): boolean {
  const holidayCheck = isHolidayToday();
  if (holidayCheck.holiday) {
    if (holidayCheck.fullClose) return false;
    // Early close: open until closesAt CT
    const { h, m } = getETComponents();
    const closeET = ctToET(holidayCheck.closesAt);
    if (h > closeET.h || (h === closeET.h && m >= closeET.m)) return false;
  }

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

    // Holiday check
    const yyyy = ny.getUTCFullYear();
    const mm = String(ny.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(ny.getUTCDate()).padStart(2, '0');
    const holInfo = _holidayInfo.get(`${yyyy}-${mm}-${dd}`);
    if (holInfo) {
      if (holInfo.fullClose) return true;
      const closeET = ctToET(holInfo.closesAt);
      if (hour > closeET.h || (hour === closeET.h && ny.getUTCMinutes() >= closeET.m)) return true;
    }

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

  const holidayCheck = isHolidayToday();
  if (holidayCheck.holiday) {
    const label = holidayCheck.fullClose
      ? `${holidayCheck.name} — closed all day`
      : `${holidayCheck.name} — early close ${holidayCheck.closesAt} CT`;
    if (day === 5) return `${label}, reopens Sun 18:00 ET`;
    return `${label}, reopens today 18:00 ET`;
  }

  // Mon–Thu maintenance (17:00–18:00) or Sunday before 18:00 → reopens same day
  if ((day >= 1 && day <= 4 && h === 17) || (day === 0 && h < 18)) {
    return 'reopens today 18:00 ET';
  }
  // Weekend: Friday 17:00+ or Saturday
  return 'reopens Sun 18:00 ET';
}

/* ------------------------------------------------------------------ */
/*  Market schedule abstraction — dispatches by instrument market type */
/* ------------------------------------------------------------------ */

export type MarketType = 'futures' | 'crypto';

export interface SessionInfo {
  /** 0–1 progress through the current session (open or closed) */
  progress: number;
  /** Short day label for progress bar, e.g. "WED" */
  dayLabel: string;
  /** Start time label, e.g. "18:00" */
  startLabel: string;
  /** End time label, e.g. "17:00" */
  endLabel: string;
  /** Human description, e.g. "It'll close in 3 hours and 12 minutes." */
  countdown: string;
}

interface MarketSchedule {
  isOpen(): boolean;
  getNextOpenLabel(): string;
  getNextCloseLabel(): string;
  getSessionInfo(): SessionInfo;
}

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

function formatCountdown(totalMin: number, verb: 'close' | 'reopen'): string {
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hrs === 0) return `It'll ${verb} in ${mins} minute${mins !== 1 ? 's' : ''}.`;
  if (mins === 0) return `It'll ${verb} in ${hrs} hour${hrs !== 1 ? 's' : ''}.`;
  return `It'll ${verb} in ${hrs} hour${hrs !== 1 ? 's' : ''} and ${mins} minute${mins !== 1 ? 's' : ''}.`;
}

/** Session progress info for CME futures. */
function getCmeSessionInfo(): SessionInfo {
  const { day, h, m } = getETComponents();
  const isOpen = isFuturesMarketOpen();

  if (isOpen) {
    const holidayCheck = isHolidayToday();
    // Early-close holiday: session is shorter
    if (holidayCheck.holiday && !holidayCheck.fullClose) {
      const closeET = ctToET(holidayCheck.closesAt);
      const closeMin = closeET.h * 60 + closeET.m;
      const SESSION_LEN = (24 * 60 - 18 * 60) + closeMin; // overnight + morning
      const minSinceOpen = h >= 18 ? (h - 18) * 60 + m : (h + 6) * 60 + m;
      return {
        progress: Math.min(1, minSinceOpen / SESSION_LEN),
        dayLabel: DAY_NAMES[day],
        startLabel: '18:00',
        endLabel: `${holidayCheck.closesAt} CT`,
        countdown: formatCountdown(SESSION_LEN - minSinceOpen, 'close'),
      };
    }
    // Normal open session: 18:00 → 17:00 next day = 23 hours = 1380 min
    const SESSION_LEN = 1380;
    const minSinceOpen = h >= 18 ? (h - 18) * 60 + m : (h + 6) * 60 + m;
    return {
      progress: Math.min(1, minSinceOpen / SESSION_LEN),
      dayLabel: DAY_NAMES[day],
      startLabel: '18:00',
      endLabel: '17:00',
      countdown: formatCountdown(SESSION_LEN - minSinceOpen, 'close'),
    };
  }

  // Holiday (closed — full-day or past early close)
  const holidayCheck = isHolidayToday();
  if (holidayCheck.holiday) {
    const closeLabel = holidayCheck.fullClose ? 'Closed all day' : `Closed ${holidayCheck.closesAt} CT`;
    const reopenLabel = day === 5 ? 'Sun 18:00' : '18:00';
    const minUntilReopen = day === 5
      ? (24 - h) * 60 - m + 24 * 60 + 18 * 60
      : (18 - h) * 60 - m;
    return {
      progress: Math.min(1, (h * 60 + m) / (24 * 60)),
      dayLabel: DAY_NAMES[day],
      startLabel: closeLabel,
      endLabel: reopenLabel,
      countdown: formatCountdown(Math.max(0, minUntilReopen), 'reopen'),
    };
  }

  // Weekend: Fri 17:00 → Sun 18:00 = 49 hours = 2940 min
  if (day === 5 || day === 6 || (day === 0 && h < 18)) {
    const WEEKEND_LEN = 2940;
    let minSinceClosed: number;
    if (day === 5) minSinceClosed = (h - 17) * 60 + m;
    else if (day === 6) minSinceClosed = (24 + 7) * 60 + h * 60 + m; // 7h (Fri 17→24) + Sat hours
    else minSinceClosed = (24 + 7 + 24) * 60 + h * 60 + m; // Fri 7h + Sat 24h + Sun hours
    // Simpler: count from Fri 17:00
    // Fri: (h-17)*60+m, Sat: 7*60 + 24*60*0 + h*60+m ... let me just use day offsets
    const dayOffset = day === 5 ? 0 : day === 6 ? 1 : 2;
    minSinceClosed = dayOffset * 24 * 60 + (day === 5 ? (h - 17) * 60 + m : h * 60 + m);
    if (day === 5) minSinceClosed = (h - 17) * 60 + m;
    else if (day === 6) minSinceClosed = 7 * 60 + h * 60 + m; // 7h remaining Fri + all of Sat so far
    else minSinceClosed = 7 * 60 + 24 * 60 + h * 60 + m; // 7h Fri + 24h Sat + Sun so far
    return {
      progress: Math.min(1, minSinceClosed / WEEKEND_LEN),
      dayLabel: DAY_NAMES[day],
      startLabel: 'Fri 17:00',
      endLabel: 'Sun 18:00',
      countdown: formatCountdown(WEEKEND_LEN - minSinceClosed, 'reopen'),
    };
  }

  // Daily maintenance: 17:00 → 18:00 = 60 min
  const MAINT_LEN = 60;
  const minSinceClosed = m;
  return {
    progress: Math.min(1, minSinceClosed / MAINT_LEN),
    dayLabel: DAY_NAMES[day],
    startLabel: '17:00',
    endLabel: '18:00',
    countdown: formatCountdown(MAINT_LEN - minSinceClosed, 'reopen'),
  };
}

/** Human-readable label for when the market next closes (CME). */
function getCmeNextCloseLabel(): string {
  const { day, h } = getETComponents();
  // Friday: closes at 17:00 (weekend start)
  if (day === 5 && h < 17) return 'closes today 17:00 ET';
  // Sun–Thu: closes at 17:00 (daily maintenance)
  if (day >= 0 && day <= 4 && h >= 18) return 'closes today 17:00 ET';
  // Sunday 18:xx — just opened
  if (day === 0 && h === 18) return 'closes tomorrow 17:00 ET';
  return 'closes today 17:00 ET';
}

const EMPTY_SESSION: SessionInfo = {
  progress: 0, dayLabel: '', startLabel: '', endLabel: '', countdown: '',
};

const cmeFuturesSchedule: MarketSchedule = {
  isOpen: isFuturesMarketOpen,
  getNextOpenLabel,
  getNextCloseLabel: getCmeNextCloseLabel,
  getSessionInfo: getCmeSessionInfo,
};

const alwaysOpenSchedule: MarketSchedule = {
  isOpen: () => true,
  getNextOpenLabel: () => '',
  getNextCloseLabel: () => '',
  getSessionInfo: () => EMPTY_SESSION,
};

const schedules: Record<MarketType, MarketSchedule> = {
  futures: cmeFuturesSchedule,
  crypto: alwaysOpenSchedule,
};

/** Get the market schedule for a given market type. */
export function getSchedule(type?: MarketType): MarketSchedule {
  return schedules[type ?? 'futures'] ?? cmeFuturesSchedule;
}

/** Reactive hook — re-evaluates every second so components stay in sync. */
export function useMarketStatus(marketType: MarketType = 'futures'): {
  open: boolean; reopenLabel: string; closeLabel: string; session: SessionInfo;
} {
  const schedule = getSchedule(marketType);

  const [status, setStatus] = useState(() => ({
    open: schedule.isOpen(),
    reopenLabel: schedule.getNextOpenLabel(),
    closeLabel: schedule.getNextCloseLabel(),
    session: schedule.getSessionInfo(),
  }));

  useEffect(() => {
    // Crypto is always open — no timer needed
    if (marketType === 'crypto') {
      setStatus({ open: true, reopenLabel: '', closeLabel: '', session: EMPTY_SESSION });
      return;
    }
    const id = setInterval(() => {
      setStatus({
        open: schedule.isOpen(),
        reopenLabel: schedule.getNextOpenLabel(),
        closeLabel: schedule.getNextCloseLabel(),
        session: schedule.getSessionInfo(),
      });
    }, 1000);
    return () => clearInterval(id);
  }, [marketType, schedule]);

  return status;
}
