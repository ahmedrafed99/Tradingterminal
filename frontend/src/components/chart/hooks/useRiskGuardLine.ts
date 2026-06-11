import { useEffect, useRef } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { PriceLevelPrimitive } from '../primitives/PriceLevelPrimitive';
import { PositionType } from '../../../types/enums';
import type { ChartRefs } from './types';
import { SELL_TEXT } from './labelUtils';
import { roundToTick } from '../../../utils/instrument';

const LINE_COLOR = 'rgba(239, 68, 68, 0.70)';
const GUARD_COLOR = '#9f1239';

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

    const computeGuardPrice = (): { price: number; offset: number; maxLoss: number } | null => {
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
      const price = pos.type === PositionType.Long
        ? pos.averagePrice - offset
        : pos.averagePrice + offset;
      return { price, offset, maxLoss: state.riskGuardMaxLoss };
    };

    const fmtPnl = (offset: number, maxLoss: number): string => {
      if (useStore.getState().pnlMode === 'points') {
        return `-${roundToTick(offset, contract.tickSize).toFixed(2)} pts`;
      }
      return `-$${maxLoss.toFixed(2)}`;
    };

    const draw = () => {
      const result = computeGuardPrice();
      const series = refs.series.current;
      if (!series) return;

      if (result == null) {
        detach();
        return;
      }

      const { price, offset, maxLoss } = result;
      const pnlText = fmtPnl(offset, maxLoss);

      if (primitiveRef.current) {
        if (lastGuardPriceRef.current !== price) {
          primitiveRef.current.setPrice(price);
          lastGuardPriceRef.current = price;
        }
        primitiveRef.current.setCell('pnl', { text: pnlText });
        return;
      }

      const p = new PriceLevelPrimitive({
        price,
        lineColor: LINE_COLOR,
        lineWidth: 1,
        lineStyle: 'dashed',
        priceLabel: { visible: true, tickSize: contract.tickSize, color: GUARD_COLOR },
        labelPosition: 'mid',
        cellOrder: ['pnl', 'lbl'],
        cells: {
          pnl: {
            text: pnlText,
            bg: GUARD_COLOR,
            color: SELL_TEXT,
            minWidthText: '-100.00 pts',
          },
          lbl: {
            text: 'Guard',
            bg: GUARD_COLOR,
            color: SELL_TEXT,
          },
        },
      });
      series.attachPrimitive(p);
      p.setCoordinator(refs.drawingsPrimitive.current, 'risk-guard');
      primitiveRef.current = p;
      lastGuardPriceRef.current = price;
    };

    draw();
    const unsub = useStore.subscribe(draw);
    return () => {
      unsub();
      detach();
    };
  }, [contract, chartId, refs]);
}
