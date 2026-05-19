import { useEffect, useReducer, useRef } from 'react';
import { useStore } from '../store/useStore';
import { realtimeService } from '../services/realtimeService';
import { marketDataService, type Contract } from '../services/marketDataService';
import type { GatewayQuote } from '../services/realtimeService';
import { calcPnl } from '../utils/instrument';
import { PositionType } from '../types/enums';

/**
 * Aggregates unrealized P&L across every open position on the active account.
 *
 * Subscribes to quote streams for each position's contract and caches contract
 * metadata. Contracts with no quote yet contribute 0. The adapter refcounts
 * quote subscriptions per contract, so the chart switching symbols no longer
 * kills the streams this hook depends on.
 */
export function useAccountUpnl(): number {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const contractsRef = useRef<Map<string, Contract>>(new Map());
  const pricesRef = useRef<Map<string, number>>(new Map());
  const subscribedRef = useRef<Set<string>>(new Set());

  const positions = useStore((s) => s.positions);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const connected = useStore((s) => s.connected);

  // Ensure subscriptions + contract metadata for every active-account position
  useEffect(() => {
    if (!connected || activeAccountId == null) return;

    const st = useStore.getState();
    // Seed cache with any contracts already loaded in the store
    if (st.orderContract) contractsRef.current.set(st.orderContract.id, st.orderContract);
    if (st.contract) contractsRef.current.set(st.contract.id, st.contract);
    if (st.secondContract) contractsRef.current.set(st.secondContract.id, st.secondContract);

    const activeIds = new Set<string>();
    for (const p of positions) {
      if (p.accountId === activeAccountId && p.size !== 0) activeIds.add(String(p.contractId));
    }

    for (const cid of activeIds) {
      if (!subscribedRef.current.has(cid)) {
        realtimeService.subscribeQuotes(cid);
        subscribedRef.current.add(cid);
      }
      if (!contractsRef.current.has(cid)) {
        // contractId format for futures: CON.F.US.<SYMBOL>.<MONTH>
        const symbol = cid.split('.')[3];
        if (symbol) {
          marketDataService.searchContracts(symbol).then((contracts) => {
            const match = contracts.find((c) => c.id === cid);
            if (match) {
              contractsRef.current.set(cid, match);
              forceUpdate();
            }
          }).catch(() => { /* non-fatal — contract just stays missing, contributes 0 */ });
        }
      }
    }
  }, [positions, activeAccountId, connected]);

  // Listen for quote updates on any contract we care about (rAF-throttled)
  useEffect(() => {
    if (!connected) return;
    let rafId = 0;
    let dirty = false;
    const handler = (contractId: string, q: GatewayQuote) => {
      if (!subscribedRef.current.has(contractId)) return;
      if (q.lastPrice == null) return;
      pricesRef.current.set(contractId, q.lastPrice);
      dirty = true;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          if (dirty) { dirty = false; forceUpdate(); }
        });
      }
    };
    realtimeService.onQuote(handler);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      realtimeService.offQuote(handler);
    };
  }, [connected]);

  // Always favor the live store lastPrice for the order contract (it's already
  // wired up by OrderPanel and may have a fresh value before our subscription
  // delivers its first tick).
  const orderContract = useStore((s) => s.orderContract);
  const storeLastPrice = useStore((s) => s.lastPrice);

  let total = 0;
  for (const p of positions) {
    if (p.accountId !== activeAccountId || p.size === 0) continue;
    const cid = String(p.contractId);
    const contract = contractsRef.current.get(cid);
    if (!contract) continue;
    const price = (orderContract && cid === orderContract.id && storeLastPrice != null)
      ? storeLastPrice
      : pricesRef.current.get(cid);
    if (price == null) continue;
    const isLong = p.type === PositionType.Long;
    const diff = isLong ? price - p.averagePrice : p.averagePrice - price;
    total += calcPnl(diff, contract, p.size);
  }
  return total;
}
