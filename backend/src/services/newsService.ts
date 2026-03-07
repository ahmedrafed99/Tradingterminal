import axios from 'axios';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FXStreetEvent {
  id: string;
  eventId: string;
  dateUtc: string;
  name: string;
  countryCode: string;
  currencyCode: string;
  volatility: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  actual: number | null;
  consensus: number | null;
  previous: number | null;
  isBetterThanExpected: boolean | null;
  isSpeech: boolean;
  isPreliminary: boolean;
}

export interface NewsEvent {
  id: string;
  title: string;
  date: string;
  impact: 'high' | 'medium' | 'low';
  category: 'fed' | 'inflation' | 'employment' | 'other';
  actual: number | null;
  consensus: number | null;
  previous: number | null;
  isBetterThanExpected: boolean | null;
  country: string;
  currency: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

let cachedEvents: NewsEvent[] | null = null;
let cacheTimestamp = 0;

// ---------------------------------------------------------------------------
// Categorisation
// ---------------------------------------------------------------------------

const FED_KEYWORDS = ['fomc', 'fed ', 'federal reserve', 'interest rate', 'monetary policy', 'fed chair'];
const INFLATION_KEYWORDS = ['cpi', 'pce', 'inflation', 'consumer price', 'producer price', 'ppi'];
const EMPLOYMENT_KEYWORDS = ['nonfarm', 'non-farm', 'payroll', 'unemployment', 'jobless', 'employment', 'jobs', 'labor'];

function categorise(name: string): NewsEvent['category'] {
  const lower = name.toLowerCase();
  if (FED_KEYWORDS.some(k => lower.includes(k))) return 'fed';
  if (INFLATION_KEYWORDS.some(k => lower.includes(k))) return 'inflation';
  if (EMPLOYMENT_KEYWORDS.some(k => lower.includes(k))) return 'employment';
  return 'other';
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getDateRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0)); // last day of next month
  return {
    from: from.toISOString().slice(0, 19),
    to: to.toISOString().slice(0, 19),
  };
}

// ---------------------------------------------------------------------------
// Fetch & normalise
// ---------------------------------------------------------------------------

async function fetchFromFXStreet(): Promise<NewsEvent[]> {
  const { from, to } = getDateRange();
  const url = `https://calendar-api.fxstreet.com/en/api/v1/eventDates/${from}/${to}`;

  const { data } = await axios.get<FXStreetEvent[]>(url, {
    headers: {
      Origin: 'https://www.fxstreet.com',
      Referer: 'https://www.fxstreet.com/',
    },
    timeout: 15_000,
  });

  return data
    .filter(e => e.countryCode === 'US' || e.currencyCode === 'USD')
    .filter(e => e.volatility === 'HIGH' || e.volatility === 'MEDIUM')
    .map(e => ({
      id: e.id,
      title: e.name,
      date: e.dateUtc,
      impact: e.volatility.toLowerCase() as NewsEvent['impact'],
      category: categorise(e.name),
      actual: e.actual,
      consensus: e.consensus,
      previous: e.previous,
      isBetterThanExpected: e.isBetterThanExpected,
      country: e.countryCode,
      currency: e.currencyCode,
    }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getEconomicEvents(): Promise<NewsEvent[]> {
  const now = Date.now();
  if (cachedEvents && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedEvents;
  }

  const events = await fetchFromFXStreet();
  cachedEvents = events;
  cacheTimestamp = Date.now();
  return events;
}
