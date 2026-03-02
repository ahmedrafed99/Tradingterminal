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
export const DEFAULT_BRACKET_CONFIG: BracketConfig = {
  stopLoss: { points: 0, type: 'Stop' },
  takeProfits: [],
  conditions: [],
};

export const MAX_TP_LEVELS = 8;

export const TICKS_PER_POINT = 4;

export function slTypeToApiType(type: StopLossType): 4 | 5 {
  return type === 'Stop' ? 4 : 5;
}
