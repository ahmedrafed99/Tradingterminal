import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { OrderType, OrderSide } from '../../types/enums';
import { showToast } from '../../utils/toast';
import type { BracketConfig } from '../../types/bracket';
import { placeOrderWithBrackets } from '../../services/placeOrderWithBrackets';
import { getSchedule, useMarketStatus } from '../../utils/marketHours';
import type { MarketType } from '../../utils/marketHours';
import { realtimeService } from '../../services/realtimeService';
import type { GatewayQuote } from '../../services/realtimeService';

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
  const [bid, setBid] = useState<number | null>(null);
  const [ask, setAsk] = useState<number | null>(null);

  const tickSize = orderContract?.tickSize ?? 0.25;
  const decimals = Math.max(2, Math.ceil(-Math.log10(tickSize)));
  function fmtP(price: number) { return price.toFixed(decimals); }

  useEffect(() => {
    if (!orderContract) return;
    setBid(null);
    setAsk(null);
    const handler = (contractId: string, data: GatewayQuote) => {
      if (contractId !== orderContract.id) return;
      if (data.bestBid != null) setBid(data.bestBid);
      if (data.bestAsk != null) setAsk(data.bestAsk);
    };
    realtimeService.onQuote(handler);
    return () => realtimeService.offQuote(handler);
  }, [orderContract]);

  const isBlacklisted = useStore((s) => s.isBlacklisted);
  const isLockedOut = useStore((s) => s.isLockedOut);
  const contractSym = orderContract?.name.replace(/[A-Z]\d+$/i, '') ?? null;

  const { open: marketOpen } = useMarketStatus(marketType);
  const canPlace =
    activeAccountId != null &&
    orderContract != null &&
    marketOpen &&
    !isBlacklisted(contractSym) &&
    !isLockedOut(activeAccountId) &&
    (orderType === 'market' || (orderType === 'limit' && limitPrice != null));

  async function handlePlace(side: OrderSide) {
    if (!canPlace || !activeAccountId || !orderContract) return;
    if (isLockedOut(activeAccountId)) {
      showToast('error', 'Account locked', 'Account is locked. Wait for the lockout to expire.');
      return;
    }
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

  const spread = bid != null && ask != null ? ask - bid : null;

  return (
    <div className="space-y-1.5">
      {/* Buy / Sell buttons with spread badge at intersection */}
      <div className="relative flex gap-1.5">
        <button
          onClick={() => handlePlace(OrderSide.Sell)}
          disabled={!canPlace || placing !== null}
          className="flex-1 flex flex-col items-center py-3 rounded transition-colors
                     bg-(--color-btn-sell) hover:bg-(--color-btn-sell-hover) cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {placing === 'sell' ? (
            <span className="font-bold text-sm text-(--color-text-bright)">...</span>
          ) : (
            <>
              <span className="font-bold text-sm text-(--color-text-bright)">Sell +{orderSize}</span>
              <span className="text-sm text-(--color-text-bright) opacity-60 mt-0.5">
                {orderType === 'limit' && limitPrice != null ? fmtP(limitPrice) : bid != null ? fmtP(bid) : '—'}
              </span>
            </>
          )}
        </button>

        {spread != null && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                       pointer-events-none py-0.5 rounded text-xs text-(--color-text-muted) text-center"
            style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', minWidth: 36 }}
          >
            {fmtP(spread)}
          </div>
        )}

        <button
          onClick={() => handlePlace(OrderSide.Buy)}
          disabled={!canPlace || placing !== null}
          className="flex-1 flex flex-col items-center py-3 rounded transition-colors
                     bg-(--color-btn-buy) hover:bg-(--color-btn-buy-hover) cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {placing === 'buy' ? (
            <span className="font-bold text-sm text-(--color-text-bright)">...</span>
          ) : (
            <>
              <span className="font-bold text-sm text-(--color-text-bright)">Buy +{orderSize}</span>
              <span className="text-sm text-(--color-text-bright) opacity-60 mt-0.5">
                {orderType === 'limit' && limitPrice != null ? fmtP(limitPrice) : ask != null ? fmtP(ask) : '—'}
              </span>
            </>
          )}
        </button>
      </div>
      {error && (
        <div className="text-xs text-(--color-error) mt-1">{error}</div>
      )}
    </div>
  );
}
