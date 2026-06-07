import axios from 'axios';
import type { ExchangeMarketData } from '../types';
import type { ProjectXHelpers } from './auth';
import { debugLog } from '../../utils/debugLog';

const CHART_API_BASE = 'https://chartapi.topstepx.com';

// ---------------------------------------------------------------------------
// Contract ID → chartapi symbol  (e.g. CON.F.US.ENQ.M26 → /NQ)
// ---------------------------------------------------------------------------
const PRODUCT_TO_CHART_SYMBOL: Record<string, string> = {
  ENQ: '/NQ',
  EP:  '/ES',
  MNQ: '/MNQ',
  MES: '/MES',
  MCL: '/MCL',
  MGC: '/MGC',
};

function contractIdToChartSymbol(contractId: string): string | null {
  const match = contractId.match(/^CON\.F\.US\.([^.]+)\./);
  if (!match) return null;
  return PRODUCT_TO_CHART_SYMBOL[match[1]] ?? null;
}

// ---------------------------------------------------------------------------
// unit/unitNumber → chartapi Resolution string
// unit: 1=Second 2=Minute 3=Hour 4=Day 5=Week 6=Month
// ---------------------------------------------------------------------------
function toChartResolution(unit: number, unitNumber: number): string | null {
  switch (unit) {
    case 1: return `${unitNumber}S`;
    case 2: return String(unitNumber);
    case 3: return String(unitNumber * 60);
    case 4: return 'D';
    case 5: return 'W';
    case 6: return 'M';
    case 7: return `${unitNumber}T`; // Tick bars (e.g. 100T)
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Candle period in ms — used for gap detection
// ---------------------------------------------------------------------------
function candlePeriodMs(unit: number, unitNumber: number): number {
  switch (unit) {
    case 1: return unitNumber * 1_000;
    case 2: return unitNumber * 60_000;
    case 3: return unitNumber * 3_600_000;
    case 4: return unitNumber * 86_400_000;
    case 5: return unitNumber * 7 * 86_400_000;
    case 6: return unitNumber * 30 * 86_400_000;
    default: return unitNumber * 60_000;
  }
}

// ---------------------------------------------------------------------------
// Normalize chartapi bar → standard bar { t: ISO, o, h, l, c, v, tv? }
// chartapi returns { t: ms, o, c, l, h, v, tv }
// tv = tick count (number of individual trades in this bar); only present for tick resolutions
// ---------------------------------------------------------------------------
interface NormalizedBar { t: string; o: number; h: number; l: number; c: number; v: number; tv?: number }

// ---------------------------------------------------------------------------
// Aggregate ascending-sorted bars into a coarser period
// Used when chartapi doesn't support the requested resolution (e.g. 4h, 2h)
// ---------------------------------------------------------------------------
function aggregateBarsBackend(
  sourceBars: NormalizedBar[],
  targetPeriodSec: number,
): NormalizedBar[] {
  if (sourceBars.length === 0) return [];
  const result: NormalizedBar[] = [];
  let bucketStart = -1;
  let o = 0, h = -Infinity, l = Infinity, c = 0, v = 0, tv = 0;
  for (const bar of sourceBars) {
    const t = Math.floor(new Date(bar.t).getTime() / 1000);
    const periodStart = Math.floor(t / targetPeriodSec) * targetPeriodSec;
    if (periodStart !== bucketStart) {
      if (bucketStart !== -1) {
        result.push({ t: new Date(bucketStart * 1000).toISOString(), o, h, l, c, v, ...(tv > 0 ? { tv } : {}) });
      }
      bucketStart = periodStart;
      o = bar.o; h = bar.h; l = bar.l; c = bar.c; v = bar.v; tv = bar.tv ?? 0;
    } else {
      if (bar.h > h) h = bar.h;
      if (bar.l < l) l = bar.l;
      c = bar.c;
      v += bar.v;
      tv += bar.tv ?? 0;
    }
  }
  if (bucketStart !== -1) {
    result.push({ t: new Date(bucketStart * 1000).toISOString(), o, h, l, c, v, ...(tv > 0 ? { tv } : {}) });
  }
  return result;
}

function normalizeChartBar(bar: Record<string, unknown>): NormalizedBar {
  return {
    t: new Date(bar['t'] as number).toISOString(),
    o: bar['o'] as number,
    h: bar['h'] as number,
    l: bar['l'] as number,
    c: bar['c'] as number,
    v: bar['v'] as number,
    ...(bar['tv'] !== undefined ? { tv: bar['tv'] as number } : {}),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createProjectXMarketData(h: ProjectXHelpers): ExchangeMarketData {
  async function fetchFromChartApi(
    params: Record<string, unknown>,
    startTime: string,
    endTime: string,
  ): Promise<NormalizedBar[]> {
    const contractId = params['contractId'] as string;
    const unit       = params['unit'] as number;
    const unitNumber = params['unitNumber'] as number;
    const live       = (params['live'] as boolean | undefined) ?? false;
    const limit      = params['limit'] as number | undefined;

    const token = h.getToken();
    if (!token) throw new Error('No auth token — not connected to ProjectX');

    const symbol = contractIdToChartSymbol(contractId);
    if (!symbol) throw new Error(`No chartapi symbol mapping for: ${contractId}`);

    const resolution = toChartResolution(unit, unitNumber);
    if (!resolution) throw new Error(`No chartapi resolution for unit=${unit}`);

    // chartapi silently returns 1m bars for tick resolutions < 100T — reject early
    if (resolution.endsWith('T') && parseInt(resolution, 10) < 100) {
      throw new Error(`Tick resolution ${resolution} rejected — chartapi minimum is 100T (smaller values silently return 1m bars)`);
    }

    const fromTs = Math.floor(new Date(startTime).getTime() / 1000);
    const toTs   = Math.floor(new Date(endTime).getTime()   / 1000);

    const queryParams: Record<string, string> = {
      Symbol:     symbol,
      Resolution: resolution,
      From:       String(fromTs),
      To:         String(toTs),
      SessionId:  'extended',
      Live:       live ? 'true' : 'false',
    };
    if (limit !== undefined) queryParams['Countback'] = String(limit);
    const query = new URLSearchParams(queryParams);

    const response = await axios.get<unknown>(
      `${CHART_API_BASE}/History/v2?${query}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );

    const raw = response.data as { bars?: Record<string, unknown>[] };
    const bars = raw?.bars;
    if (!Array.isArray(bars)) {
      debugLog.log('bars:chartapi-unexpected', { contractId, url: `${CHART_API_BASE}/History/v2?${query}`, raw });
      throw new Error(`chartapi missing bars array: ${JSON.stringify(raw).slice(0, 200)}`);
    }

    return bars.map(normalizeChartBar);
  }

  return {
    async retrieveBars(params) {
      const unit       = params['unit'] as number;
      const unitNumber = params['unitNumber'] as number;
      const startTime  = params['startTime'] as string;
      const endTime    = params['endTime'] as string;
      const endTimeMs  = new Date(endTime).getTime();
      const periodMs   = candlePeriodMs(unit, unitNumber);

      // ── Tick bars: chartapi only (ProjectX primary API doesn't support tick resolution) ──
      if (unit === 7) {
        const bars = await fetchFromChartApi(params, startTime, endTime);
        return { success: true, bars };
      }

      // ── Multi-hour bars: chartapi ignores Resolution > 60 and silently returns 1h bars.
      //    Fetch 1h bars and aggregate in the backend instead. ──────────────────────────
      if (unit === 3 && unitNumber > 1) {
        const originalLimit = params['limit'] as number | undefined;
        const oneHourParams = {
          ...params,
          unitNumber: 1,
          // Need unitNumber× more 1h bars to cover the same time span as Nh bars
          ...(originalLimit !== undefined ? { limit: Math.min(originalLimit * unitNumber, 100_000) } : {}),
        };
        debugLog.log('bars:multi-hour-chartapi', { unit, unitNumber, contractId: params['contractId'], fetchAs: '1h' });
        const hourBars = await fetchFromChartApi(oneHourParams, startTime, endTime);
        hourBars.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
        const bars = aggregateBarsBackend(hourBars, unitNumber * 3600);
        debugLog.log('bars:multi-hour-chartapi-result', { count: bars.length, first: bars[0]?.t, last: bars[bars.length - 1]?.t });
        return { success: true, bars };
      }

      // ── Primary attempt ────────────────────────────────────────────────────
      let primaryBars: NormalizedBar[] | null = null;
      let primaryRaw: unknown = null;

      try {
        const response = await axios.post(
          `${h.getBaseUrl()}/api/History/retrieveBars`,
          params,
          { headers: h.authHeaders() },
        );
        const data = response.data as { success: boolean; bars?: NormalizedBar[]; errorMessage?: string };
        if (data.success !== false) {
          primaryBars = data.bars ?? [];
          primaryRaw  = data;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        debugLog.log('bars:hard-fail', { contractId: params['contractId'], error: msg });
      }

      // ── Hard fail: full chartapi fetch ─────────────────────────────────────
      if (primaryBars === null) {
        const bars = await fetchFromChartApi(params, startTime, endTime);
        return { success: true, bars };
      }

      // ── No bars at all from primary: try chartapi ──────────────────────────
      if (primaryBars.length === 0) {
        try {
          const bars = await fetchFromChartApi(params, startTime, endTime);
          if (bars.length > 0) return { success: true, bars };
        } catch (err: unknown) {
          debugLog.log('bars:chartapi-empty-fill:fail', { error: err instanceof Error ? err.message : String(err) });
        }
        return primaryRaw;
      }

      // ── Soft-gap check: latest bar + 1 period < endTime ────────────────────
      const latestBarMs = primaryBars.reduce((m, b) => Math.max(m, new Date(b.t).getTime()), 0);

      if (latestBarMs + periodMs < endTimeMs) {
        try {
          const gapStart = new Date(latestBarMs + periodMs).toISOString();
          const gapBars  = await fetchFromChartApi(params, gapStart, endTime);

          if (gapBars.length > 0) {
            const existing = new Set(primaryBars.map(b => new Date(b.t).getTime()));
            const newBars  = gapBars.filter(b => !existing.has(new Date(b.t).getTime()));
            const merged = [...newBars, ...primaryBars].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
            return { ...(primaryRaw as object), success: true, bars: merged };
          }
        } catch (err: unknown) {
          debugLog.log('bars:soft-gap:fail', { error: err instanceof Error ? err.message : String(err) });
        }
      }

      // ── No gap or supplement failed: return primary ────────────────────────
      return primaryRaw;
    },

    async searchContracts(searchText, live) {
      const response = await axios.post(
        `${h.getBaseUrl()}/api/Contract/search`,
        { searchText, live },
        { headers: h.authHeaders() },
      );
      return response.data;
    },

    async availableContracts(live) {
      const response = await axios.post(
        `${h.getBaseUrl()}/api/Contract/available`,
        { live },
        { headers: h.authHeaders() },
      );
      return response.data;
    },

    async searchContractById(contractId, live) {
      const response = await axios.post(
        `${h.getBaseUrl()}/api/Contract/searchById`,
        { contractId, live },
        { headers: h.authHeaders() },
      );
      return response.data;
    },
  };
}
