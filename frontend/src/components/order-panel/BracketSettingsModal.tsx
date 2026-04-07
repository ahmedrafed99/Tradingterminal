import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { Modal } from '../shared/Modal';
import { CustomSelect } from '../shared/CustomSelect';
import { getTicksPerPoint } from '../../utils/instrument';
import type {
  BracketConfig,
  StopLossConfig,
  StopLossType,
  TakeProfitLevel,
  BracketCondition,
  ConditionAction,
} from '../../types/bracket';
import { DEFAULT_BRACKET_CONFIG, MAX_TP_LEVELS } from '../../types/bracket';

// ---------------------------------------------------------------------------
// Unit mode
// ---------------------------------------------------------------------------

type UnitMode = 'pts' | 'ticks' | 'pct';

function toDisplay(points: number, mode: UnitMode, tpp: number, ref: number): number {
  if (mode === 'ticks') return Math.round(points * tpp);
  if (mode === 'pct') return ref > 0 ? +((points / ref) * 100).toFixed(3) : 0;
  return points;
}

function fromDisplay(val: number, mode: UnitMode, tpp: number, ref: number): number {
  if (mode === 'ticks') return val / tpp;
  if (mode === 'pct') return (val / 100) * ref;
  return val;
}

function unitLabel(mode: UnitMode): string {
  if (mode === 'ticks') return 'ticks';
  if (mode === 'pct') return '%';
  return 'pts';
}

function unitStep(mode: UnitMode): number {
  if (mode === 'ticks') return 1;
  if (mode === 'pct') return 0.001;
  return 1;
}

// ---------------------------------------------------------------------------
// Unit toggle component
// ---------------------------------------------------------------------------

function UnitToggle({ value, onChange, canUsePct }: {
  value: UnitMode;
  onChange: (m: UnitMode) => void;
  canUsePct: boolean;
}) {
  const tabs: { id: UnitMode; label: string }[] = [
    { id: 'pts', label: 'pts' },
    { id: 'ticks', label: 'ticks' },
    { id: 'pct', label: '%' },
  ];

  return (
    <div
      className="flex items-center border border-(--color-border) rounded-lg"
      style={{ background: 'var(--color-input)', padding: '3px', gap: '2px' }}
    >
      {tabs.map(({ id, label }) => {
        const isActive = value === id;
        const isDisabled = id === 'pct' && !canUsePct;
        return (
          <button
            key={id}
            onClick={() => !isDisabled && onChange(id)}
            title={isDisabled ? 'No price data available' : undefined}
            className={[
              'text-[11px] font-medium rounded-md transition-all',
              isActive
                ? 'text-white'
                : isDisabled
                  ? 'text-(--color-text-dim) cursor-not-allowed'
                  : 'text-(--color-text-muted) hover:text-(--color-text) cursor-pointer',
            ].join(' ')}
            style={{
              padding: '4px 10px',
              background: isActive ? 'var(--color-border)' : 'transparent',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const INPUT_CLS = 'w-full bg-(--color-input) border border-(--color-border) rounded-lg text-xs text-(--color-text-bright) focus:outline-none focus:border-(--color-accent)/50 transition-all [&::-webkit-inner-spin-button]:appearance-none';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function getErrors(name: string, c: BracketConfig, triedSave: boolean): string[] {
  if (!triedSave) return [];
  const errs: string[] = [];
  if (name.trim().length === 0) errs.push('Preset name is required');
  if (c.takeProfits.length > 0 && c.stopLoss.points < 1) {
    errs.push('Stop loss must be at least 1 point when take profits are set');
  }
  for (let i = 0; i < c.takeProfits.length; i++) {
    if (c.takeProfits[i].points < 1) errs.push(`TP ${i + 1}: points must be at least 1`);
    if (c.takeProfits[i].size < 1) errs.push(`TP ${i + 1}: size must be at least 1 contract`);
  }
  for (const cond of c.conditions) {
    if (cond.trigger.kind === 'tpFilled' && cond.trigger.tpIndex >= c.takeProfits.length) {
      errs.push(`Condition references TP ${cond.trigger.tpIndex + 1} which does not exist`);
    }
    if (cond.trigger.kind === 'profitReached' && cond.trigger.points < 1) {
      errs.push('Profit threshold must be at least 1 point');
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Main Modal
// ---------------------------------------------------------------------------

export function BracketSettingsModal() {
  const { editingPresetId, setEditingPresetId, bracketPresets, savePreset, deletePreset, setActivePresetId, orderContract, lastPrice } =
    useStore(useShallow((s) => ({
      editingPresetId: s.editingPresetId,
      setEditingPresetId: s.setEditingPresetId,
      bracketPresets: s.bracketPresets,
      savePreset: s.savePreset,
      deletePreset: s.deletePreset,
      setActivePresetId: s.setActivePresetId,
      orderContract: s.orderContract,
      lastPrice: s.lastPrice,
    })));

  const tpp = orderContract ? getTicksPerPoint(orderContract) : 4;
  const refPrice = lastPrice ?? 0;
  const canUsePct = refPrice > 0;

  const isOpen = editingPresetId !== null;
  const isCreate = editingPresetId === 'new';
  const existingPreset = !isCreate && editingPresetId
    ? bracketPresets.find((p) => p.id === editingPresetId) ?? null
    : null;

  const [name, setName] = useState('');
  const [draft, setDraft] = useState<BracketConfig>(structuredClone(DEFAULT_BRACKET_CONFIG));
  const [triedSave, setTriedSave] = useState(false);
  const [unitMode, setUnitMode] = useState<UnitMode>('pts');

  useEffect(() => {
    if (!isOpen) return;
    setTriedSave(false);
    setUnitMode('pts');
    if (isCreate) {
      setName('');
      setDraft(structuredClone(DEFAULT_BRACKET_CONFIG));
    } else if (existingPreset) {
      setName(existingPreset.name);
      setDraft(structuredClone(existingPreset.config));
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const errors = getErrors(name, draft, triedSave);

  function handleSave() {
    setTriedSave(true);
    const finalErrors = getErrors(name, draft, true);
    if (finalErrors.length > 0) return;
    const id = existingPreset?.id ?? crypto.randomUUID();
    savePreset({ id, name: name.trim(), config: draft });
    setActivePresetId(id);
    setEditingPresetId(null);
  }

  function handleDelete() {
    if (!existingPreset) return;
    deletePreset(existingPreset.id);
    setEditingPresetId(null);
  }

  return (
    <Modal onClose={() => setEditingPresetId(null)} className="w-[480px] max-h-[85vh] flex flex-col rounded-2xl bg-(--color-surface) border border-(--color-border) shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-(--color-border)/30" style={{ padding: '18px 24px' }}>
          <h2 className="text-sm font-semibold text-white">
            {isCreate ? 'New Bracket Preset' : 'Edit Bracket Preset'}
          </h2>
          <div className="flex items-center" style={{ gap: '12px' }}>
            <UnitToggle value={unitMode} onChange={setUnitMode} canUsePct={canUsePct} />
            <button
              onClick={() => setEditingPresetId(null)}
              className="flex items-center justify-center rounded-full hover:bg-(--color-border)/30 transition-colors"
              style={{ width: '32px', height: '32px' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            {/* Preset Name */}
            <div>
              <div className="text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider" style={{ marginBottom: '8px' }}>Preset Name</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Scalp 10-point / Runner"
                className={`${INPUT_CLS} placeholder-(--color-text-dim)`}
                style={{ padding: '10px 14px' }}
                autoFocus
              />
            </div>

            {/* Stop Loss */}
            <section>
              <div className="text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider" style={{ marginBottom: '12px' }}>Stop Loss</div>
              <StopLossSection
                sl={draft.stopLoss}
                onChange={(sl) => setDraft((d) => ({ ...d, stopLoss: sl }))}
                unitMode={unitMode}
                tpp={tpp}
                refPrice={refPrice}
              />
            </section>

            {/* Take Profits */}
            <section>
              <div className="flex items-center justify-between" style={{ marginBottom: '12px' }}>
                <div className="text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider">Take Profits</div>
                {draft.takeProfits.length < MAX_TP_LEVELS && (
                  <button
                    onClick={() => setDraft((d) => ({
                      ...d,
                      takeProfits: [...d.takeProfits, { id: crypto.randomUUID(), points: 10, size: 1 }],
                    }))}
                    className="text-[11px] font-medium text-(--color-text-muted) hover:text-white transition-colors uppercase tracking-wider"
                  >
                    + Add Target
                  </button>
                )}
              </div>
              <TakeProfitList
                tps={draft.takeProfits}
                onChange={(tps) => setDraft((d) => ({ ...d, takeProfits: tps }))}
                unitMode={unitMode}
                tpp={tpp}
                refPrice={refPrice}
              />
            </section>

            {/* Automation */}
            <section>
              <div className="flex items-center justify-between" style={{ marginBottom: '12px' }}>
                <div className="text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider">Automation</div>
                <button
                  onClick={() => setDraft((d) => ({
                    ...d,
                    conditions: [
                      ...d.conditions,
                      {
                        id: crypto.randomUUID(),
                        trigger: d.takeProfits.length > 0
                          ? { kind: 'tpFilled' as const, tpIndex: 0 }
                          : { kind: 'profitReached' as const, points: 10 },
                        action: { kind: 'moveSLToBreakeven' as const },
                      },
                    ],
                  }))}
                  className="text-[11px] font-medium text-(--color-text-muted) hover:text-white transition-colors uppercase tracking-wider"
                >
                  + New Rule
                </button>
              </div>
              <ConditionList
                conditions={draft.conditions}
                tpCount={draft.takeProfits.length}
                onChange={(conditions) => setDraft((d) => ({ ...d, conditions }))}
                unitMode={unitMode}
                tpp={tpp}
                refPrice={refPrice}
              />
            </section>
          </div>

          {/* Errors */}
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-(--color-error) bg-(--color-error)/10 rounded-lg text-center" style={{ padding: '10px 16px', marginTop: '12px' }}>
              {e}
            </p>
          ))}
        </div>

        {/* Footer */}
        <div
          className="flex justify-between items-center border-t border-(--color-border)/30"
          style={{ padding: '16px 24px' }}
        >
          <div className="flex items-center" style={{ gap: '16px' }}>
            <button
              onClick={() => {
                setName(isCreate ? '' : existingPreset?.name ?? '');
                setDraft(structuredClone(isCreate ? DEFAULT_BRACKET_CONFIG : existingPreset?.config ?? DEFAULT_BRACKET_CONFIG));
              }}
              className="text-xs text-(--color-text-muted) hover:text-(--color-text) transition-colors"
            >
              Reset
            </button>
            {!isCreate && existingPreset && (
              <button
                onClick={handleDelete}
                className="text-xs text-(--color-text-muted) hover:text-(--color-error) transition-colors"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center" style={{ gap: '10px' }}>
            <button
              onClick={() => setEditingPresetId(null)}
              className="text-xs text-(--color-text-muted) hover:text-white transition-colors"
              style={{ padding: '8px 16px' }}
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={errors.length > 0}
              className="text-xs font-medium rounded-lg bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30 transition-all disabled:opacity-50"
              style={{ padding: '8px 24px' }}
            >
              Save Preset
            </button>
          </div>
        </div>
    </Modal>
  );
}


// ---------------------------------------------------------------------------
// Stop Loss
// ---------------------------------------------------------------------------

function StopLossSection({
  sl,
  onChange,
  unitMode,
  tpp,
  refPrice,
}: {
  sl: StopLossConfig;
  onChange: (sl: StopLossConfig) => void;
  unitMode: UnitMode;
  tpp: number;
  refPrice: number;
}) {
  const displayVal = toDisplay(sl.points, unitMode, tpp, refPrice);
  const step = unitStep(unitMode);
  const label = `Distance (${unitLabel(unitMode)})`;

  return (
    <div className="grid grid-cols-2" style={{ gap: '12px' }}>
      <label>
        <span className="block text-[11px] text-(--color-text-muted)" style={{ marginBottom: '6px' }}>{label}</span>
        <input
          type="number"
          min={0}
          step={step}
          value={displayVal}
          onChange={(e) => {
            const pts = fromDisplay(Math.max(0, +e.target.value || 0), unitMode, tpp, refPrice);
            onChange({ ...sl, points: pts });
          }}
          className={INPUT_CLS}
          style={{ padding: '9px 12px' }}
        />
      </label>
      <label>
        <span className="block text-[11px] text-(--color-text-muted)" style={{ marginBottom: '6px' }}>Order Type</span>
        <CustomSelect
          value={sl.type}
          options={[
            { value: 'Stop', label: 'Stop Market' },
            { value: 'TrailingStop', label: 'Trailing Stop' },
          ]}
          onChange={(v) => onChange({ ...sl, type: v as StopLossType })}
          style={{ flex: 1 }}
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Take Profits
// ---------------------------------------------------------------------------

function TakeProfitList({
  tps,
  onChange,
  unitMode,
  tpp,
  refPrice,
}: {
  tps: TakeProfitLevel[];
  onChange: (tps: TakeProfitLevel[]) => void;
  unitMode: UnitMode;
  tpp: number;
  refPrice: number;
}) {
  function updateTP(index: number, updated: TakeProfitLevel) {
    const next = [...tps];
    next[index] = updated;
    onChange(next);
  }

  function removeTP(index: number) {
    onChange(tps.filter((_, i) => i !== index));
  }

  if (tps.length === 0) {
    return (
      <div className="text-xs text-(--color-text-dim) text-center" style={{ padding: '8px 0' }}>
        No targets added yet
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {tps.map((tp, i) => (
        <TakeProfitRow
          key={tp.id}
          tp={tp}
          index={i}
          onChange={(updated) => updateTP(i, updated)}
          onRemove={() => removeTP(i)}
          unitMode={unitMode}
          tpp={tpp}
          refPrice={refPrice}
        />
      ))}
    </div>
  );
}

function TakeProfitRow({
  tp,
  index,
  onChange,
  onRemove,
  unitMode,
  tpp,
  refPrice,
}: {
  tp: TakeProfitLevel;
  index: number;
  onChange: (updated: TakeProfitLevel) => void;
  onRemove: () => void;
  unitMode: UnitMode;
  tpp: number;
  refPrice: number;
}) {
  const displayVal = toDisplay(tp.points, unitMode, tpp, refPrice);
  const step = unitStep(unitMode);
  const label = unitLabel(unitMode);

  return (
    <div className="grid grid-cols-2" style={{ gap: '12px' }}>
      {/* Distance field */}
      <label>
        <span className="block text-[11px] text-(--color-text-muted)" style={{ marginBottom: '6px' }}>
          Target {index + 1} ({label})
        </span>
        <input
          type="number"
          min={unitMode === 'ticks' ? 1 : 0.001}
          step={step}
          value={displayVal}
          onChange={(e) => {
            const minPts = unitMode === 'ticks' ? 1 / tpp : unitMode === 'pct' ? 0 : 1;
            const pts = fromDisplay(Math.max(unitMode === 'ticks' ? 1 : 0.001, +e.target.value || (unitMode === 'ticks' ? 1 : 0.001)), unitMode, tpp, refPrice);
            onChange({ ...tp, points: Math.max(minPts, pts) });
          }}
          className={INPUT_CLS}
          style={{ padding: '9px 12px' }}
        />
      </label>

      {/* Quantity field */}
      <label>
        <div className="flex items-center justify-between" style={{ marginBottom: '6px' }}>
          <span className="text-[11px] text-(--color-text-muted)">Quantity</span>
          <button
            onClick={onRemove}
            className="text-(--color-text-dim) hover:text-(--color-error) transition-colors"
            title="Remove"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <input
          type="number"
          min={1}
          step={1}
          value={tp.size}
          onChange={(e) => onChange({ ...tp, size: Math.max(1, +e.target.value || 1) })}
          className={INPUT_CLS}
          style={{ padding: '9px 12px' }}
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conditions (Automation)
// ---------------------------------------------------------------------------

function ConditionList({
  conditions,
  tpCount,
  onChange,
  unitMode,
  tpp,
  refPrice,
}: {
  conditions: BracketCondition[];
  tpCount: number;
  onChange: (conditions: BracketCondition[]) => void;
  unitMode: UnitMode;
  tpp: number;
  refPrice: number;
}) {
  function updateCondition(index: number, updated: BracketCondition) {
    const next = [...conditions];
    next[index] = updated;
    onChange(next);
  }

  function removeCondition(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }

  if (conditions.length === 0) {
    return (
      <div className="text-xs text-(--color-text-dim) text-center" style={{ padding: '8px 0' }}>
        No rules added yet
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {conditions.map((cond, i) => (
        <ConditionRow
          key={cond.id}
          condition={cond}
          tpCount={tpCount}
          onChange={(updated) => updateCondition(i, updated)}
          onRemove={() => removeCondition(i)}
          unitMode={unitMode}
          tpp={tpp}
          refPrice={refPrice}
        />
      ))}
    </div>
  );
}

function ConditionRow({
  condition,
  tpCount,
  onChange,
  onRemove,
  unitMode,
  tpp,
  refPrice,
}: {
  condition: BracketCondition;
  tpCount: number;
  onChange: (updated: BracketCondition) => void;
  onRemove: () => void;
  unitMode: UnitMode;
  tpp: number;
  refPrice: number;
}) {
  const triggerKind = condition.trigger.kind;
  const actionKind = condition.action.kind;
  const label = unitLabel(unitMode);
  const step = unitStep(unitMode);

  // Build action options (skip "Move SL to Target N" self-reference for tpFilled triggers)
  const actionOptions: { value: string; label: string }[] = [
    { value: 'moveSLToBreakeven', label: 'Move SL to Breakeven' },
  ];
  for (let i = 0; i < tpCount; i++) {
    if (!(triggerKind === 'tpFilled' && i === condition.trigger.tpIndex)) {
      actionOptions.push({ value: `moveSLToTP:${i}`, label: `Move SL to Target ${i + 1} price` });
    }
  }
  actionOptions.push(
    { value: 'customOffset', label: 'Move SL to custom offset' },
    { value: 'cancelRemainingTPs', label: 'Cancel remaining targets' },
  );

  function encodeAction(): string {
    if (actionKind === 'moveSLToTP') return `moveSLToTP:${(condition.action as { kind: 'moveSLToTP'; tpIndex: number }).tpIndex}`;
    if (actionKind === 'moveSLToPrice') return 'customOffset';
    return actionKind;
  }

  function decodeAction(val: string): ConditionAction {
    if (val.startsWith('moveSLToTP:')) return { kind: 'moveSLToTP', tpIndex: parseInt(val.split(':')[1], 10) };
    if (val === 'customOffset') return { kind: 'customOffset', points: actionKind === 'customOffset' ? (condition.action as { kind: 'customOffset'; points: number }).points : 10 };
    if (val === 'cancelRemainingTPs') return { kind: 'cancelRemainingTPs' };
    return { kind: 'moveSLToBreakeven' };
  }

  // Profit reached trigger display value
  const profitDisplayVal = triggerKind === 'profitReached'
    ? toDisplay((condition.trigger as { kind: 'profitReached'; points: number }).points, unitMode, tpp, refPrice)
    : 0;

  // Custom offset action display value
  const offsetDisplayVal = actionKind === 'customOffset'
    ? toDisplay((condition.action as { kind: 'customOffset'; points: number }).points, unitMode, tpp, refPrice)
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* When — trigger kind selector + sub-input */}
      <div className="flex items-center" style={{ gap: '10px' }}>
        <span className="text-[11px] text-(--color-text-muted) font-medium uppercase shrink-0" style={{ width: '36px' }}>When</span>
        <div className="flex-1 flex items-center" style={{ gap: '8px' }}>
          {/* Trigger type dropdown */}
          <CustomSelect
            value={triggerKind}
            options={[
              ...(tpCount > 0 ? [{ value: 'tpFilled', label: 'Target filled' }] : []),
              { value: 'profitReached', label: 'Profit reached' },
            ]}
            onChange={(v) => {
              const kind = v as 'tpFilled' | 'profitReached';
              if (kind === 'tpFilled') {
                onChange({ ...condition, trigger: { kind: 'tpFilled', tpIndex: 0 } });
              } else {
                onChange({ ...condition, trigger: { kind: 'profitReached', points: 10 } });
              }
            }}
            style={{ flex: 1 }}
          />

          {/* Sub-input: TP index or profit value */}
          {triggerKind === 'tpFilled' && (
            <CustomSelect
              value={String(condition.trigger.tpIndex)}
              options={Array.from({ length: tpCount }, (_, i) => ({ value: String(i), label: `Target ${i + 1}` }))}
              onChange={(v) => onChange({ ...condition, trigger: { kind: 'tpFilled', tpIndex: +v } })}
              style={{ flex: 1 }}
            />
          )}
          {triggerKind === 'profitReached' && (
            <div className="flex items-center flex-1" style={{ gap: '6px' }}>
              <input
                type="number"
                min={step}
                step={step}
                value={profitDisplayVal}
                onChange={(e) => {
                  const pts = fromDisplay(Math.max(step, +e.target.value || step), unitMode, tpp, refPrice);
                  onChange({ ...condition, trigger: { kind: 'profitReached', points: Math.max(1, pts) } });
                }}
                className="w-16 bg-(--color-input) border border-(--color-border) rounded-lg text-xs text-white text-center focus:outline-none focus:border-(--color-accent)/50 transition-all [&::-webkit-inner-spin-button]:appearance-none"
                style={{ padding: '7px 8px' }}
              />
              <span className="text-[11px] text-(--color-text-muted) shrink-0">{label} profit</span>
            </div>
          )}
        </div>
        <button
          onClick={onRemove}
          className="text-(--color-text-dim) hover:text-(--color-error) transition-colors shrink-0"
          style={{ padding: '4px' }}
          title="Remove"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Then */}
      <div className="flex items-center" style={{ gap: '10px' }}>
        <span className="text-[11px] text-(--color-text-muted) font-medium uppercase shrink-0" style={{ width: '36px' }}>Then</span>
        <CustomSelect
          value={encodeAction()}
          options={actionOptions.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(v) => onChange({ ...condition, action: decodeAction(v) })}
          style={{ flex: 1 }}
        />
        <span className="shrink-0" style={{ width: '22px' }} />
      </div>

      {/* Custom offset input */}
      {actionKind === 'customOffset' && (
        <div className="flex items-center" style={{ marginLeft: '46px', gap: '8px' }}>
          <input
            type="number"
            min={step}
            step={step}
            value={offsetDisplayVal}
            onChange={(e) => {
              const pts = fromDisplay(Math.max(step, +e.target.value || step), unitMode, tpp, refPrice);
              onChange({ ...condition, action: { kind: 'customOffset', points: Math.max(1, pts) } });
            }}
            className="w-20 bg-(--color-input) border border-(--color-border) rounded-lg text-xs text-white text-center focus:outline-none focus:border-(--color-accent)/50 transition-all [&::-webkit-inner-spin-button]:appearance-none"
            style={{ padding: '6px 8px' }}
          />
          <span className="text-[11px] text-(--color-text-muted)">{label} past entry</span>
        </div>
      )}
    </div>
  );
}
