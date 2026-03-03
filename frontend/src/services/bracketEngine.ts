import { orderService } from './orderService';
import type { RealtimeOrder } from './realtimeService';
import type { BracketConfig, ConditionAction } from '../types/bracket';
import { TICKS_PER_POINT } from '../types/bracket';
import { OrderType, OrderSide, OrderStatus } from '../types/enums';
import { showToast, errorMessage } from '../utils/toast';
import { retryAsync } from '../utils/retry';

const DEV = import.meta.env.DEV;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingEntryConfig {
  accountId: number;
  contractId: string;
  entrySide: OrderSide;
  entrySize: number;
  config: BracketConfig;
  tickSize: number;
}

interface NormalizedTP {
  id: string;
  points: number;
  size: number;
}

interface ActiveSession {
  accountId: number;
  contractId: string;
  entrySide: OrderSide;
  entryPrice: number;
  entrySize: number;
  config: BracketConfig;
  tickSize: number;
  /** Normalized TP sizes that were actually used for placement */
  normalizedTPs: NormalizedTP[];

  slOrderId: number | null;
  tpOrderIds: Map<number, number>; // tpIndex → orderId
  filledTPs: Set<number>;
  pendingActions: ConditionAction[];
}

/** Convert points to price offset: points * tickSize * TICKS_PER_POINT */
function pointsToPrice(points: number, tickSize: number): number {
  return points * tickSize * TICKS_PER_POINT;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

class BracketEngine {
  // Phase 1: armed before order is placed (no orderId yet)
  private armedConfig: PendingEntryConfig | null = null;
  // Phase 2: orderId confirmed, waiting for fill
  private confirmedOrderId: number | null = null;
  // Buffer: fill events received between arm and confirm
  private bufferedFills: RealtimeOrder[] = [];

  private session: ActiveSession | null = null;

  /**
   * Step 1: Call BEFORE placing the entry order.
   * Arms the engine to watch for fills on this contract/account.
   */
  armForEntry(config: PendingEntryConfig) {
    this.session = null;
    this.armedConfig = config;
    this.confirmedOrderId = null;
    this.bufferedFills = [];
    if (DEV) console.log('[BracketEngine] Armed for entry', config.contractId);
  }

  /**
   * Step 2: Call AFTER placeOrder returns with the orderId.
   * Checks buffered fills in case the fill arrived before this call.
   */
  confirmEntryOrderId(orderId: number) {
    if (!this.armedConfig) return;
    this.confirmedOrderId = orderId;
    if (DEV) console.log('[BracketEngine] Confirmed orderId', orderId);

    // Check if we already buffered a fill for this order
    const fill = this.bufferedFills.find(
      (o) => o.id === orderId && o.status === OrderStatus.Filled,
    );
    if (fill) {
      if (DEV) console.log('[BracketEngine] Found buffered fill, processing now');
      const cfg = this.armedConfig;
      this.armedConfig = null;
      this.confirmedOrderId = null;
      this.bufferedFills = [];
      this.onEntryFilled(cfg, fill.filledPrice ?? 0).catch((err) => {
        showToast('error', 'Bracket placement error after fill', errorMessage(err));
      });
    }
  }

  /** Update the armed bracket config (e.g. remove a TP or SL before entry fills) */
  updateArmedConfig(updater: (config: BracketConfig) => BracketConfig) {
    if (!this.armedConfig) return;
    this.armedConfig = {
      ...this.armedConfig,
      config: updater(this.armedConfig.config),
    };
  }

  /** Clear everything (position closed, manual reset, etc.).
   *  Returns the set of order IDs being cancelled so callers can avoid double-cancelling. */
  clearSession(): Set<number> {
    // Cancel any remaining SL + TP orders on the exchange before clearing
    const snapshot = this.session;
    this.armedConfig = null;
    this.confirmedOrderId = null;
    this.bufferedFills = [];
    this.session = null; // Null out first so concurrent calls don't double-cancel

    const handledIds = new Set<number>();
    if (snapshot) {
      if (snapshot.slOrderId !== null) handledIds.add(snapshot.slOrderId);
      for (const [tpIdx, orderId] of snapshot.tpOrderIds) {
        if (!snapshot.filledTPs.has(tpIdx)) handledIds.add(orderId);
      }
      this.cancelSessionOrders(snapshot).catch((err) => {
        showToast('warning', 'Failed to cancel some bracket orders',
          'Check open orders and cancel manually if needed.');
      });
    }
    return handledIds;
  }

  hasActiveSession(): boolean {
    return this.session !== null || this.armedConfig !== null;
  }

  /** Move the SL to breakeven (entry price). Returns true if successful. */
  async moveSLToBreakeven(): Promise<boolean> {
    if (!this.session || this.session.slOrderId === null) return false;
    try {
      await orderService.modifyOrder({
        accountId: this.session.accountId,
        orderId: this.session.slOrderId,
        stopPrice: this.session.entryPrice,
      });
      return true;
    } catch (err) {
      showToast('error', 'Failed to move SL to breakeven', errorMessage(err));
      return false;
    }
  }

  /**
   * Called on every SignalR order event.
   */
  async onOrderEvent(order: RealtimeOrder): Promise<void> {
    // Debug: log every order event when engine is active
    if (DEV && (this.armedConfig || this.session)) {
      console.log('[BracketEngine] onOrderEvent:', {
        orderId: order.id,
        status: order.status,
        filledPrice: order.filledPrice,
        type: order.type,
        side: order.side,
        armed: !!this.armedConfig,
        confirmedId: this.confirmedOrderId,
        hasSession: !!this.session,
      });
    }

    // --- Armed but orderId not yet confirmed: buffer fills ---
    if (this.armedConfig && this.confirmedOrderId === null) {
      if (order.status === OrderStatus.Filled) {
        this.bufferedFills.push(order);
        if (DEV) console.log('[BracketEngine] Buffered fill event, orderId:', order.id);
      }
      return;
    }

    // --- Armed with confirmed orderId: check for entry fill ---
    if (this.armedConfig && this.confirmedOrderId !== null) {
      if (order.id === this.confirmedOrderId && order.status === OrderStatus.Filled) {
        if (DEV) console.log('[BracketEngine] Entry filled! price:', order.filledPrice);
        const cfg = this.armedConfig;
        this.armedConfig = null;
        this.confirmedOrderId = null;
        this.bufferedFills = [];
        await this.onEntryFilled(cfg, order.filledPrice ?? 0);
        return;
      }
    }

    // --- Active session ---
    if (!this.session) return;
    if (order.contractId !== this.session.contractId) return;
    if (order.status !== OrderStatus.Filled) return;

    // Check if SL was filled → cancel all remaining TPs
    if (this.session.slOrderId !== null && order.id === this.session.slOrderId) {
      if (DEV) console.log('[BracketEngine] SL filled! Cancelling remaining TPs...');
      const snapshot = this.session;
      this.session = null; // Clear immediately so clearSession() won't double-cancel
      await this.cancelSessionTPs(snapshot);
      return;
    }

    // Check for TP fills
    let filledTpIndex: number | null = null;

    for (const [tpIdx, orderId] of this.session.tpOrderIds) {
      if (order.id === orderId) {
        filledTpIndex = tpIdx;
        break;
      }
    }

    if (filledTpIndex === null) return;
    if (this.session.filledTPs.has(filledTpIndex)) return;

    if (DEV) console.log(`[BracketEngine] TP${filledTpIndex + 1} filled`);
    this.session.filledTPs.add(filledTpIndex);

    // Reduce SL size to match remaining position
    if (this.session.slOrderId !== null) {
      const filledTpSize = this.getFilledTPSize();
      const remainingSize = this.session.entrySize - filledTpSize;
      if (remainingSize > 0) {
        if (DEV) console.log(`[BracketEngine] Modifying SL size: ${this.session.entrySize} → ${remainingSize}`);
        const slOrderId = this.session.slOrderId;
        const accountId = this.session.accountId;
        try {
          await retryAsync(
            () => orderService.modifyOrder({ accountId, orderId: slOrderId, size: remainingSize }),
            {
              maxAttempts: 2,
              baseDelay: 300,
              onExhausted: (err) => {
                showToast('warning', 'SL size sync failed',
                  `SL may not match position size (expected ${remainingSize}). ${errorMessage(err)}`);
              },
            },
          );
        } catch {
          // Toast already shown by onExhausted
        }
      }
    }

    // Evaluate conditions
    for (const condition of this.session.config.conditions) {
      if (
        condition.trigger.kind === 'tpFilled' &&
        condition.trigger.tpIndex === filledTpIndex
      ) {
        await this.executeAction(condition.action);
      }
    }

    // If all TPs filled, clear session
    if (this.session.filledTPs.size >= this.session.config.takeProfits.length) {
      this.session = null;
    }
  }

  /** Sum of TP sizes that have already filled (uses normalized sizes) */
  private getFilledTPSize(): number {
    if (!this.session) return 0;
    const tps = this.session.normalizedTPs;
    let total = 0;
    for (const tpIdx of this.session.filledTPs) {
      const tp = tps[tpIdx];
      if (tp) total += tp.size;
    }
    return total;
  }

  // ── TP Normalization ────────────────────────────────────────────────────

  /**
   * Normalize TP sizes so they sum exactly to entrySize.
   * Pro-rata scaling with minimum 1 per TP, last TP gets remainder.
   */
  private normalizeTpSizes(
    tps: { id: string; points: number; size: number }[],
    entrySize: number,
  ): NormalizedTP[] {
    if (tps.length === 0) return [];

    const totalTpSize = tps.reduce((sum, tp) => sum + tp.size, 0);

    // Already correct
    if (totalTpSize === entrySize) {
      return tps.map((tp) => ({ ...tp }));
    }

    // All zeros — distribute evenly
    if (totalTpSize === 0) {
      const perTp = Math.floor(entrySize / tps.length);
      let remainder = entrySize - perTp * tps.length;
      return tps.map((tp) => ({
        ...tp,
        size: perTp + (remainder-- > 0 ? 1 : 0),
      }));
    }

    // Pro-rata scale
    const scaled = tps.map((tp) => ({
      ...tp,
      size: Math.max(1, Math.floor(tp.size * (entrySize / totalTpSize))),
    }));

    // Adjust last TP so total matches exactly
    const scaledTotal = scaled.reduce((sum, tp) => sum + tp.size, 0);
    const diff = entrySize - scaledTotal;
    if (diff !== 0) {
      scaled[scaled.length - 1].size = Math.max(1, scaled[scaled.length - 1].size + diff);
    }

    return scaled;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private async onEntryFilled(cfg: PendingEntryConfig, entryPrice: number) {
    const { config, accountId, contractId, entrySide, entrySize, tickSize } = cfg;

    // Normalize TP sizes upfront
    const rawTps = [...config.takeProfits].sort((a, b) => a.points - b.points);
    const normalizedTPs = this.normalizeTpSizes(rawTps, entrySize);

    const origTotal = rawTps.reduce((s, t) => s + t.size, 0);
    const normTotal = normalizedTPs.reduce((s, t) => s + t.size, 0);
    if (origTotal !== normTotal && normalizedTPs.length > 0) {
      if (DEV) console.log(`[BracketEngine] TP sizes normalized: ${origTotal} → ${normTotal} (entrySize=${entrySize})`);
      showToast('warning', 'TP sizes adjusted to match order size',
        `Total TP contracts (${origTotal}) normalized to entry size (${entrySize}).`);
    }

    this.session = {
      accountId,
      contractId,
      entrySide,
      entryPrice,
      entrySize,
      config,
      tickSize,
      normalizedTPs,
      slOrderId: null,
      tpOrderIds: new Map(),
      filledTPs: new Set(),
      pendingActions: [],
    };

    const oppositeSide = entrySide === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;

    // Place SL as a separate stop order (with retry)
    if (config.stopLoss.points >= 1) {
      const slOffset = pointsToPrice(config.stopLoss.points, tickSize);
      const stopPrice =
        entrySide === OrderSide.Buy
          ? entryPrice - slOffset // long: SL below entry
          : entryPrice + slOffset; // short: SL above entry

      const slType = config.stopLoss.type === 'Stop' ? OrderType.Stop : OrderType.TrailingStop;

      if (DEV) console.log(`[BracketEngine] Placing SL: side=${oppositeSide} stopPrice=${stopPrice} type=${slType}`);

      try {
        const { orderId } = await retryAsync(
          () => orderService.placeOrder({
            accountId,
            contractId,
            type: slType,
            side: oppositeSide,
            size: entrySize,
            stopPrice,
          }),
          {
            maxAttempts: 3,
            baseDelay: 500,
            onRetry: (err, attempt) => {
              showToast('warning', `Retrying SL placement (attempt ${attempt + 1})...`,
                errorMessage(err));
            },
            onExhausted: (err) => {
              showToast('error', 'CRITICAL: Stop Loss placement failed',
                'Position is UNPROTECTED. Place an SL manually immediately. ' + errorMessage(err),
                null); // no auto-dismiss — user must acknowledge
            },
          },
        );
        if (DEV) console.log('[BracketEngine] SL placed, orderId:', orderId);
        if (this.session) {
          this.session.slOrderId = orderId;
        }

        // Flush any pending actions
        if (this.session && this.session.pendingActions.length > 0) {
          const actions = [...this.session.pendingActions];
          this.session.pendingActions = [];
          for (const action of actions) {
            await this.executeAction(action);
          }
        }
      } catch {
        // Toast already shown by onExhausted
      }
    }

    // Place all TPs as separate limit orders (normalized sizes)
    for (let i = 0; i < normalizedTPs.length; i++) {
      const tp = normalizedTPs[i];
      const tpOffset = pointsToPrice(tp.points, tickSize);
      const limitPrice =
        entrySide === OrderSide.Buy
          ? entryPrice + tpOffset
          : entryPrice - tpOffset;

      if (DEV) console.log(`[BracketEngine] Placing TP${i + 1}: side=${oppositeSide} limitPrice=${limitPrice} size=${tp.size}`);

      try {
        const { orderId } = await retryAsync(
          () => orderService.placeOrder({
            accountId,
            contractId,
            type: OrderType.Limit,
            side: oppositeSide,
            size: tp.size,
            limitPrice,
          }),
          {
            maxAttempts: 2,
            baseDelay: 300,
            onExhausted: (err) => {
              showToast('error', `Take Profit ${i + 1} placement failed`,
                `${tp.size} contract(s) — ${errorMessage(err)}`);
            },
          },
        );
        if (DEV) console.log(`[BracketEngine] TP${i + 1} placed, orderId:`, orderId);
        this.session?.tpOrderIds.set(i, orderId);
      } catch {
        // Toast already shown by onExhausted
      }
    }
  }

  private async cancelSessionTPs(session: ActiveSession) {
    const { accountId, tpOrderIds, filledTPs } = session;
    for (const [tpIdx, orderId] of tpOrderIds) {
      if (!filledTPs.has(tpIdx)) {
        try {
          if (DEV) console.log(`[BracketEngine] Cancelling TP${tpIdx + 1} (orderId: ${orderId})`);
          await orderService.cancelOrder(accountId, orderId);
        } catch (err) {
          showToast('warning', `Failed to cancel TP${tpIdx + 1}`, errorMessage(err), 4000);
        }
      }
    }
  }

  private async cancelSessionOrders(session: ActiveSession) {
    const { accountId, slOrderId, tpOrderIds, filledTPs } = session;

    // Cancel SL
    if (slOrderId !== null) {
      try {
        if (DEV) console.log(`[BracketEngine] Cancelling SL (orderId: ${slOrderId})`);
        await orderService.cancelOrder(accountId, slOrderId);
      } catch (err) {
        showToast('warning', 'Failed to cancel Stop Loss order',
          'Check open orders manually. ' + errorMessage(err));
      }
    }

    // Cancel remaining TPs
    for (const [tpIdx, orderId] of tpOrderIds) {
      if (!filledTPs.has(tpIdx)) {
        try {
          if (DEV) console.log(`[BracketEngine] Cancelling TP${tpIdx + 1} (orderId: ${orderId})`);
          await orderService.cancelOrder(accountId, orderId);
        } catch (err) {
          showToast('warning', `Failed to cancel TP${tpIdx + 1}`, errorMessage(err), 4000);
        }
      }
    }
  }

  private async executeAction(action: ConditionAction) {
    if (!this.session) return;
    const { accountId, entryPrice, entrySide, tickSize, slOrderId, config } = this.session;

    if (slOrderId === null && action.kind !== 'cancelRemainingTPs') {
      this.session.pendingActions.push(action);
      return;
    }

    const actionLabels: Record<string, string> = {
      moveSLToBreakeven: 'Move SL to breakeven',
      moveSLToPrice: 'Move SL to price',
      moveSLToTP: 'Move SL to TP level',
      cancelRemainingTPs: 'Cancel remaining TPs',
      customOffset: 'Move SL (custom offset)',
    };

    try {
      switch (action.kind) {
        case 'moveSLToBreakeven': {
          await orderService.modifyOrder({
            accountId,
            orderId: slOrderId!,
            stopPrice: entryPrice,
          });
          break;
        }

        case 'moveSLToPrice': {
          const offset = pointsToPrice(action.points, tickSize);
          const newStop =
            entrySide === OrderSide.Buy ? entryPrice + offset : entryPrice - offset;
          await orderService.modifyOrder({
            accountId,
            orderId: slOrderId!,
            stopPrice: newStop,
          });
          break;
        }

        case 'moveSLToTP': {
          const targetTp = config.takeProfits[action.tpIndex];
          if (!targetTp) break;
          const tpOffset = pointsToPrice(targetTp.points, tickSize);
          const newStop =
            entrySide === OrderSide.Buy ? entryPrice + tpOffset : entryPrice - tpOffset;
          await orderService.modifyOrder({
            accountId,
            orderId: slOrderId!,
            stopPrice: newStop,
          });
          break;
        }

        case 'cancelRemainingTPs': {
          if (this.session) {
            await this.cancelSessionTPs(this.session);
          }
          break;
        }

        case 'customOffset': {
          const customOffset = pointsToPrice(action.points, tickSize);
          const newStop =
            entrySide === OrderSide.Buy ? entryPrice + customOffset : entryPrice - customOffset;
          await orderService.modifyOrder({
            accountId,
            orderId: slOrderId!,
            stopPrice: newStop,
          });
          break;
        }
      }
    } catch (err) {
      showToast('error', `Condition action failed: ${actionLabels[action.kind] ?? action.kind}`,
        errorMessage(err));
    }
  }
}

export const bracketEngine = new BracketEngine();
