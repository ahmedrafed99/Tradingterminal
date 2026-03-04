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

function barsCacheKey(p: RetrieveBarsParams): string {
  return `${p.contractId}:${p.unit}:${p.unitNumber}`;
}

export const marketDataService = {
  async retrieveBars(params: RetrieveBarsParams): Promise<Bar[]> {
    const key = barsCacheKey(params);
    const cached = barsCache.get(key);
    if (cached && Date.now() - cached.ts < BARS_CACHE_TTL) {
      return cached.bars;
    }
    const res = await api.post<{ bars: Bar[]; success: boolean }>('/market/bars', params);
    const bars = res.data.bars ?? [];
    barsCache.set(key, { bars, ts: Date.now() });
    return bars;
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
