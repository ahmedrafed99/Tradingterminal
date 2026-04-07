import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';

export function SLTPInputs() {
  const {
    activePresetId, bracketPresets, draftSlPoints, draftTpPoints,
    adHocSlPoints, adHocTpLevels, activeExchange, orderSize,
    setDraftSlPoints, setDraftTpPoints,
    setAdHocSlPoints, addAdHocTp, updateAdHocTpPoints, removeAdHocTp,
    suspendedPresetId,
  } = useStore(useShallow((s) => ({
    activePresetId: s.activePresetId,
    bracketPresets: s.bracketPresets,
    draftSlPoints: s.draftSlPoints,
    draftTpPoints: s.draftTpPoints,
    adHocSlPoints: s.adHocSlPoints,
    adHocTpLevels: s.adHocTpLevels,
    activeExchange: s.activeExchange,
    orderSize: s.orderSize,
    setDraftSlPoints: s.setDraftSlPoints,
    setDraftTpPoints: s.setDraftTpPoints,
    setAdHocSlPoints: s.setAdHocSlPoints,
    addAdHocTp: s.addAdHocTp,
    updateAdHocTpPoints: s.updateAdHocTpPoints,
    removeAdHocTp: s.removeAdHocTp,
    suspendedPresetId: s.suspendedPresetId,
  })));

  const isCrypto = activeExchange !== 'projectx';
  const unit = isCrypto ? 'USD' : 'pt';

  // Resolve current values
  const preset = bracketPresets.find((p) => p.id === activePresetId)?.config ?? null;
  const hasPreset = preset !== null;

  const slValue = hasPreset
    ? (draftSlPoints ?? preset.stopLoss.points)
    : (adHocSlPoints ?? 0);

  const tpValue = hasPreset
    ? (draftTpPoints[0] ?? preset.takeProfits[0]?.points ?? 0)
    : (adHocTpLevels[0]?.points ?? 0);

  // Dimmed when position open (bracket suspended)
  const isSuspended = suspendedPresetId != null;

  function handleSlChange(raw: string) {
    const num = raw === '' ? 0 : parseFloat(raw);
    if (isNaN(num)) return;
    const points = Math.max(0, num);

    if (hasPreset) {
      setDraftSlPoints(points > 0 ? points : null);
    } else {
      setAdHocSlPoints(points > 0 ? points : null);
    }
  }

  function handleTpChange(raw: string) {
    const num = raw === '' ? 0 : parseFloat(raw);
    if (isNaN(num)) return;
    const points = Math.max(0, num);

    if (hasPreset) {
      setDraftTpPoints(0, points > 0 ? points : null);
    } else if (points > 0) {
      if (adHocTpLevels.length === 0) {
        addAdHocTp(points, orderSize);
      } else {
        updateAdHocTpPoints(0, points);
      }
    } else {
      if (adHocTpLevels.length > 0) removeAdHocTp(0);
    }
  }

  const inputClass =
    'w-full bg-(--color-input) border border-(--color-border) rounded text-xs text-white text-center focus:outline-none focus:border-(--color-accent) transition-colors';

  return (
    <div className={isSuspended ? 'opacity-35 pointer-events-none' : ''}>
      <div className="flex" style={{ gap: 8 }}>
        {/* SL */}
        <div className="flex-1">
          <div className={`${SECTION_LABEL} text-center text-(--color-sell)`} style={{ marginBottom: 4 }}>
            SL <span className="normal-case text-(--color-text-muted)">{unit}</span>
          </div>
          <input
            type="number"
            min={0}
            step="any"
            value={slValue > 0 ? slValue : ''}
            placeholder="Off"
            onChange={(e) => handleSlChange(e.target.value)}
            className={inputClass}
            style={{ padding: '5px 4px' }}
          />
        </div>

        {/* TP */}
        <div className="flex-1">
          <div className={`${SECTION_LABEL} text-center text-(--color-buy)`} style={{ marginBottom: 4 }}>
            TP <span className="normal-case text-(--color-text-muted)">{unit}</span>
          </div>
          <input
            type="number"
            min={0}
            step="any"
            value={tpValue > 0 ? tpValue : ''}
            placeholder="Off"
            onChange={(e) => handleTpChange(e.target.value)}
            className={inputClass}
            style={{ padding: '5px 4px' }}
          />
        </div>
      </div>
    </div>
  );
}
