import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { IS_DEMO } from '../adapters/demo/index';
import { placeOrderWithBrackets } from '../services/placeOrderWithBrackets';
import { OrderType, OrderSide } from '../types/enums';
import type { BracketConfig } from '../types/bracket';
import { getTicksPerPoint } from '../utils/instrument';

/**
 * Connects to the backend SSE stream at /drawings/events.
 * Handles drawing commands and remote order placement through
 * the same placeOrderWithBrackets path as the UI.
 */
export function useRemoteDrawings(): void {
  const addDrawing = useStore((s) => s.addDrawing);
  const removeDrawing = useStore((s) => s.removeDrawing);
  const clearAllDrawings = useStore((s) => s.clearAllDrawings);
  const addDrawingRef = useRef(addDrawing);
  const removeRef = useRef(removeDrawing);
  const clearAllRef = useRef(clearAllDrawings);
  addDrawingRef.current = addDrawing;
  removeRef.current = removeDrawing;
  clearAllRef.current = clearAllDrawings;

  useEffect(() => {
    if (IS_DEMO) return;
    const es = new EventSource('/drawings/events');

    es.onmessage = (e) => {
      try {
        const message = JSON.parse(e.data);
        if (message._command === 'clearAll') {
          clearAllRef.current();
        } else if (message._command === 'remove' && message.id) {
          removeRef.current(message.id);
        } else if (message._command === 'placeOrder') {
          handleRemoteOrder(message);
        } else {
          addDrawingRef.current(message);
        }
      } catch {
        // Malformed message — ignore
      }
    };

    return () => es.close();
  }, []);
}

const ORDER_TYPE_MAP: Record<string, OrderType> = {
  market: OrderType.Market,
  limit: OrderType.Limit,
  stop: OrderType.Stop,
};

async function handleRemoteOrder(remoteOrder: any): Promise<void> {
  try {
    const contract = useStore.getState().orderContract;
    if (!contract || String(contract.id) !== String(remoteOrder.contractId)) {
      console.error('[useRemoteDrawings] Contract mismatch or not loaded:', remoteOrder.contractId);
      return;
    }

    const side = remoteOrder.side === 'buy' || remoteOrder.side === 0 ? OrderSide.Buy : OrderSide.Sell;
    const orderType = typeof remoteOrder.type === 'string' ? (ORDER_TYPE_MAP[remoteOrder.type] ?? OrderType.Limit) : (remoteOrder.type ?? OrderType.Limit);

    // Build bracket config from sl/tp tick values (convert ticks → points)
    const tpp = getTicksPerPoint(contract);
    let bracketConfig: BracketConfig | null = null;
    if (remoteOrder.slTicks || remoteOrder.tpTicks) {
      bracketConfig = {
        stopLoss: { points: remoteOrder.slTicks ? Number(remoteOrder.slTicks) / tpp : 0, type: 'Stop' as const },
        takeProfits: remoteOrder.tpTicks ? [{ id: 'bot-tp-0', points: Number(remoteOrder.tpTicks) / tpp, size: Number(remoteOrder.size) }] : [],
        conditions: [],
      };
    }

    // Use active preset if requested and no explicit sl/tp
    if (!bracketConfig && remoteOrder.usePreset) {
      const storeState = useStore.getState();
      const preset = storeState.bracketPresets.find((bracketPreset) => bracketPreset.id === storeState.activePresetId);
      if (preset) bracketConfig = preset.config;
    }

    await placeOrderWithBrackets({
      accountId: remoteOrder.accountId,
      contractId: remoteOrder.contractId,
      contract,
      side,
      size: Number(remoteOrder.size),
      orderType,
      limitPrice: remoteOrder.limitPrice != null ? Number(remoteOrder.limitPrice) : undefined,
      stopPrice: remoteOrder.stopPrice != null ? Number(remoteOrder.stopPrice) : undefined,
      bracketConfig,
    });

  } catch (err) {
    console.error('[useRemoteDrawings] Order failed:', err);
  }
}
