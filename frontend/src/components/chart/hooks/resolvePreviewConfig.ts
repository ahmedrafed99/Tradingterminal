import { useStore } from '../../../store/useStore';
import type { BracketConfig } from '../../../types/bracket';

/**
 * Trim TPs to fit within orderSize. First TPs get priority.
 * Returns only TPs that receive at least 1 contract.
 */
export function fitTpsToOrderSize<T extends { size: number }>(
  tps: T[],
  orderSize: number,
): T[] {
  if (tps.length === 0 || orderSize <= 0) return [];
  const totalTpSize = tps.reduce((sum, tp) => sum + tp.size, 0);
  if (totalTpSize <= orderSize) return tps;

  const result: T[] = [];
  let remaining = orderSize;
  for (const tp of tps) {
    if (remaining <= 0) break;
    const alloc = Math.min(tp.size, remaining);
    result.push({ ...tp, size: alloc });
    remaining -= alloc;
  }
  return result;
}

/**
 * Compute a unified BracketConfig from either preset+drafts or ad-hoc state.
 * TPs are trimmed to fit within orderSize — extra TPs that exceed the order
 * quantity are dropped so previews match what will actually be placed.
 * Reads imperatively from useStore.getState() — safe to call from any context.
 */
export function resolvePreviewConfig(): BracketConfig | null {
  const st = useStore.getState();
  const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);

  let config: BracketConfig | null = null;

  if (activePreset) {
    const bc = activePreset.config;
    config = {
      ...bc,
      stopLoss: { ...bc.stopLoss, points: st.draftSlPoints ?? bc.stopLoss.points },
      takeProfits: bc.takeProfits.map((tp, i) => ({
        ...tp,
        points: st.draftTpPoints[i] ?? tp.points,
      })),
    };
  } else if (st.adHocSlPoints != null || st.adHocTpLevels.length > 0) {
    config = {
      stopLoss: { points: st.adHocSlPoints ?? 0, type: 'Stop' as const },
      takeProfits: st.adHocTpLevels.map((tp, i) => ({
        id: `adhoc-tp-${i}`,
        points: tp.points,
        size: tp.size,
      })),
      conditions: [],
    };
  }

  if (config) {
    config = { ...config, takeProfits: fitTpsToOrderSize(config.takeProfits, st.orderSize) };
  }

  return config;
}
