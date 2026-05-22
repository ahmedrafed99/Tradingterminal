import { OrderSide } from './enums';

// ---------------------------------------------------------------------------
// Stop Loss
// ---------------------------------------------------------------------------

export interface StopLossConfig {
  /** Distance from entry in ticks. 0 = disabled (no SL placed). */
  ticks: number;
  /** Omit or 'Stop' for a fixed stop. 'TrailingStop' for a trailing stop. */
  type?: 'Stop' | 'TrailingStop';
}

// ---------------------------------------------------------------------------
// Take Profit
// ---------------------------------------------------------------------------

export interface TakeProfitLevel {
  id: string;
  /** Distance from entry in ticks. */
  ticks: number;
  /** Number of contracts allocated to this TP (whole numbers). */
  size: number;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type ConditionTrigger =
  | { kind: 'tpFilled'; tpIndex: number }       // 0-based
  | { kind: 'profitReached'; points: number };   // Phase 2 — skipped for now

export type ConditionAction =
  | { kind: 'moveSLToBreakeven' }
  | { kind: 'moveSLToTP'; tpIndex: number }
  | { kind: 'moveSLToPrice'; ticks: number }    // entry ± N ticks
  | { kind: 'customOffset'; ticks: number }
  | { kind: 'cancelRemainingTPs' };

export interface BracketCondition {
  id: string;
  trigger: ConditionTrigger;
  action: ConditionAction;
}

// ---------------------------------------------------------------------------
// Full bracket config
// ---------------------------------------------------------------------------

export interface BracketConfig {
  stopLoss: StopLossConfig;
  takeProfits: TakeProfitLevel[];
  conditions: BracketCondition[];
}

// ---------------------------------------------------------------------------
// Contract info required by the engine
// ---------------------------------------------------------------------------

export interface BracketContract {
  tickSize: number;
  tickValue: number;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export type SessionEndReason = 'entryTimeout' | 'cancelled' | 'allTpsFilled' | 'slFilled';

export interface BracketSessionCallbacks {
  onEntryFilled?:       (sessionId: string, fillPrice: number) => void;
  onTpFilled?:          (sessionId: string, tpIdx: number, fillPrice: number, filledSize: number, remainingSize: number) => void;
  onSlFilled?:          (sessionId: string, fillPrice: number) => void;
  onSlPlacementFailed?: (sessionId: string, error: unknown) => void;
  onSessionEnd?:        (sessionId: string, reason: SessionEndReason) => void;
}

export interface TrackEntryParams {
  /** Caller-assigned ID — typically the entry orderId. */
  sessionId: string;
  accountId: string;
  contractId: string;
  entryOrderId: string;
  /** ISO timestamp captured immediately before placing the entry order.
   *  Used as startTimestamp when querying trades to find fill price. */
  entryOrderPlacedAt: string;
  entrySide: OrderSide;
  entrySize: number;
  config: BracketConfig;
  contract: BracketContract;
  callbacks?: BracketSessionCallbacks;
  /** Max ms to wait for entry fill before timing out. Default: 90_000 */
  maxEntryWaitMs?: number;
}
