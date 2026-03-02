import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import type {
  BracketConfig,
  StopLossConfig,
  StopLossType,
  TakeProfitLevel,
  Condition,
  ConditionAction,
} from '../../types/bracket';
import { DEFAULT_BRACKET_CONFIG, MAX_TP_LEVELS } from '../../types/bracket';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function getErrors(name: string, c: BracketConfig, triedSave: boolean): string[] {
  const errs: string[] = [];
  if (triedSave && name.trim().length === 0) errs.push('Preset name is required');
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

function getWarnings(c: BracketConfig): string[] {
  const warns: string[] = [];
  if (c.takeProfits.length > 0) {
    const sum = c.takeProfits.reduce((s, tp) => s + tp.size, 0);
    warns.push(`TP sizes sum to ${sum} contract${sum !== 1 ? 's' : ''}`);
  }
  return warns;
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

  // Re-clone when modal opens
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
  const warnings = getWarnings(draft);

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
      <div className="w-[520px] max-h-[85vh] flex flex-col rounded-xl bg-[#1e222d] border border-[#2a2e39] shadow-2xl">
        {/* Header */}
        <div
          className="flex items-center justify-between border-b border-[#2a2e39] shrink-0"
          style={{ padding: '24px 36px' }}
        >
          <h2 className="text-sm font-semibold text-white">
            {isCreate ? 'New Bracket Preset' : 'Edit Bracket Preset'}
          </h2>
          <button
            onClick={() => setEditingPresetId(null)}
            className="text-[#787b86] hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1" style={{ padding: '32px 36px' }}>
          <div className="space-y-5">
            {/* Preset Name */}
            <div className="rounded-lg" style={{ padding: '16px 18px' }}>
              <div className="text-[10px] text-[#787b86] uppercase tracking-wider mb-3">Preset Name</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Scalp, Swing, etc."
                className="w-full bg-[#111] border border-[#2a2e39] rounded text-xs text-white focus:outline-none focus:border-[#1a3a6e]"
                style={{ padding: '7px 12px' }}
                autoFocus
              />
            </div>

            {/* Stop Loss */}
            <StopLossSection
              sl={draft.stopLoss}
              onChange={(sl) => setDraft((d) => ({ ...d, stopLoss: sl }))}
            />

            {/* Take Profits */}
            <TakeProfitList
              tps={draft.takeProfits}
              onChange={(tps) => setDraft((d) => ({ ...d, takeProfits: tps }))}
            />

            {/* Conditions */}
            <ConditionList
              conditions={draft.conditions}
              tpCount={draft.takeProfits.length}
              onChange={(conditions) => setDraft((d) => ({ ...d, conditions }))}
            />

            {/* Errors */}
            {errors.map((e, i) => (
              <p key={i} className="text-xs text-[#a62a3d] bg-[#a62a3d]/10 rounded-lg px-4 py-2.5">
                {e}
              </p>
            ))}
            {/* Warnings */}
            {warnings.map((w, i) => (
              <p key={i} className="text-xs text-[#b08a3a] bg-[#b08a3a]/10 rounded-lg px-4 py-2.5">
                {w}
              </p>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex justify-between items-center border-t border-[#2a2e39] shrink-0"
          style={{ padding: '24px 36px' }}
        >
          <div className="flex gap-4">
            <button
              onClick={() => {
                setName(isCreate ? '' : existingPreset?.name ?? '');
                setDraft(structuredClone(isCreate ? DEFAULT_BRACKET_CONFIG : existingPreset?.config ?? DEFAULT_BRACKET_CONFIG));
              }}
              className="text-xs text-[#787b86] hover:text-white transition-colors"
            >
              Reset
            </button>
            {!isCreate && existingPreset && (
              <button
                onClick={handleDelete}
                className="text-xs text-[#a62a3d] hover:text-[#c4475a] transition-colors"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setEditingPresetId(null)}
              className="text-sm text-[#787b86] hover:text-white transition-colors"
              style={{ padding: '9px 20px' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={errors.length > 0}
              className="text-sm font-medium rounded-lg bg-[#1a3a6e] text-white hover:bg-[#244d8a] transition-colors disabled:opacity-50"
              style={{ padding: '9px 20px' }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stop Loss Section
// ---------------------------------------------------------------------------

function StopLossSection({
  sl,
  onChange,
}: {
  sl: StopLossConfig;
  onChange: (sl: StopLossConfig) => void;
}) {
  return (
    <div className="rounded-lg" style={{ padding: '16px 18px' }}>
      <div className="text-[10px] text-[#787b86] uppercase tracking-wider mb-4">Stop Loss</div>
      <div className="flex items-end gap-4">
        <label className="flex-1">
          <span className="block text-[10px] text-[#787b86] mb-2">Distance</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={1}
              value={sl.points}
              onChange={(e) => onChange({ ...sl, points: Math.max(0, +e.target.value || 0) })}
              className="w-full bg-[#111] border border-[#2a2e39] rounded text-xs text-white focus:outline-none focus:border-[#1a3a6e] [&::-webkit-inner-spin-button]:appearance-none"
              style={{ padding: '6px 10px' }}
            />
            <span className="text-[10px] text-[#787b86] whitespace-nowrap">pts</span>
          </div>
        </label>
        <label className="flex-1">
          <span className="block text-[10px] text-[#787b86] mb-2">Type</span>
          <select
            value={sl.type}
            onChange={(e) => onChange({ ...sl, type: e.target.value as StopLossType })}
            className="w-full bg-[#111] border border-[#2a2e39] rounded text-xs text-white focus:outline-none focus:border-[#1a3a6e]"
            style={{ padding: '6px 10px' }}
          >
            <option value="Stop">Stop</option>
            <option value="TrailingStop">Trailing Stop</option>
          </select>
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Take Profit List
// ---------------------------------------------------------------------------

function TakeProfitList({
  tps,
  onChange,
}: {
  tps: TakeProfitLevel[];
  onChange: (tps: TakeProfitLevel[]) => void;
}) {
  function addTP() {
    if (tps.length >= MAX_TP_LEVELS) return;
    onChange([
      ...tps,
      { id: crypto.randomUUID(), points: 10, size: 1 },
    ]);
  }

  function updateTP(index: number, updated: TakeProfitLevel) {
    const next = [...tps];
    next[index] = updated;
    onChange(next);
  }

  function removeTP(index: number) {
    onChange(tps.filter((_, i) => i !== index));
  }

  return (
    <div className="rounded-lg" style={{ padding: '16px 18px' }}>
      <div className="text-[10px] text-[#787b86] uppercase tracking-wider mb-4">Take Profits</div>
      <div className="space-y-2.5">
        {tps.map((tp, i) => (
          <TakeProfitRow
            key={tp.id}
            tp={tp}
            index={i}
            onChange={(updated) => updateTP(i, updated)}
            onRemove={() => removeTP(i)}
          />
        ))}
        {tps.length < MAX_TP_LEVELS && (
          <button
            onClick={addTP}
            className="text-xs text-[#4a80b0] hover:text-[#5a90c0] transition-colors pt-1"
          >
            + Add Take Profit
          </button>
        )}
      </div>
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
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] text-[#787b86] w-6 shrink-0">TP{index + 1}</span>
      <input
        type="number"
        min={1}
        step={1}
        value={tp.points}
        onChange={(e) => onChange({ ...tp, points: Math.max(1, +e.target.value || 1) })}
        className="w-16 bg-[#111] border border-[#2a2e39] rounded text-xs text-white focus:outline-none focus:border-[#1a3a6e] [&::-webkit-inner-spin-button]:appearance-none"
        style={{ padding: '5px 8px' }}
        title="Points"
      />
      <span className="text-[10px] text-[#434651]">pts</span>
      <input
        type="number"
        min={1}
        step={1}
        value={tp.size}
        onChange={(e) => onChange({ ...tp, size: Math.max(1, +e.target.value || 1) })}
        className="w-14 bg-[#111] border border-[#2a2e39] rounded text-xs text-white focus:outline-none focus:border-[#1a3a6e] [&::-webkit-inner-spin-button]:appearance-none"
        style={{ padding: '5px 8px' }}
        title="Contracts"
      />
      <span className="text-[10px] text-[#434651]">ct</span>
      <button
        onClick={onRemove}
        className="text-[#787b86] hover:text-[#a62a3d] transition-colors ml-auto text-xs"
        title="Remove"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conditions List
// ---------------------------------------------------------------------------

function ConditionList({
  conditions,
  tpCount,
  onChange,
}: {
  conditions: Condition[];
  tpCount: number;
  onChange: (conditions: Condition[]) => void;
}) {
  function addCondition() {
    onChange([
      ...conditions,
      {
        id: crypto.randomUUID(),
        trigger: { kind: 'tpFilled', tpIndex: 0 },
        action: { kind: 'moveSLToBreakeven' },
      },
    ]);
  }

  function updateCondition(index: number, updated: Condition) {
    const next = [...conditions];
    next[index] = updated;
    onChange(next);
  }

  function removeCondition(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }

  return (
    <div className="rounded-lg" style={{ padding: '16px 18px' }}>
      <div className="text-[10px] text-[#787b86] uppercase tracking-wider mb-4">Conditions</div>
      <div className="space-y-3">
        {conditions.map((cond, i) => (
          <ConditionRow
            key={cond.id}
            condition={cond}
            tpCount={tpCount}
            onChange={(updated) => updateCondition(i, updated)}
            onRemove={() => removeCondition(i)}
          />
        ))}
        <button
          onClick={addCondition}
          disabled={tpCount === 0}
          className="text-xs text-[#4a80b0] hover:text-[#5a90c0] transition-colors disabled:text-[#434651] disabled:cursor-not-allowed pt-1"
        >
          + Add Condition
        </button>
      </div>
    </div>
  );
}

function ConditionRow({
  condition,
  tpCount,
  onChange,
  onRemove,
}: {
  condition: Condition;
  tpCount: number;
  onChange: (updated: Condition) => void;
  onRemove: () => void;
}) {
  const actionKind = condition.action.kind;

  // Build action options based on TP context
  const actionOptions: { value: string; label: string }[] = [
    { value: 'moveSLToBreakeven', label: 'Move SL to Breakeven' },
  ];
  // Add "Move SL to TP N price" for each TP before the trigger TP
  for (let i = 0; i < tpCount; i++) {
    if (i !== condition.trigger.tpIndex) {
      actionOptions.push({
        value: `moveSLToTP:${i}`,
        label: `Move SL to TP ${i + 1} price`,
      });
    }
  }
  actionOptions.push(
    { value: 'customOffset', label: 'Move SL to custom offset' },
    { value: 'cancelRemainingTPs', label: 'Cancel remaining TPs' },
  );

  function encodeAction(): string {
    if (actionKind === 'moveSLToTP') return `moveSLToTP:${condition.action.kind === 'moveSLToTP' ? (condition.action as { kind: 'moveSLToTP'; tpIndex: number }).tpIndex : 0}`;
    if (actionKind === 'moveSLToPrice') return 'customOffset'; // map legacy
    return actionKind;
  }

  function decodeAction(val: string): ConditionAction {
    if (val.startsWith('moveSLToTP:')) {
      return { kind: 'moveSLToTP', tpIndex: parseInt(val.split(':')[1], 10) };
    }
    if (val === 'customOffset') {
      return { kind: 'customOffset', points: actionKind === 'customOffset' ? (condition.action as { kind: 'customOffset'; points: number }).points : 10 };
    }
    if (val === 'cancelRemainingTPs') return { kind: 'cancelRemainingTPs' };
    return { kind: 'moveSLToBreakeven' };
  }

  return (
    <div className="space-y-2 pb-3 border-b border-[#2a2e39]/50 last:border-0 last:pb-0">
      <div className="flex items-center gap-2.5">
        <span className="text-[10px] text-[#787b86] shrink-0 w-8">When</span>
        <select
          value={condition.trigger.tpIndex}
          onChange={(e) =>
            onChange({
              ...condition,
              trigger: { kind: 'tpFilled', tpIndex: +e.target.value },
            })
          }
          className="bg-[#111] border border-[#2a2e39] rounded text-xs text-white focus:outline-none focus:border-[#1a3a6e]"
          style={{ padding: '5px 8px' }}
        >
          {Array.from({ length: tpCount }, (_, i) => (
            <option key={i} value={i}>
              TP {i + 1} filled
            </option>
          ))}
        </select>
        <button
          onClick={onRemove}
          className="text-[#787b86] hover:text-[#a62a3d] transition-colors text-xs shrink-0 ml-auto"
          title="Remove"
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-[10px] text-[#787b86] shrink-0 w-8">Then</span>
        <select
          value={encodeAction()}
          onChange={(e) => onChange({ ...condition, action: decodeAction(e.target.value) })}
          className="bg-[#111] border border-[#2a2e39] rounded text-xs text-white focus:outline-none focus:border-[#1a3a6e]"
          style={{ padding: '5px 8px' }}
        >
          {actionOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {actionKind === 'customOffset' && (
        <div className="flex items-center gap-2.5" style={{ paddingLeft: '42px' }}>
          <input
            type="number"
            min={1}
            step={1}
            value={(condition.action as { kind: 'customOffset'; points: number }).points}
            onChange={(e) =>
              onChange({
                ...condition,
                action: { kind: 'customOffset', points: Math.max(1, +e.target.value || 1) },
              })
            }
            className="w-16 bg-[#111] border border-[#2a2e39] rounded text-xs text-white focus:outline-none focus:border-[#1a3a6e] [&::-webkit-inner-spin-button]:appearance-none"
            style={{ padding: '5px 8px' }}
          />
          <span className="text-[10px] text-[#434651]">pts past entry</span>
        </div>
      )}
    </div>
  );
}
