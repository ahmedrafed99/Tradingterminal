import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
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
// Shared styles
// ---------------------------------------------------------------------------

const INPUT_CLS = 'w-full bg-white/[0.05] border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-[#2962ff]/50 transition-all [&::-webkit-inner-spin-button]:appearance-none';
const SELECT_CLS = 'w-full bg-white/[0.05] border border-white/10 rounded-lg text-xs text-white appearance-none focus:outline-none focus:border-[#2962ff]/50 transition-all cursor-pointer';

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
    if (cond.trigger.tpIndex >= c.takeProfits.length) {
      errs.push(`Condition references TP ${cond.trigger.tpIndex + 1} which does not exist`);
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Chevron for selects
// ---------------------------------------------------------------------------

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute text-[#787b86] pointer-events-none" style={{ right: '10px', top: '50%', transform: 'translateY(-50%)' }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main Modal
// ---------------------------------------------------------------------------

export function BracketSettingsModal() {
  const { editingPresetId, setEditingPresetId, bracketPresets, savePreset, deletePreset, setActivePresetId } =
    useStore();

  const isOpen = editingPresetId !== null;
  const isCreate = editingPresetId === 'new';
  const existingPreset = !isCreate && editingPresetId
    ? bracketPresets.find((p) => p.id === editingPresetId) ?? null
    : null;

  const [name, setName] = useState('');
  const [draft, setDraft] = useState<BracketConfig>(structuredClone(DEFAULT_BRACKET_CONFIG));
  const [triedSave, setTriedSave] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTriedSave(false);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[480px] max-h-[85vh] flex flex-col rounded-2xl bg-black border border-white/5 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5" style={{ padding: '18px 24px' }}>
          <h2 className="text-sm font-semibold text-white">
            {isCreate ? 'New Bracket Preset' : 'Edit Bracket Preset'}
          </h2>
          <button
            onClick={() => setEditingPresetId(null)}
            className="flex items-center justify-center rounded-full hover:bg-white/5 transition-colors"
            style={{ width: '32px', height: '32px' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#787b86" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            {/* Preset Name */}
            <div>
              <div className="text-[11px] font-medium text-[#787b86] uppercase tracking-wider" style={{ marginBottom: '8px' }}>Preset Name</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Scalp 10-point / Runner"
                className={`${INPUT_CLS} placeholder-[#434651]`}
                style={{ padding: '10px 14px' }}
                autoFocus
              />
            </div>

            {/* Stop Loss */}
            <section>
              <div className="text-[11px] font-medium text-[#787b86] uppercase tracking-wider" style={{ marginBottom: '12px' }}>Stop Loss</div>
              <StopLossSection
                sl={draft.stopLoss}
                onChange={(sl) => setDraft((d) => ({ ...d, stopLoss: sl }))}
              />
            </section>

            {/* Take Profits */}
            <section>
              <div className="flex items-center justify-between" style={{ marginBottom: '12px' }}>
                <div className="text-[11px] font-medium text-[#787b86] uppercase tracking-wider">Take Profits</div>
                {draft.takeProfits.length < MAX_TP_LEVELS && (
                  <button
                    onClick={() => setDraft((d) => ({
                      ...d,
                      takeProfits: [...d.takeProfits, { id: crypto.randomUUID(), points: 10, size: 1 }],
                    }))}
                    className="text-[11px] font-medium text-[#787b86] hover:text-white transition-colors uppercase tracking-wider"
                  >
                    + Add Target
                  </button>
                )}
              </div>
              <TakeProfitList
                tps={draft.takeProfits}
                onChange={(tps) => setDraft((d) => ({ ...d, takeProfits: tps }))}
              />
            </section>

            {/* Automation */}
            <section>
              <div className="flex items-center justify-between" style={{ marginBottom: '12px' }}>
                <div className="text-[11px] font-medium text-[#787b86] uppercase tracking-wider">Automation</div>
                <button
                  onClick={() => setDraft((d) => ({
                    ...d,
                    conditions: [
                      ...d.conditions,
                      { id: crypto.randomUUID(), trigger: { kind: 'tpFilled', tpIndex: 0 }, action: { kind: 'moveSLToBreakeven' } },
                    ],
                  }))}
                  disabled={draft.takeProfits.length === 0}
                  className="text-[11px] font-medium text-[#787b86] hover:text-white transition-colors uppercase tracking-wider disabled:text-[#434651] disabled:cursor-not-allowed"
                >
                  + New Rule
                </button>
              </div>
              <ConditionList
                conditions={draft.conditions}
                tpCount={draft.takeProfits.length}
                onChange={(conditions) => setDraft((d) => ({ ...d, conditions }))}
              />
            </section>
          </div>

          {/* Errors */}
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-[#f23645] bg-[#f23645]/10 rounded-lg text-center" style={{ padding: '10px 16px', marginTop: '12px' }}>
              {e}
            </p>
          ))}
        </div>

        {/* Footer */}
        <div
          className="flex justify-between items-center border-t border-white/5"
          style={{ padding: '16px 24px' }}
        >
          <div className="flex items-center" style={{ gap: '16px' }}>
            <button
              onClick={() => {
                setName(isCreate ? '' : existingPreset?.name ?? '');
                setDraft(structuredClone(isCreate ? DEFAULT_BRACKET_CONFIG : existingPreset?.config ?? DEFAULT_BRACKET_CONFIG));
              }}
              className="text-xs text-[#787b86] hover:text-[#d1d4dc] transition-colors"
            >
              Reset
            </button>
            {!isCreate && existingPreset && (
              <button
                onClick={handleDelete}
                className="text-xs text-[#787b86] hover:text-[#f23645] transition-colors"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center" style={{ gap: '10px' }}>
            <button
              onClick={() => setEditingPresetId(null)}
              className="text-xs text-[#787b86] hover:text-white transition-colors"
              style={{ padding: '8px 16px' }}
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={errors.length > 0}
              className="text-xs font-medium rounded-lg bg-[#2962ff]/20 text-[#5b8def] hover:bg-[#2962ff]/30 transition-all disabled:opacity-50"
              style={{ padding: '8px 24px' }}
            >
              Save Preset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stop Loss
// ---------------------------------------------------------------------------

function StopLossSection({
  sl,
  onChange,
}: {
  sl: StopLossConfig;
  onChange: (sl: StopLossConfig) => void;
}) {
  return (
    <div className="grid grid-cols-2" style={{ gap: '12px' }}>
      <label>
        <span className="block text-[11px] text-[#787b86]" style={{ marginBottom: '6px' }}>Distance (Points)</span>
        <input
          type="number"
          min={0}
          step={1}
          value={sl.points}
          onChange={(e) => onChange({ ...sl, points: Math.max(0, +e.target.value || 0) })}
          className={INPUT_CLS}
          style={{ padding: '9px 12px' }}
        />
      </label>
      <label>
        <span className="block text-[11px] text-[#787b86]" style={{ marginBottom: '6px' }}>Order Type</span>
        <div className="relative">
          <select
            value={sl.type}
            onChange={(e) => onChange({ ...sl, type: e.target.value as StopLossType })}
            className={SELECT_CLS}
            style={{ padding: '9px 12px' }}
          >
            <option value="Stop">Stop Market</option>
            <option value="TrailingStop">Trailing Stop</option>
          </select>
          <ChevronDown />
        </div>
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
}: {
  tps: TakeProfitLevel[];
  onChange: (tps: TakeProfitLevel[]) => void;
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
      <div className="text-xs text-[#434651] text-center" style={{ padding: '8px 0' }}>
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
}: {
  tp: TakeProfitLevel;
  index: number;
  onChange: (updated: TakeProfitLevel) => void;
  onRemove: () => void;
}) {
  return (
    <div className="group/item flex items-center border border-white/[0.05] rounded-lg transition-all hover:border-white/10" style={{ padding: '10px 12px', gap: '12px', background: 'rgba(255,255,255,0.04)' }}>
      {/* Index */}
      <span className="text-[11px] text-[#787b86] font-medium shrink-0" style={{ width: '18px' }}>
        {index + 1}
      </span>

      {/* Fields */}
      <div className="flex-1 grid grid-cols-2" style={{ gap: '12px' }}>
        <div className="flex items-center" style={{ gap: '8px' }}>
          <span className="text-[11px] text-[#787b86] font-medium shrink-0">Points</span>
          <input
            type="number"
            min={1}
            step={1}
            value={tp.points}
            onChange={(e) => onChange({ ...tp, points: Math.max(1, +e.target.value || 1) })}
            className="w-full bg-transparent border-b border-white/10 focus:border-white/30 outline-none text-xs text-white transition-colors [&::-webkit-inner-spin-button]:appearance-none"
            style={{ padding: '4px 0' }}
          />
        </div>
        <div className="flex items-center" style={{ gap: '8px' }}>
          <span className="text-[11px] text-[#787b86] font-medium shrink-0">Quantity</span>
          <input
            type="number"
            min={1}
            step={1}
            value={tp.size}
            onChange={(e) => onChange({ ...tp, size: Math.max(1, +e.target.value || 1) })}
            className="w-full bg-transparent border-b border-white/10 focus:border-white/30 outline-none text-xs text-white transition-colors [&::-webkit-inner-spin-button]:appearance-none"
            style={{ padding: '4px 0' }}
          />
        </div>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="opacity-0 group-hover/item:opacity-100 text-[#434651] hover:text-[#f23645] transition-all shrink-0"
        style={{ padding: '4px' }}
        title="Remove"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
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
}: {
  conditions: BracketCondition[];
  tpCount: number;
  onChange: (conditions: BracketCondition[]) => void;
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
      <div className="text-xs text-[#434651] text-center" style={{ padding: '8px 0' }}>
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
}: {
  condition: BracketCondition;
  tpCount: number;
  onChange: (updated: BracketCondition) => void;
  onRemove: () => void;
}) {
  const actionKind = condition.action.kind;

  const actionOptions: { value: string; label: string }[] = [
    { value: 'moveSLToBreakeven', label: 'Move SL to Breakeven' },
  ];
  for (let i = 0; i < tpCount; i++) {
    if (i !== condition.trigger.tpIndex) {
      actionOptions.push({ value: `moveSLToTP:${i}`, label: `Move SL to Target ${i + 1} price` });
    }
  }
  actionOptions.push(
    { value: 'customOffset', label: 'Move SL to custom offset' },
    { value: 'cancelRemainingTPs', label: 'Cancel remaining targets' },
  );

  function encodeAction(): string {
    if (actionKind === 'moveSLToTP') return `moveSLToTP:${condition.action.kind === 'moveSLToTP' ? (condition.action as { kind: 'moveSLToTP'; tpIndex: number }).tpIndex : 0}`;
    if (actionKind === 'moveSLToPrice') return 'customOffset';
    return actionKind;
  }

  function decodeAction(val: string): ConditionAction {
    if (val.startsWith('moveSLToTP:')) return { kind: 'moveSLToTP', tpIndex: parseInt(val.split(':')[1], 10) };
    if (val === 'customOffset') return { kind: 'customOffset', points: actionKind === 'customOffset' ? (condition.action as { kind: 'customOffset'; points: number }).points : 10 };
    if (val === 'cancelRemainingTPs') return { kind: 'cancelRemainingTPs' };
    return { kind: 'moveSLToBreakeven' };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* When */}
      <div className="flex items-center" style={{ gap: '10px' }}>
        <span className="text-[11px] text-[#787b86] font-medium uppercase shrink-0" style={{ width: '36px' }}>When</span>
        <div className="relative flex-1">
          <select
            value={condition.trigger.tpIndex}
            onChange={(e) => onChange({ ...condition, trigger: { kind: 'tpFilled', tpIndex: +e.target.value } })}
            className={SELECT_CLS}
            style={{ padding: '8px 12px' }}
          >
            {Array.from({ length: tpCount }, (_, i) => (
              <option key={i} value={i}>Target {i + 1} is filled</option>
            ))}
          </select>
          <ChevronDown />
        </div>
        <button
          onClick={onRemove}
          className="text-[#434651] hover:text-[#f23645] transition-colors shrink-0"
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
        <span className="text-[11px] text-[#787b86] font-medium uppercase shrink-0" style={{ width: '36px' }}>Then</span>
        <div className="relative flex-1">
          <select
            value={encodeAction()}
            onChange={(e) => onChange({ ...condition, action: decodeAction(e.target.value) })}
            className={SELECT_CLS}
            style={{ padding: '8px 12px' }}
          >
            {actionOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown />
        </div>
        <span className="shrink-0" style={{ width: '22px' }} />
      </div>

      {/* Custom offset input */}
      {actionKind === 'customOffset' && (
        <div className="flex items-center" style={{ marginLeft: '46px', gap: '8px' }}>
          <input
            type="number"
            min={1}
            step={1}
            value={(condition.action as { kind: 'customOffset'; points: number }).points}
            onChange={(e) => onChange({ ...condition, action: { kind: 'customOffset', points: Math.max(1, +e.target.value || 1) } })}
            className="w-20 bg-white/[0.05] border border-white/10 rounded-lg text-xs text-white text-center focus:outline-none focus:border-[#2962ff]/50 transition-all [&::-webkit-inner-spin-button]:appearance-none"
            style={{ padding: '6px 8px' }}
          />
          <span className="text-[11px] text-[#787b86]">points past entry</span>
        </div>
      )}
    </div>
  );
}
