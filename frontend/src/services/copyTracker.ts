/**
 * Copy Tracker — mirrors order actions from a master account to follower accounts.
 *
 * Intercepts orderService.placeOrder/cancelOrder/modifyOrder calls.
 * Since the bracket engine uses these same functions for SL/TP,
 * all bracket actions are automatically replicated.
 */

import api from './api';
import type { PlaceOrderParams, ModifyOrderParams } from './orderService';
import { useStore } from '../store/useStore';
import { showToast, errorMessage } from '../utils/toast';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let enabled = false;
let masterAccountId: string | null = null;
let followerIds: string[] = [];

// masterOrderId → Map<followerAccountId, followerOrderId>
const orderMap = new Map<string, Map<string, string>>();

// All order IDs placed on follower accounts — prevents infinite replication loops
const followerPlacedIds = new Set<string>();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function configure(config: {
  enabled: boolean;
  masterAccountId: string | null;
  followerIds: string[];
}): void {
  enabled = config.enabled;
  masterAccountId = config.masterAccountId;
  followerIds = config.followerIds;

  if (!enabled) {
    orderMap.clear();
    followerPlacedIds.clear();
  }
}

export function isEnabled(): boolean {
  return enabled && masterAccountId !== null && followerIds.length > 0;
}

export function getConfig() {
  return { enabled, masterAccountId, followerIds };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMasterAccount(accountId: string | undefined | null): boolean {
  return !!accountId && accountId === masterAccountId;
}

function getAccountName(accountId: string): string {
  const acct = useStore.getState().accounts.find((a) => a.id === accountId);
  return acct?.name ?? accountId;
}

// ---------------------------------------------------------------------------
// Intercept: Place Order
// ---------------------------------------------------------------------------

export function onPlaceOrder(
  accountId: string | undefined | null,
  params: PlaceOrderParams,
  masterOrderId: string,
): void {
  if (!isEnabled()) return;
  if (!isMasterAccount(accountId)) return;
  // Don't re-replicate follower orders
  if (followerPlacedIds.has(masterOrderId)) return;

  for (const followerId of followerIds) {
    const followerParams = { ...params, accountId: followerId };
    // Fire-and-forget
    api.post<{ orderId?: number | string; success?: boolean; errorMessage?: string }>('/orders/place', followerParams)
      .then((res) => {
        if (res.data.orderId) {
          const fOrderId = String(res.data.orderId);
          followerPlacedIds.add(fOrderId);

          if (!orderMap.has(masterOrderId)) orderMap.set(masterOrderId, new Map());
          orderMap.get(masterOrderId)!.set(followerId, fOrderId);
        }
      })
      .catch((err) => {
        showToast('warning', `Copy failed — ${getAccountName(followerId)}`, errorMessage(err));
      });
  }
}

// ---------------------------------------------------------------------------
// Intercept: Cancel Order
// ---------------------------------------------------------------------------

export function onCancelOrder(
  accountId: string | undefined | null,
  orderId: string,
): void {
  if (!isEnabled()) return;
  if (!isMasterAccount(accountId)) return;
  if (followerPlacedIds.has(orderId)) return;

  const mapping = orderMap.get(orderId);
  if (!mapping) return;

  for (const [followerId, followerOrderId] of mapping) {
    api.post('/orders/cancel', { accountId: followerId, orderId: followerOrderId })
      .catch((err) => {
        showToast('warning', `Copy cancel failed — ${getAccountName(followerId)}`, errorMessage(err));
      });
    followerPlacedIds.delete(followerOrderId);
  }

  orderMap.delete(orderId);
}

// ---------------------------------------------------------------------------
// Intercept: Modify Order
// ---------------------------------------------------------------------------

export function onModifyOrder(
  accountId: string | undefined | null,
  orderId: string,
  params: ModifyOrderParams,
): void {
  if (!isEnabled()) return;
  if (!isMasterAccount(accountId)) return;
  if (followerPlacedIds.has(orderId)) return;

  const mapping = orderMap.get(orderId);
  if (!mapping) return;

  for (const [followerId, followerOrderId] of mapping) {
    const followerParams: ModifyOrderParams = {
      ...params,
      accountId: followerId,
      orderId: followerOrderId,
    };
    api.patch('/orders/modify', followerParams)
      .catch((err) => {
        showToast('warning', `Copy modify failed — ${getAccountName(followerId)}`, errorMessage(err));
      });
  }
}

// ---------------------------------------------------------------------------
// Auto-sync config from Zustand store
// ---------------------------------------------------------------------------

// Initialize from persisted state
{
  const s = useStore.getState();
  configure({ enabled: s.copyEnabled, masterAccountId: s.copyMasterAccountId, followerIds: s.copyFollowerIds });
}

// Keep in sync on changes
useStore.subscribe((s) => {
  const needsUpdate =
    s.copyEnabled !== enabled ||
    s.copyMasterAccountId !== masterAccountId ||
    s.copyFollowerIds !== followerIds;
  if (needsUpdate) {
    configure({ enabled: s.copyEnabled, masterAccountId: s.copyMasterAccountId, followerIds: s.copyFollowerIds });
  }
});
