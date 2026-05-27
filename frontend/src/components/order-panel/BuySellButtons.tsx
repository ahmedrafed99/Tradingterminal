import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { OrderType, OrderSide } from '../../types/enums';
import { showToast } from '../../utils/toast';
import { detectHedge } from '../../utils/hedgeDetection';
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
    previewEnabled, setPreviewSide, positions, accounts,
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
    previewEnabled: s.previewEnabled,
    setPreviewSide: s.setPreviewSide,
    positions: s.positions,
    accounts: s.accounts,
  })));
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

  const orderBaseSymbol = orderContract?.name.replace(/[A-Z]\d+$/i, '') ?? '';
  const buyHedgeConflict = orderContract
    ? detectHedge(positions, orderContract.id, orderBaseSymbol, OrderSide.Buy, orderSize, activeAccountId, accounts)
    : null;
  const sellHedgeConflict = orderContract
    ? detectHedge(positions, orderContract.id, orderBaseSymbol, OrderSide.Sell, orderSize, activeAccountId, accounts)
    : null;

  const { open: marketOpen } = useMarketStatus(marketType);
  const baseCanPlace =
    activeAccountId != null &&
    orderContract != null &&
    marketOpen &&
    !isBlacklisted(contractSym) &&
    !isLockedOut(activeAccountId) &&
    (orderType === 'market' || (orderType === 'limit' && limitPrice != null));
  const canPlaceBuy = baseCanPlace && !buyHedgeConflict;
  const canPlaceSell = baseCanPlace && !sellHedgeConflict;

  async function handlePlace(side: OrderSide) {
    const sideCanPlace = side === OrderSide.Buy ? canPlaceBuy : canPlaceSell;
    if (!sideCanPlace || !activeAccountId || !orderContract) return;
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
          onMouseEnter={() => { if (previewEnabled) setPreviewSide(OrderSide.Sell); }}
          onClick={() => handlePlace(OrderSide.Sell)}
          disabled={!canPlaceSell || placing !== null}
          style={{ paddingLeft: 16 }}
          className="flex-1 flex flex-col items-start py-2 rounded transition-colors
                     bg-(--color-btn-sell) hover:bg-(--color-btn-sell-hover) cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {placing === 'sell' ? (
            <span className="text-sm font-light text-(--color-text-bright)">...</span>
          ) : (
            <>
              <span className="text-sm font-light text-(--color-text-bright)">Sell {orderSize}</span>
              <span className="text-sm font-light text-(--color-text-bright) mt-0.5">
                {orderType === 'limit' && limitPrice != null ? fmtP(limitPrice) : bid != null ? fmtP(bid) : '-'}
              </span>
            </>
          )}
        </button>

        {spread != null && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                       pointer-events-none py-0.5 rounded text-xs text-(--color-text-bright) text-center"
            style={{ background: 'var(--color-panel)', minWidth: 36 }}
          >
            {fmtP(spread)}
          </div>
        )}

        <button
          onMouseEnter={() => { if (previewEnabled) setPreviewSide(OrderSide.Buy); }}
          onClick={() => handlePlace(OrderSide.Buy)}
          disabled={!canPlaceBuy || placing !== null}
          style={{ paddingRight: 16 }}
          className="flex-1 flex flex-col items-end py-2 rounded transition-colors
                     bg-(--color-btn-buy) hover:bg-(--color-btn-buy-hover) cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {placing === 'buy' ? (
            <span className="text-sm font-light text-(--color-text-bright)">...</span>
          ) : (
            <>
              <span className="text-sm font-light text-(--color-text-bright)">Buy {orderSize}</span>
              <span className="text-sm font-light text-(--color-text-bright) mt-0.5">
                {orderType === 'limit' && limitPrice != null ? fmtP(limitPrice) : ask != null ? fmtP(ask) : '-'}
              </span>
            </>
          )}
        </button>
      </div>
      {(sellHedgeConflict ?? buyHedgeConflict) && (() => {
        const c = sellHedgeConflict ?? buyHedgeConflict!;
        return (
          <div className="text-xs text-(--color-warning) text-center">
            <div className="flex items-center justify-center gap-1.5">
              <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>Hedge blocked — {c.direction} {c.symbol}</span>
            </div>
            <div className="opacity-60 mt-0.5">{c.accountName}</div>
          </div>
        );
      })()}
      {error && (
        <div className="text-xs text-(--color-error) mt-1">{error}</div>
      )}
    </div>
  );
}
