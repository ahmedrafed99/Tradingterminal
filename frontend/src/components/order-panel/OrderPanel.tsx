import { lazy, Suspense, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';
import { realtimeService } from '../../services/realtimeService';
import { orderService, type Order } from '../../services/orderService';
import { positionService } from '../../services/positionService';
import { tradeService } from '../../services/tradeService';
import { marketDataService } from '../../services/marketDataService';
import { bracketEngine } from '../../services/bracketEngine';
import { OrderType, OrderSide, OrderStatus, PositionType } from '../../types/enums';
import { getCmeSessionStart } from '../../utils/cmeSession';
import { showToast, errorMessage } from '../../utils/toast';
import type { GatewayQuote, RealtimeOrder, RealtimePosition } from '../../services/realtimeService';
import { InstrumentSelector } from '../InstrumentSelector';
import { OrderTypeTabs } from './OrderTypeTabs';
import { ContractsSpinner } from './ContractsSpinner';
import { BracketSummary } from './BracketSummary';
import { BuySellButtons } from './BuySellButtons';
import { PositionDisplay } from './PositionDisplay';

const BracketSettingsModal = lazy(() => import('./BracketSettingsModal').then(m => ({ default: m.BracketSettingsModal })));

/**
 * Infer open positions from open orders + recent trades.
 * If protective orders (SL/TP) exist for a contract but no position is in the
 * store, we derive the position from the stop loss order (direction, size) and
 * recent opening trades (entry price).
 */
async function inferPositionsFromOrders(accountId: number, orders: Order[]) {
  // Group protective orders by contractId
  const contracts = new Map<string, { slOrder?: Order; tpOrders: Order[] }>();
  for (const o of orders) {
    if (o.type === OrderType.Stop || o.type === OrderType.TrailingStop) {
      const entry = contracts.get(o.contractId) ?? { tpOrders: [] };
      entry.slOrder = o;
      contracts.set(o.contractId, entry);
    } else if (o.type === OrderType.Limit) {
      const entry = contracts.get(o.contractId) ?? { tpOrders: [] };
      entry.tpOrders.push(o);
      contracts.set(o.contractId, entry);
    }
  }

  const st = useStore.getState();
  const needsInference: string[] = [];
  for (const [contractId, group] of contracts) {
    if (!group.slOrder) continue; // no stop → can't reliably infer
    const existing = st.positions.find(
      (p) => p.accountId === accountId && String(p.contractId) === String(contractId) && p.size > 0,
    );
    if (!existing) needsInference.push(contractId);
  }

  if (needsInference.length === 0) return;

  // Fetch session trades to find entry price(s)
  let trades;
  try {
    trades = await tradeService.searchTrades(accountId, getCmeSessionStart());
  } catch {
    if (import.meta.env.DEV) console.warn('[OrderPanel] Could not fetch trades for position inference');
    return;
  }

  for (const contractId of needsInference) {
    const group = contracts.get(contractId)!;
    const slOrder = group.slOrder!;

    // Derive direction: SL sell → position is long, SL buy → position is short
    const isLong = slOrder.side === OrderSide.Sell;
    const posType = isLong ? PositionType.Long : PositionType.Short;
    const posSize = slOrder.size;
    const entrySide = isLong ? OrderSide.Buy : OrderSide.Sell;

    // Find opening trades for this contract+side (profitAndLoss is null for opening half-turns)
    const openingTrades = trades.filter(
      (t) => String(t.contractId) === String(contractId)
        && t.side === entrySide
        && !t.voided,
    );

    if (openingTrades.length === 0) continue;

    // Compute weighted average entry price from opening trades
    let totalSize = 0;
    let weightedPrice = 0;
    for (const t of openingTrades) {
      // Only use opening half-turns (profitAndLoss === null) or, if all have P&L, use latest
      if (t.profitAndLoss === null) {
        weightedPrice += t.price * t.size;
        totalSize += t.size;
      }
    }
    // Fallback: if no opening half-turns found, use the most recent trade
    if (totalSize === 0) {
      const latest = openingTrades.sort(
        (a, b) => new Date(b.creationTimestamp).getTime() - new Date(a.creationTimestamp).getTime(),
      )[0];
      weightedPrice = latest.price * latest.size;
      totalSize = latest.size;
    }

    const avgPrice = weightedPrice / totalSize;

    const syntheticPos: import('../../adapters/types').RealtimePosition = {
      id: -Date.now(), // synthetic ID
      accountId,
      contractId,
      type: posType,
      size: posSize,
      averagePrice: avgPrice,
    };

    if (import.meta.env.DEV) {
      console.log(`[OrderPanel] Inferred position: ${isLong ? 'LONG' : 'SHORT'} ${posSize}ct @ ${avgPrice} for ${contractId}`);
    }
    useStore.getState().upsertPosition(syntheticPos);
  }
}

/** Fetch open orders + positions and merge into store. */
function hydratePositionsAndOrders(accountId: number) {
  // Try REST position endpoint first (may not exist on all gateways)
  positionService.searchOpenPositions(accountId).then((positions) => {
    const st = useStore.getState();
    for (const pos of positions) st.upsertPosition(pos);
  }).catch(() => {});

  // Fetch orders, then infer positions if needed
  orderService.searchOpenOrders(accountId).then(async (orders) => {
    useStore.getState().setOpenOrders(orders);

    // If no positions loaded yet, infer from orders + trades
    const st = useStore.getState();
    const hasAnyPosition = st.positions.some(
      (p) => p.accountId === accountId && p.size > 0,
    );
    if (!hasAnyPosition && orders.length > 0) {
      await inferPositionsFromOrders(accountId, orders);
    }
  }).catch((err) => {
    if (import.meta.env.DEV) console.warn('[OrderPanel] Order REST fetch failed:', err);
  });
}

export function OrderPanel() {
  const {
    orderContract, activeAccountId, setLastPrice, upsertPosition, upsertOrder, removeOrder,
    suspendPreset, restorePreset, editingPresetId,
    orderLinkedToChart, setOrderLinkedToChart, setOrderContract,
  } = useStore(useShallow((s) => ({
    orderContract: s.orderContract,
    activeAccountId: s.activeAccountId,
    setLastPrice: s.setLastPrice,
    upsertPosition: s.upsertPosition,
    upsertOrder: s.upsertOrder,
    removeOrder: s.removeOrder,
    suspendPreset: s.suspendPreset,
    restorePreset: s.restorePreset,
    editingPresetId: s.editingPresetId,
    orderLinkedToChart: s.orderLinkedToChart,
    setOrderLinkedToChart: s.setOrderLinkedToChart,
    setOrderContract: s.setOrderContract,
  })));

  // Sync order panel instrument to the specifically linked chart
  const linkedContract = useStore((s) =>
    s.orderLinkedToChart === 'left' ? s.contract
      : s.orderLinkedToChart === 'right' ? s.secondContract
      : null,
  );
  useEffect(() => {
    if (orderLinkedToChart && linkedContract) {
      setOrderContract(linkedContract);
    }
  }, [orderLinkedToChart, linkedContract, setOrderContract]);

  const subscribedAccountRef = useRef<number | null>(null);

  // Subscribe to user hub events (orders, positions) when account changes
  // Also fetch current positions + orders via REST (SignalR may not send a snapshot)
  useEffect(() => {
    if (activeAccountId == null) return;
    if (subscribedAccountRef.current === activeAccountId) return;

    subscribedAccountRef.current = activeAccountId;
    realtimeService.subscribeUserEvents(activeAccountId);

    // Hydrate positions + orders from REST so we don't depend on SignalR initial batch
    hydratePositionsAndOrders(activeAccountId);
  }, [activeAccountId]);

  // Re-fetch open orders + positions on user hub reconnect (events may have been missed)
  useEffect(() => {
    const handler = () => {
      const acctId = useStore.getState().activeAccountId;
      if (acctId == null) return;
      hydratePositionsAndOrders(acctId);
    };
    realtimeService.onUserReconnect(handler);
    return () => realtimeService.offUserReconnect(handler);
  }, []);

  // Handle realtime order events
  useEffect(() => {
    const handler = (order: RealtimeOrder, _action: number) => {
      // Forward to bracket engine first (may need to place manual TPs or evaluate conditions)
      bracketEngine.onOrderEvent(order).catch((err) => {
        showToast('error', 'Bracket engine error', errorMessage(err));
      });

      // status 2=filled or cancelled-type statuses → remove from open orders
      if (order.status === OrderStatus.Filled || order.status === OrderStatus.Cancelled || order.status === OrderStatus.Rejected || order.status === OrderStatus.Expired) {
        removeOrder(order.id);

        // If a pending limit entry was cancelled, clean up preview & ad-hoc brackets
        if (order.status !== OrderStatus.Filled) {
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
                showToast('warning', `Failed to cancel order #${o.id}`,
                  'Order may still be open. Check manually.');
              });
            }
          }).catch((err) => {
            showToast('warning', 'Failed to fetch orders for cleanup',
              'Some orders may not have been cancelled after position close.');
          });
        }
        restorePreset();
      } else {
        // Position still open but size may have changed (TP partial fill, manual partial close,
        // or added contracts) — always sync SL size to match position.
        // This acts as both the primary handler (ad-hoc SL) and a safety net (bracket engine
        // session active but its modify failed). Duplicate modifies are harmless.
        const acctId = useStore.getState().activeAccountId;
        if (acctId) {
          const contractId = String(pos.contractId);
          const posType = pos.type;
          const slSide = posType === PositionType.Long ? OrderSide.Sell : OrderSide.Buy;
          const st = useStore.getState();
          const slOrder = st.openOrders.find(
            (o) => String(o.contractId) === contractId
              && (o.type === OrderType.Stop || o.type === OrderType.TrailingStop)
              && o.side === slSide
              && o.size !== pos.size,
          );
          if (slOrder) {
            if (import.meta.env.DEV) console.log(`[OrderPanel] Position size changed — syncing SL size: ${slOrder.size} → ${pos.size}`);
            orderService.modifyOrder({
              accountId: acctId,
              orderId: slOrder.id,
              size: pos.size,
            }).catch((err) => {
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
        <div className="relative">
          <div className="flex items-center mb-1">
            <div className={`flex-1 ${SECTION_LABEL} text-center`}>Instrument</div>
          </div>
          <div className="absolute" style={{ top: -2, right: -4 }}>
            <LinkChartButton linked={orderLinkedToChart} onToggle={setOrderLinkedToChart} />
          </div>
          <div className="bg-[#111] rounded" style={{ marginTop: 6 }}>
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

      {editingPresetId !== null && (
        <Suspense fallback={null}>
          <BracketSettingsModal />
        </Suspense>
      )}
    </div>
  );
}

function LinkChartButton({ linked, onToggle }: {
  linked: 'left' | 'right' | null;
  onToggle: (v: 'left' | 'right' | null) => void;
}) {
  const selectedChart = useStore((s) => s.selectedChart);
  const isActiveForSelected = linked === selectedChart;
  const label = isActiveForSelected ? `Linked to ${linked} chart` : 'Link to chart';
  return (
    <button
      onClick={() => onToggle(isActiveForSelected ? null : selectedChart)}
      title={label}
      className="transition-colors"
      style={{ padding: '0 2px' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke={isActiveForSelected ? '#f0a830' : '#787b86'}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ transition: 'stroke 0.2s ease' }}
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
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
            onClick={() => setPreviewSide(OrderSide.Buy)}
            className="text-[10px] font-medium transition-colors"
            style={{
              padding: '0 6px',
              background: previewSide === OrderSide.Buy ? '#26a69a' : '#111',
              color: previewSide === OrderSide.Buy ? '#fff' : '#787b86',
            }}
          >
            Long
          </button>
          <button
            onClick={() => setPreviewSide(OrderSide.Sell)}
            className="text-[10px] font-medium transition-colors"
            style={{
              padding: '0 6px',
              background: previewSide === OrderSide.Sell ? '#ef5350' : '#111',
              color: previewSide === OrderSide.Sell ? '#fff' : '#787b86',
            }}
          >
            Short
          </button>
        </div>
      )}
    </div>
  );
}
