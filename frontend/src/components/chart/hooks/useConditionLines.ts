import { useRef } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { resolveConditionServerUrl } from '../../../store/slices/conditionsSlice';
import type { PriceLevelLine } from '../PriceLevelLine';
import type { ChartRefs } from './types';
import type { ArmedDragState, PreviewState, PreviewDragState } from './conditionLineTypes';
import { useArmedConditionLines } from './useArmedConditionLines';
import { useArmedConditionDrag } from './useArmedConditionDrag';
import { useConditionPreview } from './useConditionPreview';
import { useConditionPreviewDrag } from './useConditionPreviewDrag';
import { useConditionLinesSync } from './useConditionLinesSync';

/**
 * Renders armed conditions as dashed lines on the chart,
 * AND manages the "Preview" mode for quick condition creation.
 *
 * Orchestrator — owns all shared refs and delegates to 5 sub-hooks:
 *  1. useArmedConditionLines — armed condition line lifecycle
 *  2. useArmedConditionDrag — armed condition drag handling
 *  3. useConditionPreview — preview creation/destruction + interaction
 *  4. useConditionPreviewDrag — preview drag handling
 *  5. useConditionLinesSync — position sync on scroll/zoom/resize
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
  const linesRef = useRef<PriceLevelLine[]>([]);
  const condIdsRef = useRef<string[]>([]);
  const dragRef = useRef<ArmedDragState | null>(null);

  // Preview refs
  const previewRef = useRef<PreviewState | null>(null);
  const previewDragRef = useRef<PreviewDragState | null>(null);

  useArmedConditionLines(refs, contract, conditions, conditionServerUrl, linesRef, condIdsRef, dragRef);
  useArmedConditionDrag(refs, contract, linesRef, dragRef);
  useConditionPreview(refs, contract, timeframe, conditionPreview, conditionServerUrl, previewRef, previewDragRef);
  useConditionPreviewDrag(refs, contract, timeframe, previewRef, previewDragRef);
  useConditionLinesSync(refs, linesRef, previewRef);
}
