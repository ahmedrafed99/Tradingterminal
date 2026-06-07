import { marketDataService, type Bar } from '../services/marketDataService';
import { getCurrentSessionStartSec } from './marketHours';

// CME equity index product codes (CON.F.US.<PRODUCT>.<EXPIRY>) that have fixed daily price limits.
// Energy and metals use rolling dynamic circuit breakers — no static line to draw.
const EQUITY_INDEX_PRODUCTS = new Set([
  'EP',   // /ES
  'ENQ',  // /NQ
  'MES',  // /MES
  'MNQ',  // /MNQ
  'ERY',  // /RTY  (Russell 2000 E-mini)
  'M2K',  // /M2K  (Russell 2000 Micro)
  'YM',   // /YM   (Dow E-mini)
  'MYM',  // /MYM  (Dow Micro)
]);

export const LIMIT_PCT = 7;
export const BUFFER_PCT = 2;

/** Returns limit config if the contract is an equity index product, null otherwise. */
export function getPriceLimitConfig(contractId: string): { limitPct: number; bufferPct: number } | null {
  const match = contractId.match(/^CON\.F\.US\.([^.]+)\./);
  if (!match) return null;
  if (!EQUITY_INDEX_PRODUCTS.has(match[1])) return null;
  return { limitPct: LIMIT_PCT, bufferPct: BUFFER_PCT };
}

/**
 * Derives settlement price ≈ close of the last bar from the PREVIOUS regular session.
 * Fallback used when the VWAP fetch fails.
 */
export function deriveSettlementPrice(bars: Bar[]): number | null {
  const sessionStartMs = getCurrentSessionStartSec() * 1000;
  const cutoffMs = sessionStartMs - 2 * 60 * 60 * 1000; // 18:00 ET − 2h = 16:00 ET
  for (let i = bars.length - 1; i >= 0; i--) {
    if (new Date(bars[i].t).getTime() < cutoffMs) return bars[i].c;
  }
  return null;
}

// Intl formatter used by getSettlementWindow (module-level to avoid repeated construction).
const _ctWeekdayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', weekday: 'short',
});
const _ctDateFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
});
const _ctHourFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', hour: '2-digit', hour12: false,
});

/**
 * Returns UTC ISO strings for the CME settlement window: 14:59:30–15:00:01 CT
 * on the most recent weekday relative to the current session start.
 * DST-aware via Intl (CDT = UTC-5, CST = UTC-6).
 */
function getSettlementWindow(): { startTime: string; endTime: string } {
  let probe = getCurrentSessionStartSec() * 1000;

  // Walk back to the nearest weekday (handles Sunday session start → Friday)
  for (let i = 0; i < 4; i++) {
    const wd = _ctWeekdayFmt.format(new Date(probe));
    if (wd !== 'Sun' && wd !== 'Sat') break;
    probe -= 24 * 3600_000;
  }

  // Get the CT calendar date for the settlement day
  const dp = _ctDateFmt.formatToParts(new Date(probe));
  const year  = dp.find(p => p.type === 'year')!.value;
  const month = dp.find(p => p.type === 'month')!.value;
  const day   = dp.find(p => p.type === 'day')!.value;

  // Detect CDT (UTC-5) vs CST (UTC-6) by probing 19:59:30 UTC.
  // If CT hour there is 14 → CDT; if 13 → CST → add 1 h.
  const cdtCandidate = new Date(`${year}-${month}-${day}T19:59:30.000Z`).getTime();
  const ctHour = Number(_ctHourFmt.formatToParts(new Date(cdtCandidate)).find(p => p.type === 'hour')!.value) % 24;
  const startMs = ctHour === 14 ? cdtCandidate : cdtCandidate + 3_600_000;

  return {
    startTime: new Date(startMs).toISOString(),
    endTime:   new Date(startMs + 31_000).toISOString(), // 31 s covers :30–:00 (inclusive)
  };
}

/**
 * Fetches 1-second bars for the CME settlement window (14:59:30–15:00:00 CT on the
 * most recent weekday) and returns the VWAP rounded to the nearest NQ tick (0.25).
 * Returns null on any failure — callers should fall back to deriveSettlementPrice().
 */
export async function fetchVWAPSettlement(contractId: string): Promise<number | null> {
  try {
    const { startTime, endTime } = getSettlementWindow();
    const bars = await marketDataService.retrieveBars({
      contractId,
      unit: 1,        // Second bars
      unitNumber: 1,
      startTime,
      endTime,
      live: false,
    });

    if (bars.length === 0) return null;

    // VWAP = Σ((H+L+C)/3 × V) / Σ(V)
    let sumTV = 0;
    let sumV  = 0;
    for (const b of bars) {
      const tp = (b.h + b.l + b.c) / 3;
      sumTV += tp * b.v;
      sumV  += b.v;
    }
    if (sumV === 0) return null;

    // Round to nearest 0.25 tick
    const vwap = sumTV / sumV;
    return Math.round(vwap * 4) / 4;
  } catch {
    return null;
  }
}

export interface PriceLimitLevels {
  upperLimit: number;
  upperThreshold: number;
  lowerThreshold: number;
  lowerLimit: number;
}

/** Computes the 4 price level values from settlement + config. */
export function computeLimitLevels(
  settlement: number,
  limitPct: number,
  bufferPct: number,
): PriceLimitLevels {
  const limitFrac = limitPct / 100;
  const threshFrac = (limitPct - bufferPct) / 100;
  return {
    upperLimit:     settlement * (1 + limitFrac),
    upperThreshold: settlement * (1 + threshFrac),
    lowerThreshold: settlement * (1 - threshFrac),
    lowerLimit:     settlement * (1 - limitFrac),
  };
}

/** True when price has entered the 2% buffer zone (trading must be blocked). */
export function isPriceNearLimit(
  price: number,
  levels: PriceLimitLevels,
): boolean {
  return price >= levels.upperThreshold || price <= levels.lowerThreshold;
}
