/**
 * Shared raw cache for FXStreet Calendar API data.
 * Both newsService and holidayService read from this cache,
 * each applying their own filters. Only one API call is made.
 */
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FXStreetEvent {
  id: string;
  eventId: string;
  dateUtc: string;
  name: string;
  countryCode: string;
  currencyCode: string;
  categoryId: string;
  volatility: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  actual: number | null;
  consensus: number | null;
  previous: number | null;
  isBetterThanExpected: boolean | null;
  isSpeech: boolean;
  isPreliminary: boolean;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface DiskCache {
  fetchedAt: number;
  dateRange: string;
  events: FXStreetEvent[];
}

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const CACHE_FILE = path.join(__dirname, '..', '..', 'data', 'fxstreet-calendar.json');

let memCache: DiskCache | null = null;

function loadDiskCache(): DiskCache | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as DiskCache;
  } catch { return null; }
}

function saveDiskCache(cache: DiskCache): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch { /* non-critical */ }
}

function getDateRange(): { from: string; to: string; rangeKey: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0));
  const rangeKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return { from: from.toISOString().slice(0, 19), to: to.toISOString().slice(0, 19), rangeKey };
}

async function fetchFromAPI(): Promise<FXStreetEvent[]> {
  const { from, to } = getDateRange();
  const { data } = await axios.get<FXStreetEvent[]>(
    `https://calendar-api.fxstreet.com/en/api/v1/eventDates/${from}/${to}`,
    { headers: { Origin: 'https://www.fxstreet.com', Referer: 'https://www.fxstreet.com/' }, timeout: 15_000 },
  );
  return data;
}

/** Get all raw FXStreet events (cached, shared across services). */
export async function getRawEvents(): Promise<FXStreetEvent[]> {
  const now = Date.now();
  const { rangeKey } = getDateRange();

  if (memCache && memCache.dateRange === rangeKey && now - memCache.fetchedAt < CACHE_TTL_MS) {
    return memCache.events;
  }
  if (!memCache) {
    const disk = loadDiskCache();
    if (disk && disk.dateRange === rangeKey && now - disk.fetchedAt < CACHE_TTL_MS) {
      memCache = disk;
      return disk.events;
    }
  }

  const events = await fetchFromAPI();
  const cache: DiskCache = { fetchedAt: Date.now(), dateRange: rangeKey, events };
  memCache = cache;
  saveDiskCache(cache);
  return events;
}
