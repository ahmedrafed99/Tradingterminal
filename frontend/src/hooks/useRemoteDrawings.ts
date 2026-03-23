import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
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
    const es = new EventSource('/drawings/events');

    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d._command === 'clearAll') {
          clearAllRef.current();
        } else if (d._command === 'remove' && d.id) {
          removeRef.current(d.id);
        } else if (d._command === 'placeOrder') {
          handleRemoteOrder(d);
        } else {
          addDrawingRef.current(d);
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

async function handleRemoteOrder(d: any): Promise<void> {
  try {
    const contract = useStore.getState().orderContract;
    if (!contract || String(contract.id) !== String(d.contractId)) {
      console.error('[useRemoteDrawings] Contract mismatch or not loaded:', d.contractId);
      return;
    }

    const side = d.side === 'buy' || d.side === 0 ? OrderSide.Buy : OrderSide.Sell;
    const orderType = typeof d.type === 'string' ? (ORDER_TYPE_MAP[d.type] ?? OrderType.Limit) : (d.type ?? OrderType.Limit);

    // Build bracket config from sl/tp tick values (convert ticks → points)
    const tpp = getTicksPerPoint(contract);
    let bracketConfig: BracketConfig | null = null;
    if (d.slTicks || d.tpTicks) {
      bracketConfig = {
        stopLoss: { points: d.slTicks ? Number(d.slTicks) / tpp : 0, type: 'Stop' as const },
        takeProfits: d.tpTicks ? [{ id: 'bot-tp-0', points: Number(d.tpTicks) / tpp, size: Number(d.size) }] : [],
        conditions: [],
      };
    }

    // Use active preset if requested and no explicit sl/tp
    if (!bracketConfig && d.usePreset) {
      const st = useStore.getState();
      const preset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      if (preset) bracketConfig = preset.config;
    }

    const result = await placeOrderWithBrackets({
      accountId: d.accountId,
      contractId: d.contractId,
      contract,
      side,
      size: Number(d.size),
      orderType,
      limitPrice: d.limitPrice != null ? Number(d.limitPrice) : undefined,
      stopPrice: d.stopPrice != null ? Number(d.stopPrice) : undefined,
      bracketConfig,
    });

    console.log('[useRemoteDrawings] Order placed:', result.orderId);
  } catch (err) {
    console.error('[useRemoteDrawings] Order failed:', err);
  }
}
