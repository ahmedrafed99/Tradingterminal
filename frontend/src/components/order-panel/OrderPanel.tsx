import { useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { realtimeService } from '../../services/realtimeService';
import { orderService } from '../../services/orderService';
import { marketDataService } from '../../services/marketDataService';
import { bracketEngine } from '../../services/bracketEngine';
import { showToast, errorMessage } from '../../utils/toast';
import type { GatewayQuote, RealtimeOrder, RealtimePosition } from '../../services/realtimeService';
import { InstrumentSelector } from '../InstrumentSelector';
import { OrderTypeTabs } from './OrderTypeTabs';
import { ContractsSpinner } from './ContractsSpinner';
import { BracketSummary } from './BracketSummary';
import { BuySellButtons } from './BuySellButtons';
import { PositionDisplay } from './PositionDisplay';
import { BracketSettingsModal } from './BracketSettingsModal';

export function OrderPanel() {
  const {
    orderContract, activeAccountId, setLastPrice, upsertPosition, upsertOrder, removeOrder,
    suspendPreset, restorePreset,
  } = useStore();

  const subscribedAccountRef = useRef<number | null>(null);

  // Subscribe to user hub events (orders, positions) when account changes
  useEffect(() => {
    if (activeAccountId == null) return;
    if (subscribedAccountRef.current === activeAccountId) return;

    subscribedAccountRef.current = activeAccountId;
    realtimeService.subscribeUserEvents(activeAccountId);
  }, [activeAccountId]);

  // Handle realtime order events
  useEffect(() => {
    const handler = (order: RealtimeOrder, _action: number) => {
      // Forward to bracket engine first (may need to place manual TPs or evaluate conditions)
      bracketEngine.onOrderEvent(order).catch((err) => {
        console.error('[OrderPanel] Bracket engine error:', err);
        showToast('error', 'Bracket engine error', errorMessage(err));
      });

      // status 2=filled or cancelled-type statuses → remove from open orders
      if (order.status === 2 || order.status === 3 || order.status === 4 || order.status === 5) {
        removeOrder(order.id);

        // If a pending limit entry was cancelled, clean up preview & ad-hoc brackets
        if (order.status !== 2) {
          const st = useStore.getState();
          if (st.previewHideEntry && st.orderContract
              && String(order.contractId) === String(st.orderContract.id)) {
            bracketEngine.clearSession();
            st.clearAdHocBrackets();
            useStore.setState({ previewEnabled: false, previewHideEntry: false });
          }
        }

      } else {
        upsertOrder({
          id: order.id,
          contractId: order.contractId,
          type: order.type,
          side: order.side,
          size: order.size,
          limitPrice: order.limitPrice,
          stopPrice: order.stopPrice,
          status: order.status,
        });
      }
    };
    realtimeService.onOrder(handler);
    return () => realtimeService.offOrder(handler);
  }, [upsertOrder, removeOrder]);

  // Handle realtime position events
  useEffect(() => {
    const handler = (pos: RealtimePosition, _action: number) => {
      upsertPosition(pos);
      if (pos.size === 0) {
        // Position closed → clear bracket session, cancel all orders for this contract, restore preset
        const bracketHandledIds = bracketEngine.clearSession();
        const acctId = useStore.getState().activeAccountId;
        if (acctId) {
          // Fetch fresh open orders from API (store may be stale due to event ordering)
          orderService.searchOpenOrders(acctId).then((orders) => {
            const contractOrders = orders.filter(
              (o) => String(o.contractId) === String(pos.contractId) && !bracketHandledIds.has(o.id),
            );
            for (const o of contractOrders) {
              orderService.cancelOrder(acctId, o.id).catch((err) => {
                console.error('[OrderPanel] Failed to cancel order on position close:', err);
                showToast('warning', `Failed to cancel order #${o.id}`,
                  'Order may still be open. Check manually.');
              });
            }
          }).catch((err) => {
            console.error('[OrderPanel] Failed to fetch orders for cleanup:', err);
            showToast('warning', 'Failed to fetch orders for cleanup',
              'Some orders may not have been cancelled after position close.');
          });
        }
        restorePreset();
      } else {
        // Position still open but size may have changed (TP partial fill or added contracts) —
        // sync SL size to match if bracket engine isn't managing
        if (!bracketEngine.hasActiveSession() && activeAccountId) {
          const contractId = String(pos.contractId);
          const posType = pos.type; // 1=long, 2=short
          const slSide: 0 | 1 = posType === 1 ? 1 : 0; // SL side = opposite of position
          const st = useStore.getState();
          const slOrder = st.openOrders.find(
            (o) => String(o.contractId) === contractId
              && (o.type === 4 || o.type === 5)
              && o.side === slSide
              && o.size !== pos.size,
          );
          if (slOrder) {
            console.log(`[OrderPanel] Position size changed — syncing SL size: ${slOrder.size} → ${pos.size}`);
            orderService.modifyOrder({
              accountId: activeAccountId,
              orderId: slOrder.id,
              size: pos.size,
            }).catch((err) => {
              console.error('[OrderPanel] Failed to sync SL size:', err);
              showToast('warning', 'SL size sync failed',
                `SL size may not match position size (${pos.size}). Check manually.`);
            });
          }
        }

        // Position opened → suspend preset, clear ad-hoc, turn off preview
        suspendPreset();
        const st = useStore.getState();
        st.clearAdHocBrackets();
        if (st.previewEnabled) {
          useStore.setState({ previewEnabled: false, previewHideEntry: false });
        }
      }
    };
    realtimeService.onPosition(handler);
    return () => realtimeService.offPosition(handler);
  }, [upsertPosition, suspendPreset, restorePreset]);

  // Seed lastPrice from latest bar so UP&L shows immediately (before first quote tick)
  useEffect(() => {
    if (!orderContract) return;
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    marketDataService.retrieveBars({
      contractId: orderContract.id,
      live: false,
      unit: 2,
      unitNumber: 1,
      startTime: fiveMinAgo.toISOString(),
      endTime: now.toISOString(),
      limit: 1,
      includePartialBar: true,
    }).then((bars) => {
      if (bars.length > 0) setLastPrice(bars[bars.length - 1].c);
    }).catch(() => {});
  }, [orderContract, setLastPrice]);

  // Update lastPrice from quote stream for P&L calculation
  useEffect(() => {
    if (!orderContract) return;
    const handler = (contractId: string, data: GatewayQuote) => {
      if (contractId === orderContract.id) {
        setLastPrice(data.lastPrice);
      }
    };
    realtimeService.onQuote(handler);
    return () => realtimeService.offQuote(handler);
  }, [orderContract, setLastPrice]);

  return (
    <div
      className="flex flex-col bg-black border-r border-[#2a2e39] overflow-y-auto"
      style={{ width: 240, minWidth: 240, padding: 12 }}
    >
      <div className="flex flex-col" style={{ gap: 20 }}>
        {/* Instrument */}
        <div>
          <div className="text-[10px] text-[#787b86] uppercase tracking-wider mb-1 text-center">Instrument</div>
          <div className="bg-[#111] rounded">
            <InstrumentSelector fixed />
          </div>
        </div>

        {/* Order Type */}
        <OrderTypeTabs />

        {/* Contracts */}
        <ContractsSpinner />

        {/* Bracket Settings */}
        <BracketSummary />

        {/* Preview toggle */}
        <PreviewToggle />

        {/* Buy / Sell */}
        <BuySellButtons />

        {/* Position */}
        <PositionDisplay />
      </div>

      <BracketSettingsModal />
    </div>
  );
}

function PreviewToggle() {
  const { previewEnabled, togglePreview, previewSide, setPreviewSide } = useStore();

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={previewEnabled}
          onChange={togglePreview}
          className="accent-[#2962ff] w-3.5 h-3.5"
        />
        <span className="text-xs text-[#787b86]">Preview</span>
      </label>
      {previewEnabled && (
        <div className="flex rounded overflow-hidden" style={{ height: 20 }}>
          <button
            onClick={() => setPreviewSide(0)}
            className="text-[10px] font-medium transition-colors"
            style={{
              padding: '0 6px',
              background: previewSide === 0 ? '#26a69a' : '#111',
              color: previewSide === 0 ? '#fff' : '#787b86',
            }}
          >
            Long
          </button>
          <button
            onClick={() => setPreviewSide(1)}
            className="text-[10px] font-medium transition-colors"
            style={{
              padding: '0 6px',
              background: previewSide === 1 ? '#ef5350' : '#111',
              color: previewSide === 1 ? '#fff' : '#787b86',
            }}
          >
            Short
          </button>
        </div>
      )}
    </div>
  );
}
