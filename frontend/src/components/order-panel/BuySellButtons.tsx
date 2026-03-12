import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { orderService } from '../../services/orderService';
import { bracketEngine } from '../../services/bracketEngine';
import { OrderType, OrderSide } from '../../types/enums';
import { showToast } from '../../utils/toast';
import type { PlaceOrderParams } from '../../services/orderService';
import type { BracketConfig } from '../../types/bracket';
import { buildNativeBracketParams, buildNativeSLOnly } from '../../types/bracket';
import { isFuturesMarketOpen, useMarketStatus } from '../../utils/marketHours';

export function BuySellButtons() {
  const {
    activeAccountId, orderContract, orderType, limitPrice, orderSize,
    bracketPresets, activePresetId, draftSlPoints, draftTpPoints,
    adHocSlPoints, adHocTpLevels,
    clearDraftOverrides, clearAdHocBrackets,
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
  })));
  const typeLabel = orderType === 'market' ? 'Market' : 'Limit';
  const [placing, setPlacing] = useState<'buy' | 'sell' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const marketOpen = useMarketStatus();
  const canPlace =
    activeAccountId != null &&
    orderContract != null &&
    marketOpen &&
    (orderType === 'market' || (orderType === 'limit' && limitPrice != null));

  async function handlePlace(side: OrderSide) {
    if (!canPlace || !activeAccountId || !orderContract) return;
    if (!isFuturesMarketOpen()) {
      showToast('warning', 'Market closed', 'Futures market is closed. Orders cannot be placed.');
      return;
    }
    const label = side === OrderSide.Buy ? 'buy' : 'sell';
    setPlacing(label);
    setError(null);

    const params: PlaceOrderParams = {
      accountId: activeAccountId,
      contractId: orderContract.id,
      type: orderType === 'market' ? OrderType.Market : OrderType.Limit,
      side,
      size: orderSize,
    };

    if (orderType === 'limit' && limitPrice != null) {
      params.limitPrice = limitPrice;
    }

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

    const bracketsActive = mergedConfig != null
      && (mergedConfig.stopLoss.points >= 1 || mergedConfig.takeProfits.length >= 1);

    // Use gateway-native brackets for <= 1 TP (atomic placement, zero latency gap).
    // For 2+ TPs, attach native SL bracket (zero-latency SL) + arm engine for TPs only.
    const nativeBrackets = bracketsActive && mergedConfig ? buildNativeBracketParams(mergedConfig, side, orderContract) : null;

    if (nativeBrackets) {
      Object.assign(params, nativeBrackets);
    } else if (bracketsActive && mergedConfig) {
      // 2+ TPs — attach native SL for zero-latency protection, engine handles TPs after fill
      const nativeSL = buildNativeSLOnly(mergedConfig, side, orderContract);
      if (nativeSL) Object.assign(params, nativeSL);

      bracketEngine.armForEntry({
        accountId: activeAccountId,
        contractId: orderContract.id,
        entrySide: side,
        entrySize: orderSize,
        config: mergedConfig,
        contract: orderContract,
        nativeSL: !!nativeSL,
      });
    }

    try {
      const { orderId } = await orderService.placeOrder(params);

      // Confirm orderId — engine checks buffered fills (only for 2+ TP path)
      if (bracketsActive && !nativeBrackets) {
        bracketEngine.confirmEntryOrderId(orderId);
      }
      clearDraftOverrides();
      if (orderType === 'market' && useStore.getState().previewEnabled) {
        clearAdHocBrackets();
        useStore.getState().togglePreview();
      } else if (orderType === 'limit' && useStore.getState().previewEnabled) {
        // Keep ad-hoc SL/TP visible — only hide the entry line
        useStore.setState({ previewHideEntry: true });
      } else {
        clearAdHocBrackets();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Order failed';
      setError(msg);
      showToast('error', 'Order placement failed', msg);
      // Disarm bracket engine if it was armed for this order (2+ TP path)
      if (bracketsActive && !nativeBrackets) {
        bracketEngine.clearSession();
      }
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
                     bg-(--color-btn-buy) hover:bg-(--color-btn-buy-hover) disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {placing === 'buy' ? '...' : `Buy +${orderSize} ${typeLabel}`}
        </button>
        <button
          onClick={() => handlePlace(OrderSide.Sell)}
          disabled={!canPlace || placing !== null}
          className="flex-1 py-2.5 rounded font-bold text-[11px] text-(--color-text) transition-colors
                     bg-(--color-btn-sell) hover:bg-(--color-btn-sell-hover) disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {placing === 'sell' ? '...' : `Sell -${orderSize} ${typeLabel}`}
        </button>
      </div>
      {!marketOpen && (
        <div
          className="flex items-center justify-center gap-1 rounded text-[10px] text-(--color-warning) transition-colors whitespace-nowrap"
          style={{ padding: '5px 0', marginTop: 12, background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)' }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Market closed — reopens Sun 18:00 ET
        </div>
      )}
      {error && (
        <div className="text-[10px] text-(--color-error) mt-1">{error}</div>
      )}
    </div>
  );
}
