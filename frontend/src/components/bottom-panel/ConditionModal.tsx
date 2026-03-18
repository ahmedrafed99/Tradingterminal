import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, DEFAULT_PINNED, MORE_TIMEFRAMES } from '../../store/useStore';
import { resolveConditionServerUrl } from '../../store/slices/conditionsSlice';
import { conditionService } from '../../services/conditionService';
import type { CreateConditionInput, PatchConditionInput, ConditionBracket } from '../../services/conditionService';
import type { BracketPreset } from '../../types/bracket';
import { Modal } from '../shared/Modal';
import { CustomSelect } from '../shared/CustomSelect';
import { INPUT_SURFACE } from '../../constants/styles';

const ALL_TIMEFRAMES = [...DEFAULT_PINNED, ...MORE_TIMEFRAMES];

/* ── toggle switch ── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 rounded-full transition-colors"
      style={{
        width: 40,
        height: 22,
        background: checked ? 'var(--color-accent)' : 'var(--color-hover-toolbar)',
      }}
    >
      <span
        className="block rounded-full bg-white shadow transition-all"
        style={{
          width: 18,
          height: 18,
          marginTop: 2,
          marginLeft: checked ? 20 : 2,
        }}
      />
    </button>
  );
}

export function ConditionModal() {
  const {
    conditionModalOpen,
    editingConditionId,
    closeConditionModal,
    conditionServerUrl,
    conditions,
    upsertCondition,
    contract,
    activeAccountId,
    orderSize,
    lastPrice,
    bracketPresets,
    addToast,
    timeframe: activeTimeframe,
  } = useStore(useShallow((s) => ({
    conditionModalOpen: s.conditionModalOpen,
    editingConditionId: s.editingConditionId,
    closeConditionModal: s.closeConditionModal,
    conditionServerUrl: s.conditionServerUrl,
    conditions: s.conditions,
    upsertCondition: s.upsertCondition,
    contract: s.contract,
    activeAccountId: s.activeAccountId,
    orderSize: s.orderSize,
    lastPrice: s.lastPrice,
    bracketPresets: s.bracketPresets,
    addToast: s.addToast,
    timeframe: s.timeframe,
  })));

  const [conditionType, setConditionType] = useState<'closes_above' | 'closes_below'>('closes_above');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [timeframe, setTimeframe] = useState('15m');
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [orderPrice, setOrderPrice] = useState('');
  const [size, setSize] = useState('');
  const [bracketEnabled, setBracketEnabled] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [slPoints, setSlPoints] = useState('');
  const [tpPoints, setTpPoints] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(preset: BracketPreset | null) {
    if (!preset) { setSelectedPresetId(null); setSlPoints(''); setTpPoints(''); return; }
    setSelectedPresetId(preset.id);
    setSlPoints(String(preset.config.stopLoss.points));
    setTpPoints(preset.config.takeProfits.length > 0 ? String(preset.config.takeProfits[0].points) : '');
  }

  // Snapshot lastPrice/orderSize at modal-open time so ticks don't reset the form
  useEffect(() => {
    if (!conditionModalOpen) return;
    if (editingConditionId) {
      const c = conditions.find((x) => x.id === editingConditionId);
      if (c) {
        setConditionType(c.conditionType);
        setTriggerPrice(String(c.triggerPrice));
        setTimeframe(c.timeframe);
        setOrderSide(c.orderSide);
        setOrderType(c.orderType);
        setOrderPrice(c.orderPrice != null ? String(c.orderPrice) : '');
        setSize(String(c.orderSize));
        setBracketEnabled(c.bracket?.enabled ?? false);
        setSelectedPresetId(null);
        setSlPoints(c.bracket?.sl ? String(c.bracket.sl.points) : '');
        setTpPoints(c.bracket?.tp?.[0] ? String(c.bracket.tp[0].points) : '');
        setLabel(c.label ?? '');
      }
    } else {
      setConditionType('closes_above');
      setTriggerPrice(lastPrice != null ? String(lastPrice) : '');
      setTimeframe(activeTimeframe.label);
      setOrderSide('buy');
      setOrderType('market');
      setOrderPrice('');
      setSize(String(orderSize));
      setBracketEnabled(false);
      setSelectedPresetId(null);
      setSlPoints('');
      setTpPoints('');
      setLabel('');
    }
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionModalOpen, editingConditionId]);

  if (!conditionModalOpen) return null;

  async function handleSubmit() {
    const serverUrl = resolveConditionServerUrl(conditionServerUrl);
    if (!contract || activeAccountId == null) {
      setError('Missing contract or account');
      return;
    }
    const tp = parseFloat(triggerPrice);
    if (isNaN(tp)) { setError('Invalid trigger price'); return; }
    const sz = parseInt(size, 10);
    if (isNaN(sz) || sz <= 0) { setError('Invalid size'); return; }

    let bracket: ConditionBracket | undefined;
    if (bracketEnabled) {
      const sl = parseFloat(slPoints);
      const tpPts = parseFloat(tpPoints);
      bracket = {
        enabled: true,
        sl: !isNaN(sl) && sl > 0 ? { points: sl } : undefined,
        tp: !isNaN(tpPts) && tpPts > 0 ? [{ points: tpPts }] : undefined,
      };
    }

    const payload: CreateConditionInput = {
      contractId: contract.id,
      contractTickSize: contract.tickSize,
      conditionType,
      triggerPrice: tp,
      timeframe,
      orderSide,
      orderType,
      orderPrice: orderType === 'limit' ? parseFloat(orderPrice) : undefined,
      orderSize: sz,
      accountId: activeAccountId,
      bracket,
      expiresAt: undefined,
      label: label || undefined,
    };

    setError(null);
    setLoading(true);
    try {
      if (editingConditionId) {
        const patch: PatchConditionInput = { ...payload };
        const updated = await conditionService.update(serverUrl, editingConditionId, patch);
        upsertCondition(updated);
        addToast({ type: 'success', message: 'Condition updated' });
      } else {
        const created = await conditionService.create(serverUrl, payload);
        upsertCondition(created);
        addToast({ type: 'success', message: 'Condition armed' });
      }
      closeConditionModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  const inp = INPUT_SURFACE;
  const fieldLabel = 'block text-[11px] text-(--color-text-medium)';
  const sectionLabel = 'text-[10px] uppercase tracking-wider text-(--color-text-dim) font-medium';

  return (
    <Modal onClose={closeConditionModal} className="w-[440px] rounded-xl bg-(--color-surface) border border-(--color-border) shadow-2xl max-h-[85vh] flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between shrink-0" style={{ padding: '20px 28px 16px' }}>
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-bold text-white">
              {editingConditionId ? 'Edit Condition' : 'New Condition'}
            </span>
            {contract && (
              <span className="text-[11px] font-medium text-(--color-accent) bg-(--color-accent)/15 rounded-md" style={{ padding: '2px 10px' }}>
                {contract.name?.split(' ')[0] ?? contract.id}
              </span>
            )}
          </div>
          <button
            onClick={closeConditionModal}
            className="text-(--color-text-muted) hover:text-(--color-text) transition-colors text-base leading-none"
          >
            ✕
          </button>
        </div>

        {/* ── Body ── */}
        <div className="overflow-auto flex-1" style={{ padding: '0 28px 20px' }}>

          {/* ─── TRIGGER PARAMETERS ─── */}
          <div className="border-t border-(--color-border)" style={{ paddingTop: 20, marginBottom: 16 }}>
            <div className={sectionLabel} style={{ marginBottom: 14 }}>Trigger Parameters</div>

            <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 14 }}>
              <div>
                <span className={fieldLabel} style={{ marginBottom: 6, display: 'block' }}>Condition</span>
                <CustomSelect
                  value={conditionType}
                  options={[
                    { value: 'closes_above', label: 'Close Above' },
                    { value: 'closes_below', label: 'Close Below' },
                  ]}
                  onChange={(v) => setConditionType(v as 'closes_above' | 'closes_below')}
                  bg="var(--color-bg)"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <span className={fieldLabel} style={{ marginBottom: 6, display: 'block' }}>Trigger Price</span>
                <input
                  type="number"
                  value={triggerPrice}
                  onChange={(e) => setTriggerPrice(e.target.value)}
                  step={contract?.tickSize ?? 0.25}
                  placeholder="0.00"
                  className={inp}
                  style={{ padding: '10px 12px' }}
                />
              </div>
            </div>

            <div>
              <span className={fieldLabel} style={{ marginBottom: 6, display: 'block' }}>Timeframe</span>
              <CustomSelect
                value={timeframe}
                options={ALL_TIMEFRAMES.map((tf) => ({ value: tf.label, label: tf.label }))}
                onChange={(v) => setTimeframe(v)}
                bg="var(--color-bg)"
                style={{ width: 'calc(50% - 6px)' }}
              />
            </div>
          </div>

          {/* ─── ORDER DETAILS ─── */}
          <div className="border-t border-(--color-border)" style={{ paddingTop: 20, marginBottom: 16 }}>
            <div className={sectionLabel} style={{ marginBottom: 14 }}>Order Details</div>

            {/* Side */}
            <div className="flex gap-2" style={{ marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => setOrderSide('buy')}
                className={`flex-1 text-[13px] font-semibold rounded-lg transition-colors ${
                  orderSide === 'buy'
                    ? 'bg-(--color-btn-buy) text-white'
                    : 'bg-(--color-bg) text-(--color-text-muted) border border-(--color-border) hover:text-(--color-text)'
                }`}
                style={{ padding: '10px 0' }}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setOrderSide('sell')}
                className={`flex-1 text-[13px] font-semibold rounded-lg transition-colors ${
                  orderSide === 'sell'
                    ? 'bg-(--color-btn-sell) text-white'
                    : 'bg-(--color-bg) text-(--color-text-muted) border border-(--color-border) hover:text-(--color-text)'
                }`}
                style={{ padding: '10px 0' }}
              >
                Sell
              </button>
            </div>

            {/* Order type + Size */}
            <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 14 }}>
              <div>
                <span className={fieldLabel} style={{ marginBottom: 6, display: 'block' }}>Order Type</span>
                <CustomSelect
                  value={orderType}
                  options={[
                    { value: 'market', label: 'Market' },
                    { value: 'limit', label: 'Limit' },
                  ]}
                  onChange={(v) => setOrderType(v as 'market' | 'limit')}
                  bg="var(--color-bg)"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <span className={fieldLabel} style={{ marginBottom: 6, display: 'block' }}>Size</span>
                <input
                  type="number"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  min={1}
                  step={1}
                  className={inp}
                  style={{ padding: '10px 12px' }}
                />
              </div>
            </div>

            {/* Limit price (conditional) */}
            {orderType === 'limit' && (
              <div style={{ marginBottom: 14, width: 'calc(50% - 6px)' }}>
                <span className={fieldLabel} style={{ marginBottom: 6, display: 'block' }}>Limit Price</span>
                <input
                  type="number"
                  value={orderPrice}
                  onChange={(e) => setOrderPrice(e.target.value)}
                  step={contract?.tickSize ?? 0.25}
                  className={inp}
                  style={{ padding: '10px 12px' }}
                />
              </div>
            )}
          </div>

          {/* ─── Bracket toggle ─── */}
          <div
            className="flex items-center justify-between bg-(--color-bg) border border-(--color-border) rounded-lg"
            style={{ padding: '12px 14px', marginBottom: 16 }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-(--color-text) font-medium">Bracket (SL / TP)</span>
              <span className="text-(--color-text-muted) text-xs" title="Attach stop-loss and take-profit after fill">&#9432;</span>
            </div>
            <Toggle checked={bracketEnabled} onChange={setBracketEnabled} />
          </div>

          {bracketEnabled && (
            <div style={{ marginBottom: 16 }} className="space-y-3">
              {bracketPresets.length > 0 && (
                <div>
                  <span className={fieldLabel} style={{ marginBottom: 6, display: 'block' }}>Preset</span>
                  <CustomSelect
                    value={selectedPresetId ?? ''}
                    options={[
                      { value: '', label: 'Custom' },
                      ...bracketPresets.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                    onChange={(v) => {
                      const preset = bracketPresets.find((p) => p.id === v) ?? null;
                      applyPreset(preset);
                    }}
                    bg="var(--color-bg)"
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={fieldLabel} style={{ marginBottom: 6, display: 'block' }}>SL (points)</span>
                  <input
                    type="number"
                    value={slPoints}
                    onChange={(e) => { setSlPoints(e.target.value); setSelectedPresetId(null); }}
                    min={0}
                    step={contract?.tickSize ?? 0.25}
                    placeholder="e.g. 20"
                    className={inp}
                    style={{ padding: '10px 12px' }}
                  />
                </div>
                <div>
                  <span className={fieldLabel} style={{ marginBottom: 6, display: 'block' }}>TP (points)</span>
                  <input
                    type="number"
                    value={tpPoints}
                    onChange={(e) => { setTpPoints(e.target.value); setSelectedPresetId(null); }}
                    min={0}
                    step={contract?.tickSize ?? 0.25}
                    placeholder="e.g. 40"
                    className={inp}
                    style={{ padding: '10px 12px' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ─── Label ─── */}
          <div>
            <span className={fieldLabel} style={{ marginBottom: 6, display: 'block' }}>
              Label <span className="text-(--color-text-dim)">(Optional)</span>
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Breakout strategy"
              className={inp}
              style={{ padding: '10px 12px' }}
            />
          </div>

          {error && (
            <p className="text-[11px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2" style={{ marginTop: 12 }}>{error}</p>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex justify-end items-center gap-3 border-t border-(--color-border) shrink-0" style={{ padding: '18px 28px' }}>
          <button
            onClick={closeConditionModal}
            className="text-[13px] text-(--color-text-muted) hover:text-(--color-text) transition-colors"
            style={{ padding: '10px 20px' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !contract || activeAccountId == null}
            className="text-[13px] font-semibold rounded-lg bg-(--color-btn-buy) text-white hover:bg-(--color-btn-buy-hover) transition-colors disabled:opacity-50"
            style={{ padding: '10px 24px' }}
          >
            {loading ? 'Saving...' : editingConditionId ? 'Update Condition' : 'Arm Condition'}
          </button>
        </div>
    </Modal>
  );
}
