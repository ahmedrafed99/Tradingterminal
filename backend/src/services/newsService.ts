import axios from 'axios';
import fs from 'fs';
import path from 'path';

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
// Disk cache
// ---------------------------------------------------------------------------

interface DiskCache {
  fetchedAt: number;
  dateRange: string; // "YYYY-MM" of the `from` month, used to detect month rollover
  events: NewsEvent[];
}

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const CACHE_FILE = path.join(__dirname, '..', '..', 'data', 'news-calendar.json');

let memCache: DiskCache | null = null;

function loadDiskCache(): DiskCache | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw) as DiskCache;
  } catch {
    return null;
  }
}

function saveDiskCache(cache: DiskCache): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // Non-critical — in-memory cache still works
  }
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
// Date helpers
// ---------------------------------------------------------------------------

function getDateRange(): { from: string; to: string; rangeKey: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0)); // last day of next month
  const rangeKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    from: from.toISOString().slice(0, 19),
    to: to.toISOString().slice(0, 19),
    rangeKey,
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getEconomicEvents(): Promise<NewsEvent[]> {
  const now = Date.now();
  const { rangeKey } = getDateRange();

  // 1. Try in-memory cache
  if (memCache && memCache.dateRange === rangeKey && now - memCache.fetchedAt < CACHE_TTL_MS) {
    return memCache.events;
  }

  // 2. Try disk cache (survives server restarts & page refreshes)
  if (!memCache) {
    const disk = loadDiskCache();
    if (disk && disk.dateRange === rangeKey && now - disk.fetchedAt < CACHE_TTL_MS) {
      memCache = disk;
      return disk.events;
    }
  }

  // 3. Fetch fresh from API
  const events = await fetchFromFXStreet();
  const cache: DiskCache = { fetchedAt: Date.now(), dateRange: rangeKey, events };
  memCache = cache;
  saveDiskCache(cache);
  return events;
}
