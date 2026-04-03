import api from './api';
import { dedup } from '../utils/dedup';
import type { HolidayDate } from '../types/news';

const CACHE_TTL = 4 * 60 * 60 * 1000;

let cache: { data: HolidayDate[]; ts: number } | null = null;

const fetchFromApi = dedup(async (): Promise<HolidayDate[]> => {
  const res = await api.get<HolidayDate[]>('/holidays');
  cache = { data: res.data, ts: Date.now() };
  return res.data;
});

export async function fetchHolidays(): Promise<HolidayDate[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;
  return fetchFromApi();
}
