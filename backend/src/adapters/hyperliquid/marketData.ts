import type { ExchangeMarketData } from '../types';
import type { HlClient } from './client';

// ---------------------------------------------------------------------------
// HL API types
// ---------------------------------------------------------------------------
interface HlAsset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
}

interface HlMeta {
  universe: HlAsset[];
}

interface HlSpotAsset {
  name: string;
  szDecimals: number;
  tokens: number[];
}

interface HlSpotMeta {
  universe: HlSpotAsset[];
  tokens: { name: string; szDecimals: number }[];
}

interface HlCandle {
  T: number;  // close time (ms)
  t: number;  // open time (ms)
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;  // trade count
}

// ---------------------------------------------------------------------------
// Interval mapping
// ---------------------------------------------------------------------------
const UNIT_MAP: Record<string, string> = {
  Minute: 'm',
  Hour: 'h',
  Day: 'd',
  Week: 'w',
};

function toHlInterval(unit: string, unitNumber: number): string {
  const suffix = UNIT_MAP[unit] ?? 'm';
  return `${unitNumber}${suffix}`;
}

// ---------------------------------------------------------------------------
// Lazy meta cache — invalidated on disconnect
// ---------------------------------------------------------------------------
let metaCache: (HlMeta & { allMids: Record<string, string> }) | null = null;

export function clearMetaCache(): void {
  metaCache = null;
}

async function getMetaWithMids(client: HlClient): Promise<HlMeta & { allMids: Record<string, string> }> {
  if (metaCache) return metaCache;

  const [meta, allMids] = await Promise.all([
    client.info<HlMeta>({ type: 'meta' }),
    client.info<Record<string, string>>({ type: 'allMids' }),
  ]);

  metaCache = { ...meta, allMids };
  return metaCache;
}

// ---------------------------------------------------------------------------
// Asset index lookup (needed for order placement — exported for orders.ts)
// ---------------------------------------------------------------------------
export async function getAssetIndex(client: HlClient, coin: string): Promise<number> {
  const { universe } = await getMetaWithMids(client);
  const idx = universe.findIndex((a) => a.name === coin);
  if (idx < 0) throw new Error(`[HL] Unknown perp asset: ${coin}`);
  return idx;
}

export async function getAssetSzDecimals(client: HlClient, coin: string): Promise<number> {
  const { universe } = await getMetaWithMids(client);
  const asset = universe.find((a) => a.name === coin);
  if (!asset) throw new Error(`[HL] Unknown perp asset: ${coin}`);
  return asset.szDecimals;
}

// ---------------------------------------------------------------------------
// Normalize a perp asset into a contract object
// ---------------------------------------------------------------------------
function normalizePerp(
  asset: HlAsset,
  index: number,
  allMids: Record<string, string>,
) {
  const mid = parseFloat(allMids[asset.name] ?? '0');
  return {
    id: asset.name,
    name: asset.name,
    description: asset.name,
    contractId: asset.name,
    assetIndex: index,
    maxLeverage: asset.maxLeverage,
    quantityPrecision: asset.szDecimals,
    midPrice: mid,
    exchange: 'hyperliquid',
    category: 'perp',
  };
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------
export function createMarketData(client: HlClient): ExchangeMarketData {
  return {
    async searchContracts(searchText, _live) {
      const { universe, allMids } = await getMetaWithMids(client);
      const query = searchText.toUpperCase();
      const results = universe
        .map((a, i) => normalizePerp(a, i, allMids))
        .filter((c) => c.name.includes(query) || c.description.includes(query));
      return results;
    },

    async availableContracts(_live) {
      const [{ universe, allMids }, spotMeta] = await Promise.all([
        getMetaWithMids(client),
        client.info<HlSpotMeta>({ type: 'spotMeta' }),
      ]);

      const perps = universe.map((a, i) => normalizePerp(a, i, allMids));

      const spots = spotMeta.universe.map((a, i) => {
        const mid = parseFloat(allMids[a.name] ?? '0');
        return {
          id: a.name,
          name: a.name,
          description: a.name,
          contractId: a.name,
          assetIndex: 10000 + i,
          maxLeverage: 1,
          quantityPrecision: a.szDecimals,
          midPrice: mid,
          exchange: 'hyperliquid',
          category: 'spot',
        };
      });

      return [...perps, ...spots];
    },

    async searchContractById(contractId, _live) {
      const { universe, allMids } = await getMetaWithMids(client);
      const idx = universe.findIndex((a) => a.name === contractId);
      if (idx >= 0) {
        return normalizePerp(universe[idx], idx, allMids);
      }
      // Not found
      return null;
    },

    async retrieveBars(params) {
      const {
        contractId,
        unit,
        unitNumber,
        startTimestamp,
        endTimestamp,
      } = params as {
        contractId: string;
        unit: string;
        unitNumber: number;
        startTimestamp: string;
        endTimestamp?: string;
      };

      const interval = toHlInterval(unit, unitNumber);
      const startTime = new Date(startTimestamp).getTime();
      const req: Record<string, unknown> = {
        coin: contractId,
        interval,
        startTime,
      };
      if (endTimestamp) req['endTime'] = new Date(endTimestamp).getTime();

      const candles = await client.info<HlCandle[]>({
        type: 'candleSnapshot',
        req,
      });

      return candles.map((c) => ({
        timestamp: new Date(c.t).toISOString(),
        open: parseFloat(c.o),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        close: parseFloat(c.c),
        volume: parseFloat(c.v),
        trades: c.n,
      }));
    },
  };
}
