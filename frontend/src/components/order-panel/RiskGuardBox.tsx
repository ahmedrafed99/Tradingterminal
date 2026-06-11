import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';
import { Toggle } from '../shared/Toggle';
import { SpinnerInput } from '../SpinnerInput';

export function RiskGuardBox() {
  const { riskGuardEnabled, riskGuardMaxLoss, setRiskGuardEnabled, setRiskGuardMaxLoss } =
    useStore(
      useShallow((s) => ({
        riskGuardEnabled: s.riskGuardEnabled,
        riskGuardMaxLoss: s.riskGuardMaxLoss,
        setRiskGuardEnabled: s.setRiskGuardEnabled,
        setRiskGuardMaxLoss: s.setRiskGuardMaxLoss,
      })),
    );

  return (
    <div>
      <div className={`${SECTION_LABEL} text-center`}>Risk Guard</div>
      <div
        className="bg-(--color-input) border border-(--color-border) rounded text-xs space-y-2.5"
        style={{ padding: 12, marginTop: 6 }}
      >
        <div className="flex items-center justify-between">
          <span className="text-(--color-text-muted)">Enabled</span>
          <Toggle value={riskGuardEnabled} onChange={setRiskGuardEnabled} />
        </div>
        {riskGuardEnabled && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-(--color-text-muted)">Max loss</span>
            <SpinnerInput
              value={riskGuardMaxLoss}
              onChange={setRiskGuardMaxLoss}
              min={1}
              step={1}
              suffix="$"
              inputWidth={48}
              height={24}
            />
          </div>
        )}
      </div>
    </div>
  );
}
