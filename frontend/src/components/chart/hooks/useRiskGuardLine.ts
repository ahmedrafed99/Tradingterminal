import { useEffect, useRef } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { PriceLevelPrimitive } from '../primitives/PriceLevelPrimitive';
import { PositionType } from '../../../types/enums';
import type { ChartRefs } from './types';
import { LABEL_TEXT } from './labelUtils';

const LINE_COLOR = 'rgba(239, 68, 68, 0.70)';
const LABEL_BG   = '#ef4444';

/**
 * Draws a dashed red horizontal line at the risk guard price level when a
 * position is open and risk guard is enabled. The line sits at the entry price
 * offset by the configured max-loss dollar amount.
 */
export function useRiskGuardLine(
  refs: ChartRefs,
  contract: Contract | null,
  chartId: 'left' | 'right' | 'backtest',
): void {
  const primitiveRef      = useRef<PriceLevelPrimitive | null>(null);
  const lastGuardPriceRef = useRef<number | null>(null);

  useEffect(() => {
    const detach = () => {
      const series = refs.series.current;
      if (series && primitiveRef.current) series.detachPrimitive(primitiveRef.current);
      primitiveRef.current = null;
      lastGuardPriceRef.current = null;
    };

    if (chartId === 'backtest' || !contract) {
      detach();
      return;
    }

    const decimals = Math.max(2, Math.ceil(-Math.log10(contract.tickSize)));

    const computeGuardPrice = (): number | null => {
      const state = useStore.getState();
      if (!state.riskGuardEnabled) return null;
      const pos = state.positions.find(
        (p) =>
          String(p.contractId) === String(contract.id) &&
          p.accountId === state.activeAccountId &&
          p.size > 0,
      );
      if (!pos) return null;
      const offset = (state.riskGuardMaxLoss / pos.size / contract.tickValue) * contract.tickSize;
      return pos.type === PositionType.Long
        ? pos.averagePrice - offset
        : pos.averagePrice + offset;
    };

    const draw = () => {
      const guardPrice = computeGuardPrice();
      const series = refs.series.current;
      if (!series) return;

      if (guardPrice == null) {
        detach();
        return;
      }

      if (primitiveRef.current) {
        if (lastGuardPriceRef.current !== guardPrice) {
          primitiveRef.current.setPrice(guardPrice);
          primitiveRef.current.setCell('lbl', { text: `Guard  ${guardPrice.toFixed(decimals)}` });
          lastGuardPriceRef.current = guardPrice;
        }
        return;
      }

      const p = new PriceLevelPrimitive({
        price: guardPrice,
        lineColor: LINE_COLOR,
        lineWidth: 1,
        lineStyle: 'dashed',
        priceLabel: { visible: false },
        labelPosition: 'right',
        cellOrder: ['lbl'],
        cells: {
          lbl: {
            text: `Guard  ${guardPrice.toFixed(decimals)}`,
            bg: LABEL_BG,
            color: LABEL_TEXT,
          },
        },
      });
      series.attachPrimitive(p);
      primitiveRef.current = p;
      lastGuardPriceRef.current = guardPrice;
    };

    draw();
    const unsub = useStore.subscribe(draw);
    return () => {
      unsub();
      detach();
    };
  }, [contract, chartId, refs]);
}
