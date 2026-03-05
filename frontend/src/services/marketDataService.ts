import api from './api';

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
  ticksPerPoint?: number;       // Math.round(1 / tickSize) for futures, 1 for crypto
  quantityStep?: number;        // 1 for futures, 0.001 etc. for crypto
  pricePrecision?: number;      // decimal places for prices (derived from tickSize)
  quantityPrecision?: number;   // decimal places for quantities (0 for futures)
}

function normalizeContract(raw: Contract): Contract {
  return {
    ...raw,
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
  return `${p.contractId}:${p.unit}:${p.unitNumber}`;
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
    const promise = api
      .post<{ bars: Bar[]; success: boolean }>('/market/bars', params)
      .then((res) => {
        const bars = res.data.bars ?? [];
        barsCache.set(key, { bars, ts: Date.now() });
        ssSet(key, bars);
        return bars;
      })
      .finally(() => {
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  },

  async searchContracts(query: string, live = false): Promise<Contract[]> {
    const res = await api.get<{ contracts: Contract[]; success: boolean }>(
      `/market/contracts/search?q=${encodeURIComponent(query)}&live=${live}`,
    );
    return (res.data.contracts ?? []).map(normalizeContract);
  },

  async listAvailableContracts(): Promise<Contract[]> {
    const res = await api.get<{ contracts: Contract[]; success: boolean }>(
      '/market/contracts/available',
    );
    return (res.data.contracts ?? []).map(normalizeContract);
  },
};
