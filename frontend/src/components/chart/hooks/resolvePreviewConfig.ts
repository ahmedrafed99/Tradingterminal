import { useStore } from '../../../store/useStore';
import type { BracketConfig } from '../../../types/bracket';

/**
 * Compute a unified BracketConfig from either preset+drafts or ad-hoc state.
 * Reads imperatively from useStore.getState() — safe to call from any context.
 */
export function resolvePreviewConfig(): BracketConfig | null {
  const st = useStore.getState();
  const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);

  if (activePreset) {
    const bc = activePreset.config;
    return {
      ...bc,
      stopLoss: { ...bc.stopLoss, points: st.draftSlPoints ?? bc.stopLoss.points },
      takeProfits: bc.takeProfits.map((tp, i) => ({
        ...tp,
        points: st.draftTpPoints[i] ?? tp.points,
      })),
    };
  }

  if (st.adHocSlPoints != null || st.adHocTpLevels.length > 0) {
    return {
      stopLoss: { points: st.adHocSlPoints ?? 0, type: 'Stop' as const },
      takeProfits: st.adHocTpLevels.map((tp, i) => ({
        id: `adhoc-tp-${i}`,
        points: tp.points,
        size: tp.size,
      })),
      conditions: [],
    };
  }

  return null;
}
