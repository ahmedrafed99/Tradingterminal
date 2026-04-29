import { lazy, Suspense, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';
import { realtimeService } from '../../services/realtimeService';
import { orderService, type Order } from '../../services/orderService';
import { positionService } from '../../services/positionService';
import { tradeService } from '../../services/tradeService';
import { getCmeSessionStart } from '../../utils/cmeSession';
import { marketDataService } from '../../services/marketDataService';
import { bracketEngine } from '../../services/bracketEngine';
import { resolvePreviewConfig } from '../chart/hooks/resolvePreviewConfig';
import { pointsToPrice } from '../../utils/instrument';
import { OrderType, OrderSide, OrderStatus, PositionType } from '../../types/enums';
import { debugLog } from '../../utils/debugLog';
if (import.meta.env.DEV) debugLog.enable();
import { showToast, errorMessage } from '../../utils/toast';
import { audioService } from '../../services/audioService';
import { consumeManualClose } from '../../services/manualCloseTracker';
import type { GatewayQuote, RealtimeOrder, RealtimePosition } from '../../services/realtimeService';
import { InstrumentSelector } from '../InstrumentSelector';
import { OrderTypeTabs } from './OrderTypeTabs';
import { ContractsSpinner } from './ContractsSpinner';
import { BracketSummary } from './BracketSummary';
import { BuySellButtons } from './BuySellButtons';
import { BlacklistBanner } from './BlacklistBanner';
import { PositionDisplay } from './PositionDisplay';

const BracketSettingsModal = lazy(() => import('./BracketSettingsModal').then(m => ({ default: m.BracketSettingsModal })));

/**
 * Infer open positions from open orders + recent trades.
 * If protective orders (SL/TP) exist for a contract but no position is in the
 * store, we derive the position from the stop loss order (direction, size) and
 * recent opening trades (entry price).
 */
async function inferPositionsFromOrders(accountId: string, orders: Order[]) {
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

  // Use session trades if already loaded; otherwise fetch them (race with App.tsx)
  let trades = useStore.getState().sessionTrades;
  if (trades.length === 0) {
    try {
      trades = await tradeService.searchTrades(accountId, getCmeSessionStart());
      if (trades.length > 0) useStore.getState().setSessionTrades(trades);
    } catch {
      // trades fetch failed — can't infer
    }
  }
  if (trades.length === 0) return;

  for (const contractId of needsInference) {
    const group = contracts.get(contractId)!;
    const slOrder = group.slOrder!;

    // Derive direction: SL sell → position is long, SL buy → position is short
    const isLong = slOrder.side === OrderSide.Sell;
    const posType = isLong ? PositionType.Long : PositionType.Short;
    const posSize = slOrder.size;
    const entrySide = isLong ? OrderSide.Buy : OrderSide.Sell;

    // Find opening trades for this contract+side, sorted newest-first.
    // Only use the most recent fills that sum up to the position size — earlier
    // trades from previous round trips in the same session must be excluded.
    const openingTrades = trades
      .filter(
        (t) => String(t.contractId) === String(contractId)
          && t.side === entrySide
          && !t.voided
          && t.profitAndLoss === null, // opening half-turns only
      )
      .sort((a, b) => new Date(b.creationTimestamp).getTime() - new Date(a.creationTimestamp).getTime());

    if (openingTrades.length === 0) continue;

    // Take newest trades until we've accumulated the position size
    let totalSize = 0;
    let weightedPrice = 0;
    for (const t of openingTrades) {
      const remaining = posSize - totalSize;
      if (remaining <= 0) break;
      const used = Math.min(t.size, remaining);
      weightedPrice += t.price * used;
      totalSize += used;
    }

    if (totalSize === 0) continue;

    const avgPrice = weightedPrice / totalSize;

    const syntheticPos: import('../../adapters/types').RealtimePosition = {
      id: `synth-${Date.now()}`, // synthetic ID
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

type SavedBracketInfo = NonNullable<ReturnType<typeof useStore.getState>['pendingBracketInfo']>;
type AccountSnapshot = {
  bracketInfo: SavedBracketInfo;
  suspendedOrders: ReturnType<typeof useStore.getState>['openOrders'];
};

/** Fetch open orders + positions and merge into store. */
function hydratePositionsAndOrders(
  accountId: string,
  savedSnapshot?: AccountSnapshot,
) {
  // Try REST position endpoint first (may not exist on all gateways)
  positionService.searchOpenPositions(accountId).then((positions) => {
    // Replace all positions for this account — removes stale ones closed while offline
    useStore.getState().setOpenPositions(positions, accountId);
  }).catch((err) => {
    console.error('[OrderPanel] Position REST fetch failed:', err instanceof Error ? err.message : err);
  });

  // Fetch orders, then infer positions if needed
  orderService.searchOpenOrders(accountId).then(async (orders) => {
    const st = useStore.getState();
    st.setOpenOrders(orders);

    // searchOpenOrders never returns Suspended bracket legs — they only arrive via WebSocket.
    // When switching back to an account with an active bracket session, re-inject them from
    // the saved snapshot so the chart shows the correct SL/TP lines immediately.
    if (savedSnapshot) {
      const bi = savedSnapshot.bracketInfo;
      st.setPendingBracketInfo(bi);
      let tpIdx = 0;
      for (const o of savedSnapshot.suspendedOrders) {
        // Use bracketInfo prices — suspendedOrders may have pre-drag prices if the user
        // dragged via preview lines (Buy/Sell flow) which updates bracketInfo but not openOrders.
        const isSl = o.customTag?.endsWith('-SL')
          ?? (o.type === OrderType.Stop || o.type === OrderType.TrailingStop);
        const enriched = isSl
          ? { ...o, stopPrice: bi.slPrice ?? o.stopPrice }
          : { ...o, limitPrice: bi.tpPrices[tpIdx++] ?? o.limitPrice };
        st.upsertOrder(enriched);
      }
      debugLog.log('snapshot:restore', {
        bracketInfo: bi,
        suspended: savedSnapshot.suspendedOrders.map(o => ({ id: o.id, limitPrice: o.limitPrice, stopPrice: o.stopPrice })),
        storeAfter: useStore.getState().openOrders
          .filter(o => o.status === OrderStatus.Suspended)
          .map(o => ({ id: o.id, limitPrice: o.limitPrice, stopPrice: o.stopPrice })),
      });
    }

    // If no positions loaded yet, infer from orders + trades
    const hasAnyPosition = useStore.getState().positions.some(
      (p) => p.accountId === accountId && p.size > 0,
    );
    if (!hasAnyPosition && orders.length > 0) {
      await inferPositionsFromOrders(accountId, orders);
    }
  }).catch((err) => {
    console.warn('[OrderPanel] Order REST fetch failed:', err instanceof Error ? err.message : err);
  });
}

export function OrderPanel({ side = 'left' }: { side?: 'left' | 'right' }) {
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

  const subscribedAccountRef = useRef<string | null>(null);
  const bracketRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bracketCorrectionIds = useRef<Set<string>>(new Set());
  // Saves bracket state per account so it can be restored on switch-back
  const savedSnapshotRef = useRef<Map<string, AccountSnapshot>>(new Map());

  // Reset subscription guard when connection state changes (disconnect → reconnect)
  const connected = useStore((s) => s.connected);
  useEffect(() => {
    if (!connected) subscribedAccountRef.current = null;
  }, [connected]);

  // Subscribe to user hub events (orders, positions) when account changes
  // Also fetch current positions + orders via REST (SignalR may not send a snapshot)
  useEffect(() => {
    if (!connected || activeAccountId == null) return;
    if (subscribedAccountRef.current === activeAccountId) return;

    const prevAccountId = subscribedAccountRef.current;
    subscribedAccountRef.current = activeAccountId;

    const st = useStore.getState();

    // Save bracket state (info + Suspended orders) for the account we're leaving
    if (prevAccountId && st.pendingBracketInfo) {
      const suspendedOrders = st.openOrders.filter((o) => o.status === OrderStatus.Suspended);
      savedSnapshotRef.current.set(prevAccountId, {
        bracketInfo: st.pendingBracketInfo,
        suspendedOrders,
      });
      debugLog.log('snapshot:save', {
        account: prevAccountId,
        bracketInfo: st.pendingBracketInfo,
        suspended: suspendedOrders.map(o => ({ id: o.id, limitPrice: o.limitPrice, stopPrice: o.stopPrice })),
      });
    }

    // Clear stale data from previous account
    st.setOpenOrders([]);
    st.setPendingBracketInfo(null);
    useStore.setState({
      previewEnabled: false, previewHideEntry: false,
      draftSlPoints: null, draftTpPoints: [],
      adHocSlPoints: null, adHocTpLevels: [],
    });

    realtimeService.subscribeUserEvents(activeAccountId);

    // Hydrate positions + orders, restoring snapshot if switching back to this account
    hydratePositionsAndOrders(activeAccountId, savedSnapshotRef.current.get(activeAccountId));
  }, [connected, activeAccountId]);

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
      // Gateway sometimes strips customTag from Working events — fall back to stored value.
      const storedOrder = useStore.getState().openOrders.find((o) => o.id === order.id);
      const effectiveCustomTag = order.customTag ?? storedOrder?.customTag ?? null;

      // When a non-bracket order becomes Working, schedule a REST refresh to load any
      // orders placed externally that we haven't received via SignalR yet.
      // Skip bracket legs — they don't appear in searchOpenOrders while Suspended.
      if (order.status === OrderStatus.Working && !effectiveCustomTag && !useStore.getState().previewHideEntry) {
        const acctId = useStore.getState().activeAccountId;
        if (acctId) {
          if (bracketRefreshTimerRef.current) clearTimeout(bracketRefreshTimerRef.current);
          bracketRefreshTimerRef.current = setTimeout(() => {
            orderService.searchOpenOrders(acctId).then((orders) => {
              const st = useStore.getState();
              for (const o of orders) {
                // Skip Suspended bracket legs if their session was already cleared
                // (e.g. user cancelled the entry before this refresh fired)
                if (o.status === OrderStatus.Suspended && !st.pendingBracketInfo) continue;
                st.upsertOrder(o);
              }
            }).catch((err) => {
              console.error('[OrderPanel] Order refresh failed:', err instanceof Error ? err.message : err);
            });
          }, 1500);
        }
      }

      // When a bracket leg transitions from Suspended to Working (entry just filled),
      // the gateway always activates it at the original bracket tick offset — ignoring any
      // modifyOrder calls we made while it was Suspended. Correct the price now by
      // modifying the Working order to the user's desired price from pendingBracketInfo.
      // Note: gateway may strip customTag on Working events — effectiveCustomTag covers that.
      if (order.status === OrderStatus.Working && effectiveCustomTag) {
        const st = useStore.getState();
        const bi = st.pendingBracketInfo;
        const acctId = st.activeAccountId;
        if (bi && acctId) {
          if (effectiveCustomTag.endsWith('-SL') && order.stopPrice != null && bi.slPrice != null
              && Math.abs(bi.slPrice - order.stopPrice) > 0.001) {
            orderService.modifyOrder({ accountId: acctId, orderId: order.id, stopPrice: bi.slPrice }).catch((err) => {
              console.error('[OrderPanel] SL bracket correction failed:', err instanceof Error ? err.message : err);
            });
            upsertOrder({
              id: order.id, contractId: order.contractId, type: order.type,
              side: order.side, size: order.size, status: order.status,
              stopPrice: bi.slPrice, customTag: effectiveCustomTag,
            });
            return;
          }
          if (effectiveCustomTag.endsWith('-TP') && order.limitPrice != null && bi.tpPrices[0] != null
              && Math.abs(bi.tpPrices[0] - order.limitPrice) > 0.001) {
            orderService.modifyOrder({ accountId: acctId, orderId: order.id, limitPrice: bi.tpPrices[0] }).catch((err) => {
              console.error('[OrderPanel] TP bracket correction failed:', err instanceof Error ? err.message : err);
            });
            upsertOrder({
              id: order.id, contractId: order.contractId, type: order.type,
              side: order.side, size: order.size, status: order.status,
              limitPrice: bi.tpPrices[0], customTag: effectiveCustomTag,
            });
            return;
          }
        }
      }

      // On entry fill: correct bracket legs to user-adjusted prices if drafts differ
      // from the preset. On cancel: just clean up.
      if (order.status === OrderStatus.Filled || order.status === OrderStatus.Cancelled) {
        const st = useStore.getState();
        if (st.pendingEntryOrderId && order.id === st.pendingEntryOrderId) {
          const bi = st.pendingBracketInfo; // capture before clearing — needed for condition path
          st.setPendingEntryOrderId(null);
          st.setPendingBracketInfo(null);

          if (order.status === OrderStatus.Filled && st.previewHideEntry) {
            const fillPrice = order.filledPrice ?? st.limitPrice ?? 0;
            const acctId = st.activeAccountId;
            const contract = st.orderContract;

            if (bi?.fromCondition) {
              // Condition-triggered brackets: prices live in bi (custom arming positions).
              // resolvePreviewConfig() has no draft state for these, so use bi directly.
              const side = bi.side;
              const oppSide = side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;

              if (contract && fillPrice && acctId) {
                const correctionIds: string[] = [];

                const slOrder = bi.slPrice != null
                  ? st.openOrders.find((o) =>
                      String(o.contractId) === String(order.contractId)
                      && o.side === oppSide
                      && (o.type === OrderType.Stop || o.type === OrderType.TrailingStop))
                  : undefined;
                if (slOrder && bi.slPrice != null) {
                  correctionIds.push(slOrder.id);
                  bracketCorrectionIds.current.add(slOrder.id);
                  st.upsertOrder({ ...slOrder, stopPrice: bi.slPrice });
                }

                const tpOrders = st.openOrders.filter((o) =>
                  String(o.contractId) === String(order.contractId)
                  && o.side === oppSide
                  && o.type === OrderType.Limit);
                const desiredTps: { order: typeof tpOrders[0]; price: number }[] = [];
                bi.tpPrices.forEach((tpPrice, i) => {
                  const tpOrder = tpOrders[i];
                  if (tpOrder) {
                    correctionIds.push(tpOrder.id);
                    bracketCorrectionIds.current.add(tpOrder.id);
                    st.upsertOrder({ ...tpOrder, limitPrice: tpPrice });
                    desiredTps.push({ order: tpOrder, price: tpPrice });
                  }
                });

                // Delay modifyOrder: gateway recalculates bracket prices on fill.
                setTimeout(() => {
                  const st2 = useStore.getState();
                  if (!acctId) return;

                  if (bi.slPrice != null) {
                    const slOrder2 = st2.openOrders.find((o) =>
                      String(o.contractId) === String(order.contractId)
                      && o.side === oppSide
                      && (o.type === OrderType.Stop || o.type === OrderType.TrailingStop));
                    if (slOrder2) {
                      orderService.modifyOrder({ accountId: acctId, orderId: slOrder2.id, stopPrice: bi.slPrice }).catch((err) => {
                        console.error('[OrderPanel] Post-fill SL correction failed:', err instanceof Error ? err.message : err);
                      });
                    }
                  }

                  desiredTps.forEach(({ order: tpOrder, price }) => {
                    orderService.modifyOrder({ accountId: acctId, orderId: tpOrder.id, limitPrice: price }).catch((err) => {
                      console.error('[OrderPanel] Post-fill TP correction failed:', err instanceof Error ? err.message : err);
                    });
                  });

                  setTimeout(() => {
                    for (const id of correctionIds) bracketCorrectionIds.current.delete(id);
                  }, 2000);

                  useStore.setState({ previewEnabled: false, previewHideEntry: false, draftSlPoints: null, draftTpPoints: [] });
                }, 500);
              } else {
                useStore.setState({ previewEnabled: false, previewHideEntry: false, draftSlPoints: null, draftTpPoints: [] });
              }
            } else {
              // Normal bracket order: prices come from preset + draft adjustments.
              // resolvePreviewConfig merges draftSlPoints/draftTpPoints with preset.
              const cfg = resolvePreviewConfig();
              const side = st.previewSide;

              if (cfg && contract && fillPrice) {
                const oppSide = side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;
                const toP = (pts: number) => pointsToPrice(pts, contract);

                // Optimistically upsert corrected prices immediately (visual)
                // and track IDs to suppress gateway events during the correction window.
                const correctionIds: string[] = [];

                if (cfg.stopLoss.points > 0) {
                  const desiredSl = side === OrderSide.Buy
                    ? fillPrice - toP(cfg.stopLoss.points)
                    : fillPrice + toP(cfg.stopLoss.points);
                  const slOrder = st.openOrders.find((o) =>
                    String(o.contractId) === String(order.contractId)
                    && o.side === oppSide
                    && (o.type === OrderType.Stop || o.type === OrderType.TrailingStop));
                  if (slOrder) {
                    correctionIds.push(slOrder.id);
                    bracketCorrectionIds.current.add(slOrder.id);
                    st.upsertOrder({ ...slOrder, stopPrice: desiredSl });
                  }
                }

                const tpOrders = st.openOrders.filter((o) =>
                  String(o.contractId) === String(order.contractId)
                  && o.side === oppSide
                  && o.type === OrderType.Limit);
                const desiredTps: { order: typeof tpOrders[0]; price: number }[] = [];
                cfg.takeProfits.forEach((tp, i) => {
                  const desiredTp = side === OrderSide.Buy
                    ? fillPrice + toP(tp.points)
                    : fillPrice - toP(tp.points);
                  const tpOrder = tpOrders[i];
                  if (tpOrder) {
                    correctionIds.push(tpOrder.id);
                    bracketCorrectionIds.current.add(tpOrder.id);
                    st.upsertOrder({ ...tpOrder, limitPrice: desiredTp });
                    desiredTps.push({ order: tpOrder, price: desiredTp });
                  }
                });

                // Delay modifyOrder: gateway recalculates bracket prices on fill
                // using original tick offsets — wait for that to settle.
                setTimeout(() => {
                  const st2 = useStore.getState();
                  if (!acctId) return;

                  if (cfg.stopLoss.points > 0) {
                    const desiredSl = side === OrderSide.Buy
                      ? fillPrice - toP(cfg.stopLoss.points)
                      : fillPrice + toP(cfg.stopLoss.points);
                    const slOrder = st2.openOrders.find((o) =>
                      String(o.contractId) === String(order.contractId)
                      && o.side === oppSide
                      && (o.type === OrderType.Stop || o.type === OrderType.TrailingStop));
                    if (slOrder) {
                      orderService.modifyOrder({ accountId: acctId, orderId: slOrder.id, stopPrice: desiredSl }).catch((err) => {
                        console.error('[OrderPanel] Post-fill SL correction failed:', err instanceof Error ? err.message : err);
                      });
                    }
                  }

                  desiredTps.forEach(({ order: tpOrder, price }) => {
                    orderService.modifyOrder({ accountId: acctId, orderId: tpOrder.id, limitPrice: price }).catch((err) => {
                      console.error('[OrderPanel] Post-fill TP correction failed:', err instanceof Error ? err.message : err);
                    });
                  });

                  // Clear suppression after gateway has had time to confirm
                  setTimeout(() => {
                    for (const id of correctionIds) bracketCorrectionIds.current.delete(id);
                  }, 2000);

                  useStore.setState({ previewEnabled: false, previewHideEntry: false, draftSlPoints: null, draftTpPoints: [] });
                }, 500);
              } else {
                useStore.setState({ previewEnabled: false, previewHideEntry: false, draftSlPoints: null, draftTpPoints: [] });
              }
            }
          }
        }
      }

      // Forward to bracket engine first (may need to place manual TPs or evaluate conditions)
      bracketEngine.onOrderEvent(order).catch((err) => {
        showToast('error', 'Bracket engine error', errorMessage(err));
      });

      // status 2=filled or cancelled-type statuses → remove from open orders
      if (order.status === OrderStatus.Filled || order.status === OrderStatus.Cancelled || order.status === OrderStatus.Rejected || order.status === OrderStatus.Expired) {
        // Play fill sounds
        if (order.status === OrderStatus.Filled) {
          if (consumeManualClose(order.contractId)) {
            // Manual close (Close button / chart X) — always plays regardless of bracket state
            audioService.play('position_closed');
          } else if (!bracketEngine.hasActiveSession() && !bracketEngine.wasHandled(order.id)) {
            // Ad-hoc orders (bracket engine handles its own sounds)
            // Fall back to order type when customTag is absent (e.g. bracket-placed SL after page refresh)
            const isSl = order.customTag?.endsWith('-SL') ??
              (order.type === OrderType.Stop || order.type === OrderType.TrailingStop);
            // A Limit fill with no customTag is a TP only if a position exists AND the order is on
            // the opposite side (i.e. it closes/reduces the position). A same-side limit fill means
            // the user is adding to the position — that's an entry, not a TP.
            const isTp = order.customTag?.endsWith('-TP') ?? (
              order.type === OrderType.Limit &&
              useStore.getState().positions.some(
                (p) =>
                  String(p.contractId) === String(order.contractId) &&
                  p.size > 0 &&
                  ((p.type === PositionType.Long  && order.side === OrderSide.Sell) ||
                   (p.type === PositionType.Short && order.side === OrderSide.Buy)),
              )
            );
            if (isSl) {
              audioService.play('stop_filled');
            } else if (isTp) {
              audioService.play('target_filled');
            } else {
              audioService.play('order_filled');
            }
          }
        }
        removeOrder(order.id);

        // If a pending limit entry was cancelled, clean up preview & ad-hoc brackets
        if (order.status !== OrderStatus.Filled) {
          const st = useStore.getState();
          if (st.previewHideEntry && st.orderContract
              && String(order.contractId) === String(st.orderContract.id)) {
            bracketEngine.clearSession();
            useStore.setState({
              previewEnabled: false, previewHideEntry: false,
              draftSlPoints: null, draftTpPoints: [],
              adHocSlPoints: null, adHocTpLevels: [],
            });
          }
        }

      } else {
        // Suppress gateway updates for orders being corrected post-fill
        if (bracketCorrectionIds.current.has(order.id)) return;

        // Gateway recomputes Suspended bracket prices after modifyOrder/fill and sends
        // its own value. Keep the store's price as the source of truth instead:
        //   - New order (not yet in store): use pendingBracketInfo price if it's the
        //     current bracket's leg, otherwise accept the gateway price.
        //   - Existing order: always keep the store's current price (user's dragged
        //     value or previously overridden value) — never let the gateway override it.
        const bi = useStore.getState().pendingBracketInfo;
        let effectiveLimitPrice = order.limitPrice;
        let effectiveStopPrice = order.stopPrice;
        if (order.status === OrderStatus.Suspended && effectiveCustomTag) {
          const existing = useStore.getState().openOrders.find((o) => o.id === order.id);
          if (effectiveCustomTag.endsWith('-TP')) {
            const existingPrice = existing?.limitPrice;
            if (existingPrice != null) {
              // Order exists — preserve whichever price is already in the store.
              effectiveLimitPrice = existingPrice;
            } else if (bi?.tpPrices[0] != null) {
              // New order — use current bracket's TP price.
              effectiveLimitPrice = bi.tpPrices[0];
            }
          } else if (effectiveCustomTag.endsWith('-SL')) {
            const existingPrice = existing?.stopPrice;
            if (existingPrice != null) {
              effectiveStopPrice = existingPrice;
            } else if (bi?.slPrice != null) {
              effectiveStopPrice = bi.slPrice;
            }
          }
        }

        upsertOrder({
          id: order.id,
          contractId: order.contractId,
          type: order.type,
          side: order.side,
          size: order.size,
          limitPrice: effectiveLimitPrice,
          stopPrice: effectiveStopPrice,
          status: order.status,
          customTag: effectiveCustomTag,
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

  // Seed lastPrice from latest bar so UP&L shows immediately (before first quote tick).
  // Skip if the chart already has the same contract loaded — the quote subscription will
  // fill lastPrice almost immediately, making this extra bars fetch redundant.
  const chartContract = useStore((s) => s.contract);
  useEffect(() => {
    if (!connected || !orderContract) return;
    // Chart will subscribe to quotes for the same contract, so lastPrice will be set by the
    // quote handler before the user notices. Only fetch bars when contracts differ.
    if (chartContract && chartContract.id === orderContract.id) return;
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
    }).catch((err) => {
      console.error('[OrderPanel] Last price seed failed:', err instanceof Error ? err.message : err);
    });
  }, [connected, orderContract, chartContract, setLastPrice]);

  // Update lastPrice from quote stream for P&L calculation (RAF-throttled)
  useEffect(() => {
    if (!orderContract) return;
    let pendingPrice: number | null = null;
    let rafId = 0;
    const handler = (contractId: string, data: GatewayQuote) => {
      if (contractId !== orderContract.id) return;
      pendingPrice = data.lastPrice;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          if (pendingPrice != null) setLastPrice(pendingPrice);
        });
      }
    };
    realtimeService.onQuote(handler);
    return () => {
      cancelAnimationFrame(rafId);
      realtimeService.offQuote(handler);
    };
  }, [orderContract, setLastPrice]);

  return (
    <div
      className={`flex flex-col bg-(--color-panel) ${side === 'left' ? 'border-r' : 'border-l'} border-(--color-border) overflow-y-auto`}
      style={{ width: 240, minWidth: 240, padding: 12 }}
    >
      <div className="flex flex-col" style={{ gap: 20 }}>
        {/* Instrument */}
        <div className="relative">
          <div className="flex items-center mb-1">
            <button
              onClick={() => {
                const store = useStore.getState();
                store.setOrderPanelSide(store.orderPanelSide === 'left' ? 'right' : 'left');
              }}
              className="text-(--color-text-muted) hover:text-(--color-text) transition-colors cursor-pointer"
              title={`Move panel to ${side === 'left' ? 'right' : 'left'}`}
              style={{ padding: 2 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16L3 12l4-4" />
                <path d="M17 8l4 4-4 4" />
                <line x1="3" y1="12" x2="21" y2="12" />
              </svg>
            </button>
            <div className={`flex-1 ${SECTION_LABEL} text-center`}>Instrument</div>
          </div>
          <div className="absolute" style={{ top: -2, right: -4 }}>
            <LinkChartButton linked={orderLinkedToChart} onToggle={setOrderLinkedToChart} />
          </div>
          <div className="bg-(--color-input) rounded" style={{ marginTop: 6 }}>
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

        {/* Blacklist warning */}
        <BlacklistBanner />

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
      className="transition-colors cursor-pointer"
      style={{ padding: '0 2px' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke={isActiveForSelected ? 'var(--color-warning)' : 'var(--color-text-muted)'}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ transition: 'stroke var(--transition-normal) ease' }}
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
  );
}

function PreviewToggle() {
  const { previewEnabled, togglePreview, previewSide, setPreviewSide } = useStore(useShallow((s) => ({
    previewEnabled: s.previewEnabled,
    togglePreview: s.togglePreview,
    previewSide: s.previewSide,
    setPreviewSide: s.setPreviewSide,
  })));

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={previewEnabled}
          onChange={togglePreview}
          className="accent-(--color-accent) w-3.5 h-3.5"
        />
        <span className="text-xs text-(--color-text-muted)">Preview</span>
      </label>
      {previewEnabled && (
        <div className="flex rounded overflow-hidden" style={{ height: 20 }}>
          <button
            onClick={() => setPreviewSide(OrderSide.Buy)}
            className="text-[10px] font-medium transition-colors cursor-pointer"
            style={{
              padding: '0 6px',
              background: previewSide === OrderSide.Buy ? 'var(--color-buy)' : 'var(--color-input)',
              color: previewSide === OrderSide.Buy ? 'var(--color-text-bright)' : 'var(--color-text-muted)',
            }}
          >
            Long
          </button>
          <button
            onClick={() => setPreviewSide(OrderSide.Sell)}
            className="text-[10px] font-medium transition-colors cursor-pointer"
            style={{
              padding: '0 6px',
              background: previewSide === OrderSide.Sell ? 'var(--color-sell)' : 'var(--color-input)',
              color: previewSide === OrderSide.Sell ? 'var(--color-text-bright)' : 'var(--color-text-muted)',
            }}
          >
            Short
          </button>
        </div>
      )}
    </div>
  );
}
