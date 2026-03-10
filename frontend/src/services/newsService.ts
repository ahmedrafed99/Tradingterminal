import api from './api';
import { dedup } from '../utils/dedup';
import type { NewsEvent } from '../types/news';

const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours (matches backend cache)

let cache: { data: NewsEvent[]; ts: number } | null = null;

const fetchFromApi = dedup(async (): Promise<NewsEvent[]> => {
  const res = await api.get<NewsEvent[]>('/news/economic');
  const events = res.data;
  cache = { data: events, ts: Date.now() };
  return events;
});

export async function fetchEconomicEvents(): Promise<NewsEvent[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;
  return fetchFromApi();
}
