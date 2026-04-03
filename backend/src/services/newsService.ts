import { getRawEvents } from './fxstreetCalendar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
// Public API
// ---------------------------------------------------------------------------

export async function getEconomicEvents(): Promise<NewsEvent[]> {
  const raw = await getRawEvents();

  return raw
    .filter(e => e.countryCode === 'US' || e.currencyCode === 'USD')
    .filter(e => e.volatility === 'HIGH' || e.volatility === 'MEDIUM' || e.volatility === 'LOW')
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
