import api from './api';
import { metricCollector } from './monitor/metricCollector';

export interface Bar {
  t: string;  // ISO timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Contract {
  id: string;
  name: string;
  description: string;
  tickSize: number;
  tickValue: number;
  activeContract: boolean;
  // Phase 4: instrument generalization (computed during normalization)
  marketType?: 'futures' | 'crypto'; // drives market hours, currency display, etc.
  ticksPerPoint?: number;       // Math.round(1 / tickSize) for futures, 1 for crypto
  quantityStep?: number;        // 1 for futures, 0.001 etc. for crypto
  pricePrecision?: number;      // decimal places for prices (derived from tickSize)
  quantityPrecision?: number;   // decimal places for quantities (0 for futures)
}

function normalizeContract(raw: Contract): Contract {
  return {
    ...raw,
    marketType: raw.marketType ?? 'futures',
    ticksPerPoint: raw.ticksPerPoint ?? Math.round(1 / raw.tickSize),
    quantityStep: raw.quantityStep ?? 1,
    pricePrecision: raw.pricePrecision ?? (raw.tickSize.toString().split('.')[1]?.length ?? 0),
    quantityPrecision: raw.quantityPrecision ?? 0,
  };
}

export type BarUnit = 1 | 2 | 3 | 4 | 5 | 6; // Second|Minute|Hour|Day|Week|Month

export interface RetrieveBarsParams {
  contractId: string;
  live?: boolean;
  unit: BarUnit;
  unitNumber: number;
  startTime: string;
  endTime: string;
  limit?: number;
  includePartialBar?: boolean;
}

// In-memory bars cache — avoids re-fetching when toggling dual chart or switching back to a contract
const barsCache = new Map<string, { bars: Bar[]; ts: number }>();
const BARS_CACHE_TTL = 60_000; // 60 seconds

// In-flight request dedup — concurrent calls with the same key share one network request
const inflight = new Map<string, Promise<Bar[]>>();

// searchContracts cache + dedup — avoids redundant network calls for the same query
const searchCache = new Map<string, { contracts: Contract[]; ts: number }>();
const SEARCH_CACHE_TTL = 120_000; // 2 minutes
const searchInflight = new Map<string, Promise<Contract[]>>();

// sessionStorage cache — survives page refreshes so the chart renders instantly
const SS_PREFIX = 'bars:';
const SS_TTL = 60_000; // 60 seconds

function ssGet(key: string): Bar[] | null {
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + key);
    if (!raw) return null;
    const { bars, ts } = JSON.parse(raw) as { bars: Bar[]; ts: number };
    if (Date.now() - ts > SS_TTL) {
      sessionStorage.removeItem(SS_PREFIX + key);
      return null;
    }
    return bars;
  } catch { return null; }
}

function ssSet(key: string, bars: Bar[]): void {
  try {
    sessionStorage.setItem(SS_PREFIX + key, JSON.stringify({ bars, ts: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}

function barsCacheKey(p: RetrieveBarsParams): string {
  return `${p.contractId}:${p.unit}:${p.unitNumber}:${p.limit ?? 0}`;
}

export const marketDataService = {
  async retrieveBars(params: RetrieveBarsParams): Promise<Bar[]> {
    const key = barsCacheKey(params);

    // 1. In-memory cache (fastest)
    const cached = barsCache.get(key);
    if (cached && Date.now() - cached.ts < BARS_CACHE_TTL) {
      return cached.bars;
    }

    // 2. sessionStorage cache (survives refresh)
    const ssCached = ssGet(key);
    if (ssCached) {
      barsCache.set(key, { bars: ssCached, ts: Date.now() });
      return ssCached;
    }

    // 3. In-flight dedup
    const existing = inflight.get(key);
    if (existing) return existing;

    // 4. Network fetch
    const fetchStart = performance.now();
    const promise = api
      .post<{ bars: Bar[]; success: boolean }>('/market/bars', params)
      .then((res) => {
        metricCollector.onApiCall('POST', '/market/bars', performance.now() - fetchStart, true);
        const bars = res.data.bars ?? [];
        barsCache.set(key, { bars, ts: Date.now() });
        ssSet(key, bars);
        return bars;
      })
      .catch((err) => {
        metricCollector.onApiCall('POST', '/market/bars', performance.now() - fetchStart, false);
        throw err;
      })
      .finally(() => {
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  },

  async searchContracts(query: string, live = false): Promise<Contract[]> {
    const key = `${query.toUpperCase()}:${live}`;

    // 1. Cache hit
    const cached = searchCache.get(key);
    if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) return cached.contracts;

    // 2. In-flight dedup
    const existing = searchInflight.get(key);
    if (existing) return existing;

    // 3. Network fetch
    const searchStart = performance.now();
    const promise = api
      .get<{ contracts: Contract[]; success: boolean }>(
        `/market/contracts/search?q=${encodeURIComponent(query)}&live=${live}`,
      )
      .then((res) => {
        metricCollector.onApiCall('GET', '/market/contracts/search', performance.now() - searchStart, true);
        const contracts = (res.data.contracts ?? []).map(normalizeContract);
        searchCache.set(key, { contracts, ts: Date.now() });
        return contracts;
      })
      .catch((err) => {
        metricCollector.onApiCall('GET', '/market/contracts/search', performance.now() - searchStart, false);
        throw err;
      })
      .finally(() => {
        searchInflight.delete(key);
      });

    searchInflight.set(key, promise);
    return promise;
  },

  async listAvailableContracts(): Promise<Contract[]> {
    const t = performance.now();
    let ok = true;
    try {
      const res = await api.get<{ contracts: Contract[]; success: boolean }>('/market/contracts/available');
      return (res.data.contracts ?? []).map(normalizeContract);
    } catch (e) { ok = false; throw e; }
    finally { metricCollector.onApiCall('GET', '/market/contracts/available', performance.now() - t, ok); }
  },
};
