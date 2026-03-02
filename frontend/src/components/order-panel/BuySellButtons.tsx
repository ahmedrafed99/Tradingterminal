import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { orderService } from '../../services/orderService';
import { bracketEngine } from '../../services/bracketEngine';
import { showToast } from '../../utils/toast';
import type { PlaceOrderParams } from '../../services/orderService';
import type { BracketConfig } from '../../types/bracket';

export function BuySellButtons() {
  const {
    activeAccountId, orderContract, orderType, limitPrice, orderSize,
    bracketPresets, activePresetId, draftSlPoints, draftTpPoints,
    adHocSlPoints, adHocTpLevels,
    clearDraftOverrides, clearAdHocBrackets,
  } = useStore();
  const typeLabel = orderType === 'market' ? 'Market' : 'Limit';
  const [placing, setPlacing] = useState<'buy' | 'sell' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canPlace =
    activeAccountId != null &&
    orderContract != null &&
    (orderType === 'market' || (orderType === 'limit' && limitPrice != null));

  async function handlePlace(side: 0 | 1) {
    if (!canPlace || !activeAccountId || !orderContract) return;
    const label = side === 0 ? 'buy' : 'sell';
    setPlacing(label);
    setError(null);

    const params: PlaceOrderParams = {
      accountId: activeAccountId,
      contractId: orderContract.id,
      type: orderType === 'market' ? 2 : 1,
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

    // Arm bracket engine BEFORE placing so it can buffer fill events
    if (bracketsActive && mergedConfig) {
      bracketEngine.armForEntry({
        accountId: activeAccountId,
        contractId: orderContract.id,
        entrySide: side,
        entrySize: orderSize,
        config: mergedConfig,
        tickSize: orderContract.tickSize || 0.25,
      });
    }

    try {
      const { orderId } = await orderService.placeOrder(params);

      // Confirm orderId — engine checks buffered fills
      if (bracketsActive) {
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
    } finally {
      setPlacing(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <button
          onClick={() => handlePlace(0)}
          disabled={!canPlace || placing !== null}
          className="flex-1 py-2.5 rounded font-bold text-[11px] text-[#d1d4dc] transition-colors
                     bg-[#1b6b4a] hover:bg-[#22835b] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {placing === 'buy' ? '...' : `Buy +${orderSize} ${typeLabel}`}
        </button>
        <button
          onClick={() => handlePlace(1)}
          disabled={!canPlace || placing !== null}
          className="flex-1 py-2.5 rounded font-bold text-[11px] text-[#d1d4dc] transition-colors
                     bg-[#8b2232] hover:bg-[#a62a3d] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {placing === 'sell' ? '...' : `Sell -${orderSize} ${typeLabel}`}
        </button>
      </div>
      {error && (
        <div className="text-[10px] text-[#ff4444] mt-1">{error}</div>
      )}
    </div>
  );
}
