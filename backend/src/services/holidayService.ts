import { getRawEvents } from './fxstreetCalendar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HolidayDate {
  date: string;       // "YYYY-MM-DD"
  name: string;
  closesAt: string;   // CT time e.g. "11:45", or "closed" for full-day closure
  fullClose: boolean;
}

// ---------------------------------------------------------------------------
// Early-close time map (CME futures)
// Source: CME Group / Topstep annual schedule. Close times are Central Time.
// FXStreet gives us dates + names dynamically; this map adds the close time.
// ---------------------------------------------------------------------------

const EARLY_CLOSE_MAP: Record<string, { closesAt: string; fullClose: boolean }> = {
  "new year's day":            { closesAt: 'closed',  fullClose: true },
  "martin luther king":        { closesAt: '11:45',   fullClose: false },
  "martin l. king":            { closesAt: '11:45',   fullClose: false },
  "presidents' day":           { closesAt: '11:45',   fullClose: false },
  "president's day":           { closesAt: '11:45',   fullClose: false },
  "presidents day":            { closesAt: '11:45',   fullClose: false },
  "good friday":               { closesAt: '08:00',   fullClose: false },
  "memorial day":              { closesAt: '11:45',   fullClose: false },
  "juneteenth":                { closesAt: '11:45',   fullClose: false },
  "independence day":          { closesAt: '11:45',   fullClose: false },
  "labor day":                 { closesAt: '11:45',   fullClose: false },
  "thanksgiving day":          { closesAt: '11:45',   fullClose: false },
  "thanksgiving":              { closesAt: '11:45',   fullClose: false },
  "christmas day":             { closesAt: 'closed',  fullClose: true },
  "christmas":                 { closesAt: 'closed',  fullClose: true },
};

const DEFAULT_CLOSE = { closesAt: '11:45', fullClose: false };

function getCloseInfo(name: string): { closesAt: string; fullClose: boolean } {
  const lower = name.toLowerCase();
  for (const [key, info] of Object.entries(EARLY_CLOSE_MAP)) {
    if (lower.includes(key)) return info;
  }
  return DEFAULT_CLOSE;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const HOLIDAY_CATEGORY_ID = '7dfaef86-c3fe-4e76-9421-8958cc2f9a0d';

export async function getHolidays(): Promise<HolidayDate[]> {
  const raw = await getRawEvents();
  const seen = new Set<string>();
  const holidays: HolidayDate[] = [];

  for (const e of raw) {
    if (e.categoryId === HOLIDAY_CATEGORY_ID && e.countryCode === 'US') {
      const date = e.dateUtc.slice(0, 10);
      if (!seen.has(date)) {
        seen.add(date);
        holidays.push({ date, name: e.name, ...getCloseInfo(e.name) });
      }
    }
  }

  return holidays;
}
