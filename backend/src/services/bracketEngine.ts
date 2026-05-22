/**
 * Backend bracket engine — event-driven multi-TP bracket management.
 *
 * Listens to realtimeService order events for fill detection.
 * Places SL and multiple TPs as separate orders after entry fills.
 * Manages SL size reduction on TP fills and evaluates tpFilled conditions.
 *
 * Usage:
 *   const entryOrderPlacedAt = new Date().toISOString();
 *   const { orderId } = await adapter.orders.place({ ... });
 *   bracketEngine.trackEntry({ sessionId: orderId, entryOrderId: orderId,
 *     entryOrderPlacedAt, entrySide, entrySize, config, contract, callbacks });
 */

import { getAdapter } from '../adapters/registry';
import { realtimeService, type RealtimeOrder } from './realtimeService';
import { OrderType, OrderSide } from '../types/enums';
import type {
  TrackEntryParams, BracketConfig, BracketContract,
  BracketCondition, ConditionAction, BracketSessionCallbacks,
  SessionEndReason, TakeProfitLevel,
} from '../types/bracket';
import { ticksToPrice, roundToTick } from '../utils/instrument';
import { retryAsync } from '../utils/retry';
import { debugLog } from '../utils/debugLog';

// ---------------------------------------------------------------------------
// OrderStatus values (mirrors frontend/src/types/enums.ts)
// ---------------------------------------------------------------------------

const OrderStatus = {
  Working:   1,
  Filled:    2,
  Cancelled: 3,
  Rejected:  4,
  Pending:   5,
  Suspended: 8,
} as const;

// ---------------------------------------------------------------------------
// Internal session types
// ---------------------------------------------------------------------------

interface NormalizedTP {
  id: string;
  ticks: number;
  size: number;
}

type SessionPhase = 'awaitingFill' | 'monitoring';

interface ActiveSession {
  sessionId: string;
  accountId: string;
  contractId: string;
  entrySide: OrderSide;
  entryPrice: number;          // set after fill detected
  entrySize: number;
  config: BracketConfig;
  contract: BracketContract;
  normalizedTPs: NormalizedTP[];
  entryOrderId: string;
  entryOrderPlacedAt: string;
  phase: SessionPhase;
  entryWaitDeadline: number;   // Date.now() + maxEntryWaitMs
  callbacks: BracketSessionCallbacks;

  // Order tracking
  slOrderId:  string | null;
  tpOrderIds: Map<number, string>;   // tpIndex → orderId
  filledTPs:  Set<number>;
  firedConditions: Set<string>;      // condition.id — prevents re-firing
  pendingActions: ConditionAction[]; // queued until slOrderId is known
}

// ---------------------------------------------------------------------------
// BracketEngine class
// ---------------------------------------------------------------------------

class BracketEngine {
  private sessions = new Map<string, ActiveSession>();
  private orderHandler: ((order: RealtimeOrder, action: number) => void) | null = null;

  // ── Public API ─────────────────────────────────────────────────────────────

  trackEntry(params: TrackEntryParams): string {
    const {
      sessionId, accountId, contractId, entryOrderId, entryOrderPlacedAt,
      entrySide, entrySize, config, contract,
      callbacks = {},
      maxEntryWaitMs = 90_000,
    } = params;

    // Cancel any existing session with this ID
    if (this.sessions.has(sessionId)) {
      this.cancelSession(sessionId).catch(() => {});
    }

    const rawTps = [...config.takeProfits].sort((a, b) => a.ticks - b.ticks);
    const normalizedTPs = this._normalizeTpSizes(rawTps, entrySize);

    const session: ActiveSession = {
      sessionId,
      accountId,
      contractId,
      entrySide,
      entryPrice: 0,
      entrySize,
      config,
      contract,
      normalizedTPs,
      entryOrderId,
      entryOrderPlacedAt,
      phase: 'awaitingFill',
      entryWaitDeadline: Date.now() + maxEntryWaitMs,
      callbacks,
      slOrderId: null,
      tpOrderIds: new Map(),
      filledTPs: new Set(),
      firedConditions: new Set(),
      pendingActions: [],
    };

    this.sessions.set(sessionId, session);
    this._ensureListening();

    // Entry timeout guard
    setTimeout(() => {
      const s = this.sessions.get(sessionId);
      if (s && s.phase === 'awaitingFill') {
        debugLog.log('bracketEngine:entryTimeout', { sessionId });
        this._endSession(s, 'entryTimeout');
      }
    }, maxEntryWaitMs);

    debugLog.log('bracketEngine:trackEntry', {
      sessionId, contractId, entryOrderId, entrySize,
      tpCount: normalizedTPs.length,
      slTicks: config.stopLoss.ticks,
    });

    return sessionId;
  }

  async cancelSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this._removeSession(sessionId);
    await this._cancelAllOrders(session);
    session.callbacks.onSessionEnd?.(sessionId, 'cancelled');
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  async shutdown(): Promise<void> {
    this._stopListening();
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map((id) => this.cancelSession(id)));
  }

  // ── SignalR event listener ─────────────────────────────────────────────────

  private _ensureListening(): void {
    if (this.orderHandler) return;
    this.orderHandler = (order, _action) => { void this._onOrderEvent(order); };
    realtimeService.on('order', this.orderHandler);
  }

  private _stopListening(): void {
    if (this.orderHandler) {
      realtimeService.off('order', this.orderHandler);
      this.orderHandler = null;
    }
  }

  // ── Core order event handler ───────────────────────────────────────────────

  private async _onOrderEvent(order: RealtimeOrder): Promise<void> {
    for (const session of this.sessions.values()) {
      if (String(order.contractId) !== String(session.contractId)) continue;

      if (session.phase === 'awaitingFill') {
        if (String(order.id) === String(session.entryOrderId)
          && order.status === OrderStatus.Filled) {
          const fillPrice = order.filledPrice ?? 0;
          session.entryPrice = fillPrice;
          session.phase = 'monitoring';
          session.callbacks.onEntryFilled?.(session.sessionId, fillPrice);
          debugLog.log('bracketEngine:entryFilled', { sessionId: session.sessionId, fillPrice });
          await this._placeBracketsAfterFill(session);
        }
        continue;
      }

      if (session.phase === 'monitoring') {
        if (order.status !== OrderStatus.Filled) continue;
        const orderId = String(order.id);

        // SL fill?
        if (session.slOrderId !== null && orderId === session.slOrderId) {
          const fillPrice = order.filledPrice ?? 0;
          debugLog.log('bracketEngine:slFilled', { sessionId: session.sessionId, fillPrice });
          session.callbacks.onSlFilled?.(session.sessionId, fillPrice);
          this._removeSession(session.sessionId);
          await this._cancelRemainingTPs(session);
          session.callbacks.onSessionEnd?.(session.sessionId, 'slFilled');
          return;
        }

        // TP fill?
        for (const [tpIdx, tpOrderId] of session.tpOrderIds) {
          if (orderId !== tpOrderId) continue;
          if (session.filledTPs.has(tpIdx)) break;

          session.filledTPs.add(tpIdx);
          const filledSize = session.normalizedTPs[tpIdx]?.size ?? 0;
          const filledTotal = this._sumFilledSizes(session);
          const remaining = session.entrySize - filledTotal;
          const fillPrice = order.filledPrice ?? 0;

          debugLog.log('bracketEngine:tpFilled', {
            sessionId: session.sessionId, tpIdx, fillPrice, filledSize, remaining,
          });
          session.callbacks.onTpFilled?.(session.sessionId, tpIdx, fillPrice, filledSize, remaining);

          // Resize SL to match remaining position
          if (session.slOrderId !== null && remaining > 0) {
            const slId = session.slOrderId;
            retryAsync(
              () => getAdapter().orders.modify({ accountId: session.accountId, orderId: slId, size: remaining }) as Promise<unknown>,
              {
                maxAttempts: 2, baseDelay: 300,
                onExhausted: (err) => {
                  debugLog.log('bracketEngine:slResizeFailed', { sessionId: session.sessionId, remaining, error: String(err) });
                },
              },
            ).catch(() => {});
          }

          // Evaluate tpFilled conditions
          for (const condition of session.config.conditions) {
            if (condition.trigger.kind === 'tpFilled'
              && condition.trigger.tpIndex === tpIdx
              && !session.firedConditions.has(condition.id)) {
              session.firedConditions.add(condition.id);
              await this._executeAction(session, condition.action);
            }
            if (condition.trigger.kind === 'profitReached') {
              debugLog.log('bracketEngine:profitReachedSkipped', { sessionId: session.sessionId, conditionId: condition.id });
            }
          }

          // All TPs filled?
          if (session.filledTPs.size >= session.normalizedTPs.length) {
            debugLog.log('bracketEngine:allTpsFilled', { sessionId: session.sessionId });
            this._removeSession(session.sessionId);
            session.callbacks.onSessionEnd?.(session.sessionId, 'allTpsFilled');
          }
          break;
        }
      }
    }
  }

  // ── Post-fill bracket placement ────────────────────────────────────────────

  private async _placeBracketsAfterFill(session: ActiveSession): Promise<void> {
    const {
      accountId, contractId, entrySide, entryPrice, entrySize,
      config, contract, normalizedTPs,
    } = session;

    const oppositeSide = entrySide === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;

    // Warn if TP sizes were normalized
    const origTotal = config.takeProfits.reduce((s, t) => s + t.size, 0);
    const normTotal = normalizedTPs.reduce((s, t) => s + t.size, 0);
    if (origTotal > 0 && origTotal !== normTotal) {
      debugLog.log('bracketEngine:tpSizesNormalized', {
        sessionId: session.sessionId, origTotal, normTotal, entrySize,
      });
    }

    // ── Place SL ─────────────────────────────────────────────────────────────
    if (config.stopLoss.ticks >= 1) {
      const slOffset   = ticksToPrice(config.stopLoss.ticks, contract);
      const isTrailing = config.stopLoss.type === 'TrailingStop';

      const stopPrice = !isTrailing
        ? roundToTick(
            entrySide === OrderSide.Buy
              ? entryPrice - slOffset
              : entryPrice + slOffset,
            contract.tickSize,
          )
        : undefined;

      const slType = isTrailing ? OrderType.TrailingStop : OrderType.Stop;

      try {
        const result = await retryAsync(
          () => getAdapter().orders.place({
            accountId,
            contractId,
            type:      slType,
            side:      oppositeSide,
            size:      entrySize,
            ...(isTrailing ? { trailPrice: config.stopLoss.ticks } : { stopPrice }),
          }) as Promise<{ orderId?: string | number }>,
          {
            maxAttempts: 3, baseDelay: 500,
            onRetry: (_err, attempt) => {
              debugLog.log('bracketEngine:slRetry', { sessionId: session.sessionId, attempt });
            },
            onExhausted: (err) => {
              debugLog.log('bracketEngine:slFailed', { sessionId: session.sessionId, error: String(err) });
              session.callbacks.onSlPlacementFailed?.(session.sessionId, err);
            },
          },
        );

        const orderId = result.orderId != null ? String(result.orderId) : null;
        session.slOrderId = orderId;
        debugLog.log('bracketEngine:slPlaced', { sessionId: session.sessionId, orderId, isTrailing, stopPrice });
        this._flushPendingActions(session);
      } catch {
        // onExhausted already called; session continues without SL tracking
      }
    }

    // ── Place TPs concurrently ────────────────────────────────────────────────
    const tpPlacements = normalizedTPs.map((tp, i) => {
      const tpOffset   = ticksToPrice(tp.ticks, contract);
      const limitPrice = roundToTick(
        entrySide === OrderSide.Buy
          ? entryPrice + tpOffset
          : entryPrice - tpOffset,
        contract.tickSize,
      );

      return retryAsync(
        () => getAdapter().orders.place({
          accountId,
          contractId,
          type: OrderType.Limit,
          side: oppositeSide,
          size: tp.size,
          limitPrice,
        }) as Promise<{ orderId?: string | number }>,
        {
          maxAttempts: 2, baseDelay: 300,
          onExhausted: (err) => {
            debugLog.log('bracketEngine:tpFailed', { sessionId: session.sessionId, tpIndex: i, error: String(err) });
          },
        },
      ).then((result: { orderId?: string | number }) => {
        const orderId = result.orderId != null ? String(result.orderId) : null;
        if (orderId) session.tpOrderIds.set(i, orderId);
        debugLog.log('bracketEngine:tpPlaced', { sessionId: session.sessionId, tpIndex: i, orderId, limitPrice });
      }).catch(() => {
        // onExhausted already logged
      });
    });

    await Promise.allSettled(tpPlacements);
  }

  // ── Condition actions ──────────────────────────────────────────────────────

  private async _executeAction(session: ActiveSession, action: ConditionAction): Promise<void> {
    const { accountId, entryPrice, entrySide, contract, slOrderId, config } = session;

    // If SL not yet placed, defer action
    if (slOrderId === null && action.kind !== 'cancelRemainingTPs') {
      session.pendingActions.push(action);
      return;
    }

    try {
      switch (action.kind) {
        case 'moveSLToBreakeven': {
          await getAdapter().orders.modify({
            accountId, orderId: slOrderId!,
            stopPrice: roundToTick(entryPrice, contract.tickSize),
          });
          break;
        }
        case 'moveSLToTP': {
          const targetTp = config.takeProfits[action.tpIndex];
          if (!targetTp) break;
          const offset   = ticksToPrice(targetTp.ticks, contract);
          const newStop  = roundToTick(
            entrySide === OrderSide.Buy ? entryPrice + offset : entryPrice - offset,
            contract.tickSize,
          );
          await getAdapter().orders.modify({ accountId, orderId: slOrderId!, stopPrice: newStop });
          break;
        }
        case 'moveSLToPrice':
        case 'customOffset': {
          const offset  = ticksToPrice(action.ticks, contract);
          const newStop = roundToTick(
            entrySide === OrderSide.Buy ? entryPrice + offset : entryPrice - offset,
            contract.tickSize,
          );
          await getAdapter().orders.modify({ accountId, orderId: slOrderId!, stopPrice: newStop });
          break;
        }
        case 'cancelRemainingTPs': {
          await this._cancelRemainingTPs(session);
          break;
        }
      }
      debugLog.log('bracketEngine:actionExecuted', { sessionId: session.sessionId, kind: action.kind });
    } catch (err) {
      debugLog.log('bracketEngine:actionFailed', { sessionId: session.sessionId, kind: action.kind, error: String(err) });
    }
  }

  private _flushPendingActions(session: ActiveSession): void {
    const actions = [...session.pendingActions];
    session.pendingActions = [];
    for (const action of actions) {
      this._executeAction(session, action).catch(() => {});
    }
  }

  // ── Session cleanup ────────────────────────────────────────────────────────

  private _removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    if (this.sessions.size === 0) this._stopListening();
  }

  private _endSession(session: ActiveSession, reason: SessionEndReason): void {
    this._removeSession(session.sessionId);
    session.callbacks.onSessionEnd?.(session.sessionId, reason);
  }

  private async _cancelRemainingTPs(session: ActiveSession): Promise<void> {
    const { accountId, tpOrderIds, filledTPs } = session;
    const cancels: Promise<void>[] = [];
    for (const [tpIdx, orderId] of tpOrderIds) {
      if (filledTPs.has(tpIdx)) continue;
      cancels.push(
        (getAdapter().orders.cancel({ accountId, orderId }) as Promise<unknown>)
          .then(() => {})
          .catch((err: unknown) => {
            debugLog.log('bracketEngine:cancelTPFailed', { sessionId: session.sessionId, tpIdx, error: String(err) });
          }),
      );
    }
    await Promise.allSettled(cancels);
  }

  private async _cancelAllOrders(session: ActiveSession): Promise<void> {
    const { accountId, slOrderId, tpOrderIds, filledTPs } = session;
    const cancels: Promise<void>[] = [];

    if (slOrderId !== null) {
      cancels.push(
        (getAdapter().orders.cancel({ accountId, orderId: slOrderId }) as Promise<unknown>)
          .then(() => {})
          .catch((err: unknown) => {
            debugLog.log('bracketEngine:cancelSLFailed', { sessionId: session.sessionId, error: String(err) });
          }),
      );
    }

    for (const [tpIdx, orderId] of tpOrderIds) {
      if (filledTPs.has(tpIdx)) continue;
      cancels.push(
        (getAdapter().orders.cancel({ accountId, orderId }) as Promise<unknown>)
          .then(() => {})
          .catch((err: unknown) => {
            debugLog.log('bracketEngine:cancelTPFailed', { sessionId: session.sessionId, tpIdx, error: String(err) });
          }),
      );
    }

    await Promise.allSettled(cancels);
  }

  // ── TP size normalization (exact port from frontend) ───────────────────────

  private _normalizeTpSizes(
    tps: TakeProfitLevel[],
    entrySize: number,
  ): NormalizedTP[] {
    if (tps.length === 0) return [];

    const totalTpSize = tps.reduce((s, tp) => s + tp.size, 0);

    if (totalTpSize === entrySize) {
      return tps.map((tp) => ({ ...tp }));
    }

    if (totalTpSize === 0) {
      const perTp = Math.floor(entrySize / tps.length);
      let remainder = entrySize - perTp * tps.length;
      return tps.map((tp) => ({ ...tp, size: perTp + (remainder-- > 0 ? 1 : 0) }));
    }

    const scaled = tps.map((tp) => ({
      ...tp,
      size: Math.max(1, Math.floor(tp.size * (entrySize / totalTpSize))),
    }));

    const scaledTotal = scaled.reduce((s, tp) => s + tp.size, 0);
    const diff = entrySize - scaledTotal;
    if (diff !== 0) {
      scaled[scaled.length - 1].size = Math.max(1, scaled[scaled.length - 1].size + diff);
    }

    return scaled;
  }

  private _sumFilledSizes(session: ActiveSession): number {
    let total = 0;
    for (const tpIdx of session.filledTPs) {
      total += session.normalizedTPs[tpIdx]?.size ?? 0;
    }
    return total;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const bracketEngine = new BracketEngine();
