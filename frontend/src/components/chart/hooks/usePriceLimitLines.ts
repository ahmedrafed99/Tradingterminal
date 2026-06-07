import { useEffect, useRef } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { realtimeService } from '../../../services/realtimeService';
import type { GatewayQuote } from '../../../services/realtimeService';
import { PriceLevelPrimitive } from '../primitives/PriceLevelPrimitive';
import {
  getPriceLimitConfig,
  deriveSettlementPrice,
  fetchVWAPSettlement,
  computeLimitLevels,
  isPriceNearLimit,
  type PriceLimitLevels,
} from '../../../utils/priceLimits';
import type { ChartRefs } from './types';

// ── Colors ────────────────────────────────────────────────────────────────────
const COLOR_NORMAL   = 'rgba(255, 160, 0, 0.75)';   // amber — neutral warning
const COLOR_BREACH   = 'rgba(239, 68, 68, 0.90)';   // red   — actively blocked
const COLOR_DASHED   = 'rgba(255, 160, 0, 0.40)';   // faint amber for outer dashed line
const COLOR_DASHED_B = 'rgba(239, 68, 68, 0.50)';   // faint red when breached

function makeLimitLabel(text: string, color: string) {
  return {
    cellOrder: ['lbl'],
    cells: {
      lbl: {
        text,
        bg:    color,
        color: '#ffffff',
        fontSize: 10,
      },
    },
  };
}

/**
 * Draws 4 horizontal lines for CME equity index price limits when
 * chartSettings.showPriceLimits is true.
 *
 *  · Outer dashed  = actual CME limit   (±7% from settlement)
 *  · Inner solid   = 2% buffer threshold (±5% from settlement) — where trading blocks
 *
 * Turns red and updates priceLimitBlocked in the store when price enters the zone.
 * No-ops for backtest charts or non-equity-index contracts.
 */
export function usePriceLimitLines(
  refs: ChartRefs,
  contract: Contract | null,
  chartId: 'left' | 'right' | 'backtest',
  barsLoading: boolean,
): void {
  const showPriceLimits  = useStore((s) => s.chartSettings.showPriceLimits);
  const setPriceLimitBlocked = useStore((s) => s.setPriceLimitBlocked);

  // Track primitives so we can detach on cleanup
  const primitivesRef = useRef<PriceLevelPrimitive[]>([]);
  const levelsRef     = useRef<PriceLimitLevels | null>(null);
  const blockedRef    = useRef(false);

  useEffect(() => {
    // Cleanup helper
    const detachAll = () => {
      const series = refs.series.current;
      if (series) primitivesRef.current.forEach((p) => series.detachPrimitive(p));
      primitivesRef.current = [];
    };

    // Guards
    if (chartId === 'backtest' || !showPriceLimits || !contract) {
      detachAll();
      if (blockedRef.current) { blockedRef.current = false; setPriceLimitBlocked(false); }
      return;
    }

    const cfg = getPriceLimitConfig(contract.id);
    if (!cfg) {
      detachAll();
      if (blockedRef.current) { blockedRef.current = false; setPriceLimitBlocked(false); }
      return;
    }

    let cancelled = false;
    let cleanupQuote: (() => void) | null = null;

    (async () => {
      // Fetch VWAP settlement; fall back to bar-close approximation if it fails
      let settlement = await fetchVWAPSettlement(contract.id);
      if (settlement == null) {
        const bars = refs.bars.current;
        if (bars.length > 0) settlement = deriveSettlementPrice(bars);
      }
      if (settlement == null || cancelled) return;

      const series = refs.series.current;
      if (!series || cancelled) return;

      const levels = computeLimitLevels(settlement, cfg.limitPct, cfg.bufferPct);
      levelsRef.current = levels;

      const decimals = Math.max(2, Math.ceil(-Math.log10(contract.tickSize)));

      // ── Build the 4 primitives ──────────────────────────────────────────────

      function makeOuter(price: number, label: string): PriceLevelPrimitive {
        return new PriceLevelPrimitive({
          price,
          lineColor: COLOR_DASHED,
          lineWidth: 1,
          lineStyle: 'dashed',
          priceLabel: { visible: false },
          labelPosition: 'right',
          ...makeLimitLabel(label, COLOR_DASHED),
        });
      }

      function makeInner(price: number, label: string): PriceLevelPrimitive {
        return new PriceLevelPrimitive({
          price,
          lineColor: COLOR_NORMAL,
          lineWidth: 1,
          lineStyle: 'solid',
          priceLabel: { visible: false },
          labelPosition: 'right',
          ...makeLimitLabel(label, COLOR_NORMAL),
        });
      }

      const upperLimit     = makeOuter(levels.upperLimit,     `+${cfg.limitPct}% limit  ${levels.upperLimit.toFixed(decimals)}`);
      const upperThreshold = makeInner(levels.upperThreshold, `+${cfg.limitPct - cfg.bufferPct}% limit  ${levels.upperThreshold.toFixed(decimals)}`);
      const lowerThreshold = makeInner(levels.lowerThreshold, `-${cfg.limitPct - cfg.bufferPct}% limit  ${levels.lowerThreshold.toFixed(decimals)}`);
      const lowerLimit     = makeOuter(levels.lowerLimit,     `-${cfg.limitPct}% limit  ${levels.lowerLimit.toFixed(decimals)}`);

      [upperLimit, upperThreshold, lowerThreshold, lowerLimit].forEach((p) => series.attachPrimitive(p));
      primitivesRef.current = [upperLimit, upperThreshold, lowerThreshold, lowerLimit];

      // ── Live price subscription ─────────────────────────────────────────────

      function updateBlockedState(price: number) {
        const lvls = levelsRef.current;
        if (!lvls) return;
        const blocked = isPriceNearLimit(price, lvls);
        if (blocked === blockedRef.current) return;
        blockedRef.current = blocked;
        setPriceLimitBlocked(blocked);

        const innerColor  = blocked ? COLOR_BREACH   : COLOR_NORMAL;
        const outerColor  = blocked ? COLOR_DASHED_B : COLOR_DASHED;
        upperThreshold.setLineColor(innerColor);
        lowerThreshold.setLineColor(innerColor);
        upperLimit.setLineColor(outerColor);
        lowerLimit.setLineColor(outerColor);
        upperThreshold.setCell('lbl', { bg: innerColor });
        lowerThreshold.setCell('lbl', { bg: innerColor });
        upperLimit.setCell('lbl', { bg: outerColor });
        lowerLimit.setCell('lbl', { bg: outerColor });
      }

      const quoteHandler = (contractId: string, data: GatewayQuote) => {
        if (contractId !== contract!.id) return;
        const price = data.lastPrice ?? data.bestBid ?? data.bestAsk;
        if (price != null) updateBlockedState(price);
      };
      realtimeService.onQuote(quoteHandler);
      cleanupQuote = () => realtimeService.offQuote(quoteHandler);
    })();

    return () => {
      cancelled = true;
      cleanupQuote?.();
      detachAll();
      if (blockedRef.current) { blockedRef.current = false; setPriceLimitBlocked(false); }
    };
  }, [showPriceLimits, contract, chartId, refs, setPriceLimitBlocked, barsLoading]);
}
