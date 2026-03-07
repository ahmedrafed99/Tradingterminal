import type { NewsEvent } from '../types/news';

const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours (matches backend cache)

let cache: { data: NewsEvent[]; ts: number } | null = null;
let inflight: Promise<NewsEvent[]> | null = null;

export async function fetchEconomicEvents(): Promise<NewsEvent[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;
  if (inflight) return inflight;

  inflight = fetch('/news/economic')
    .then((res) => {
      if (!res.ok) throw new Error(`News fetch failed: ${res.status}`);
      return res.json() as Promise<NewsEvent[]>;
    })
    .then((events) => {
      cache = { data: events, ts: Date.now() };
      inflight = null;
      return events;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });

  return inflight;
}
