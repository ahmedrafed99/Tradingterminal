import { useRef } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { resolveConditionServerUrl } from '../../../store/slices/conditionsSlice';
import type { PriceLevelPrimitive } from '../primitives/PriceLevelPrimitive';
import type { ChartRefs } from './types';
import type { ArmedDragState, PreviewState } from './conditionLineTypes';
import { useArmedConditionLines } from './useArmedConditionLines';
import { useConditionPreview } from './useConditionPreview';

/**
 * Orchestrator for condition lines on the chart:
 *  1. useArmedConditionLines — creates/destroys canvas primitives for armed conditions
 *  2. useConditionPreview   — creates/destroys preview primitives for quick-arm flow
 *
 * All drag and sync is handled inside the primitives (no separate drag/sync hooks).
 */
export function useConditionLines(
  refs: ChartRefs,
  contract: Contract | null,
  timeframe: Timeframe,
): void {
  const conditions = useStore((s) => s.conditions);
  const conditionServerUrl = useStore((s) => resolveConditionServerUrl(s.conditionServerUrl));
  const conditionPreview = useStore((s) => s.conditionPreview);

  // Armed condition refs
  const linesRef = useRef<PriceLevelPrimitive[]>([]);
  const condIdsRef = useRef<string[]>([]);
  const dragRef = useRef<ArmedDragState | null>(null);

  // Preview ref (drag state now lives inside the primitives)
  const previewRef = useRef<PreviewState | null>(null);

  useArmedConditionLines(refs, contract, conditions, conditionServerUrl, linesRef, condIdsRef, dragRef);
  useConditionPreview(refs, contract, timeframe, conditionPreview, conditionServerUrl, previewRef);
}
