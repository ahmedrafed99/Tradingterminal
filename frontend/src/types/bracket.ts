// ---------------------------------------------------------------------------
// Stop Loss
// ---------------------------------------------------------------------------
export type StopLossType = 'Stop' | 'TrailingStop';

export interface StopLossConfig {
  points: number;
  type: StopLossType;
}

// ---------------------------------------------------------------------------
// Take Profit
// ---------------------------------------------------------------------------
export interface TakeProfitLevel {
  id: string;
  points: number;
  size: number; // number of contracts (whole numbers)
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------
export type ConditionTrigger = { kind: 'tpFilled'; tpIndex: number }; // 0-based

export type ConditionAction =
  | { kind: 'moveSLToBreakeven' }
  | { kind: 'moveSLToPrice'; points: number }
  | { kind: 'moveSLToTP'; tpIndex: number }
  | { kind: 'cancelRemainingTPs' }
  | { kind: 'customOffset'; points: number };

export interface Condition {
  id: string;
  trigger: ConditionTrigger;
  action: ConditionAction;
}

// ---------------------------------------------------------------------------
// Full config
// ---------------------------------------------------------------------------
export interface BracketConfig {
  stopLoss: StopLossConfig;
  takeProfits: TakeProfitLevel[];
  conditions: Condition[];
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
export interface BracketPreset {
  id: string;
  name: string;
  config: BracketConfig;
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
import { OrderType, OrderSide } from './enums';

export const DEFAULT_BRACKET_CONFIG: BracketConfig = {
  stopLoss: { points: 0, type: 'Stop' },
  takeProfits: [],
  conditions: [],
};

export const MAX_TP_LEVELS = 8;

// TODO Phase 4: derive from instrument metadata instead of a global constant
export const TICKS_PER_POINT = 4;

export function slTypeToApiType(type: StopLossType): OrderType.Stop | OrderType.TrailingStop {
  return type === 'Stop' ? OrderType.Stop : OrderType.TrailingStop;
}

/**
 * Build gateway-native bracket params when the config has <= 1 TP.
 * Returns null when 2+ TPs (must use client-side bracket engine).
 *
 * Gateway expects signed ticks (price direction relative to entry):
 *   Long  → SL ticks negative (below entry), TP ticks positive (above entry)
 *   Short → SL ticks positive (above entry), TP ticks negative (below entry)
 */
export function buildNativeBracketParams(
  config: BracketConfig,
  side: OrderSide,
): { stopLossBracket?: { ticks: number; type: number }; takeProfitBracket?: { ticks: number; type: number } } | null {
  if (config.takeProfits.length > 1) return null;

  const isBuy = side === OrderSide.Buy;
  const result: { stopLossBracket?: { ticks: number; type: number }; takeProfitBracket?: { ticks: number; type: number } } = {};

  if (config.stopLoss.points >= 1) {
    result.stopLossBracket = {
      ticks: config.stopLoss.points * TICKS_PER_POINT * (isBuy ? -1 : 1),
      type: slTypeToApiType(config.stopLoss.type),
    };
  }

  if (config.takeProfits.length === 1 && config.takeProfits[0].points >= 1) {
    result.takeProfitBracket = {
      ticks: config.takeProfits[0].points * TICKS_PER_POINT * (isBuy ? 1 : -1),
      type: OrderType.Limit,
    };
  }

  if (!result.stopLossBracket && !result.takeProfitBracket) return null;

  return result;
}
