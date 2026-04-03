import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { OrderType, OrderSide } from '../../types/enums';
import { showToast } from '../../utils/toast';
import type { BracketConfig } from '../../types/bracket';
import { placeOrderWithBrackets } from '../../services/placeOrderWithBrackets';
import { getSchedule, useMarketStatus } from '../../utils/marketHours';
import type { MarketType } from '../../utils/marketHours';

export function BuySellButtons() {
  const {
    activeAccountId, orderContract, orderType, limitPrice, orderSize,
    bracketPresets, activePresetId, draftSlPoints, draftTpPoints,
    adHocSlPoints, adHocTpLevels,
    clearDraftOverrides, clearAdHocBrackets, marketType,
  } = useStore(useShallow((s) => ({
    activeAccountId: s.activeAccountId,
    orderContract: s.orderContract,
    orderType: s.orderType,
    limitPrice: s.limitPrice,
    orderSize: s.orderSize,
    bracketPresets: s.bracketPresets,
    activePresetId: s.activePresetId,
    draftSlPoints: s.draftSlPoints,
    draftTpPoints: s.draftTpPoints,
    adHocSlPoints: s.adHocSlPoints,
    adHocTpLevels: s.adHocTpLevels,
    clearDraftOverrides: s.clearDraftOverrides,
    clearAdHocBrackets: s.clearAdHocBrackets,
    marketType: (s.contract?.marketType ?? 'futures') as MarketType,
  })));
  const typeLabel = orderType === 'market' ? 'Market' : 'Limit';
  const [placing, setPlacing] = useState<'buy' | 'sell' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { open: marketOpen } = useMarketStatus(marketType);
  const canPlace =
    activeAccountId != null &&
    orderContract != null &&
    marketOpen &&
    (orderType === 'market' || (orderType === 'limit' && limitPrice != null));

  async function handlePlace(side: OrderSide) {
    if (!canPlace || !activeAccountId || !orderContract) return;
    if (!getSchedule(marketType).isOpen()) {
      showToast('warning', 'Market closed', 'Market is closed. Orders cannot be placed.');
      return;
    }
    const label = side === OrderSide.Buy ? 'buy' : 'sell';
    setPlacing(label);
    setError(null);

    // Build bracket config from preset+drafts or ad-hoc state
    const activePreset = bracketPresets.find((p) => p.id === activePresetId);
    const bc = activePreset?.config;
    let mergedConfig: BracketConfig | null = null;

    if (bc) {
      mergedConfig = {
        ...bc,
        stopLoss: { ...bc.stopLoss, points: draftSlPoints ?? bc.stopLoss.points },
        takeProfits: bc.takeProfits.map((tp, i) => ({
          ...tp,
          points: draftTpPoints[i] ?? tp.points,
        })),
      };
    } else if (adHocSlPoints != null || adHocTpLevels.length > 0) {
      mergedConfig = {
        stopLoss: { points: adHocSlPoints ?? 0, type: 'Stop' as const },
        takeProfits: adHocTpLevels.map((tp, i) => ({
          id: `adhoc-tp-${i}`,
          points: tp.points,
          size: tp.size,
        })),
        conditions: [],
      };
    }

    try {
      await placeOrderWithBrackets({
        accountId: activeAccountId,
        contractId: orderContract.id,
        contract: orderContract,
        side,
        size: orderSize,
        orderType: orderType === 'market' ? OrderType.Market : OrderType.Limit,
        limitPrice: orderType === 'limit' ? limitPrice ?? undefined : undefined,
        bracketConfig: mergedConfig,
      });

      clearDraftOverrides();
      if (orderType === 'market' && useStore.getState().previewEnabled) {
        clearAdHocBrackets();
        useStore.getState().togglePreview();
      } else if (orderType === 'limit' && useStore.getState().previewEnabled) {
        useStore.setState({ previewHideEntry: true });
      } else if (!useStore.getState().previewHideEntry) {
        clearAdHocBrackets();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Order failed';
      setError(msg);
      showToast('error', 'Order placement failed', msg);
    } finally {
      setPlacing(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <button
          onClick={() => handlePlace(OrderSide.Buy)}
          disabled={!canPlace || placing !== null}
          className="flex-1 py-2.5 rounded font-bold text-[11px] text-(--color-text) transition-colors
                     bg-(--color-btn-buy) hover:bg-(--color-btn-buy-hover) cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {placing === 'buy' ? '...' : `Buy +${orderSize} ${typeLabel}`}
        </button>
        <button
          onClick={() => handlePlace(OrderSide.Sell)}
          disabled={!canPlace || placing !== null}
          className="flex-1 py-2.5 rounded font-bold text-[11px] text-(--color-text) transition-colors
                     bg-(--color-btn-sell) hover:bg-(--color-btn-sell-hover) cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {placing === 'sell' ? '...' : `Sell -${orderSize} ${typeLabel}`}
        </button>
      </div>
      {error && (
        <div className="text-[10px] text-(--color-error) mt-1">{error}</div>
      )}
    </div>
  );
}
