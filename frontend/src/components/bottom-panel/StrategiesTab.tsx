import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import type { LiveStrategyInfo } from '../../store/slices/liveStrategySlice';
import {
  listStrategies,
  startStrategy,
  stopStrategy,
  subscribeStrategies,
} from '../../services/liveStrategyService';
import { IS_DEMO } from '../../adapters/demo/index';
import { resolveConditionServerUrl } from '../../store/slices/conditionsSlice';
import { RADIUS, Z } from '../../constants/layout';
import { TABLE_ROW_STRIPE } from '../../constants/styles';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function StatusDot({ state }: { state: LiveStrategyInfo['state'] }) {
  const color =
    state === 'running'
      ? 'var(--color-buy)'
      : state === 'starting' || state === 'warming_up'
        ? 'var(--color-warning)'
        : state === 'error'
          ? 'var(--color-sell)'
          : 'var(--color-text-dim)';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

function StatusLabel({ strategy }: { strategy: LiveStrategyInfo }) {
  const { state, metadata, error } = strategy;
  if (state === 'running') {
    return <span style={{ color: 'var(--color-buy)' }}>Running</span>;
  }
  if (state === 'starting') {
    return <span style={{ color: 'var(--color-warning)' }}>Starting...</span>;
  }
  if (state === 'warming_up') {
    const n = metadata?.barCount ?? 0;
    return <span style={{ color: 'var(--color-warning)' }}>Warming up ({n} bars)</span>;
  }
  if (state === 'error') {
    const msg = error ? (error.length > 30 ? error.slice(0, 30) + '…' : error) : 'Error';
    return <span style={{ color: 'var(--color-sell)' }} title={error}>{msg}</span>;
  }
  return <span style={{ color: 'var(--color-text-dim)' }}>Stopped</span>;
}

function SignalCell({ strategy }: { strategy: LiveStrategyInfo }) {
  if (strategy.state !== 'running') return <span style={{ color: 'var(--color-text-dim)' }}>—</span>;
  const signal = strategy.metadata?.signal;
  const confidence = strategy.metadata?.confidence;
  const pct = confidence != null ? ` ${Math.round(confidence * 100)}%` : '';

  if (signal === 'long') {
    return (
      <span style={{ color: 'var(--color-buy)' }}>
        ▲ LONG{pct}
      </span>
    );
  }
  if (signal === 'short') {
    return (
      <span style={{ color: 'var(--color-sell)' }}>
        ▼ SHORT{pct}
      </span>
    );
  }
  if (signal === 'flat') {
    return <span style={{ color: 'var(--color-text-dim)' }}>— FLAT</span>;
  }
  return <span style={{ color: 'var(--color-text-dim)' }}>—</span>;
}

// ---------------------------------------------------------------------------
// Config modal
// ---------------------------------------------------------------------------

interface ConfigModalProps {
  strategy: LiveStrategyInfo;
  serverUrl: string;
  onClose: () => void;
  onStarted: (s: LiveStrategyInfo) => void;
}

function ConfigModal({ strategy, serverUrl, onClose, onStarted }: ConfigModalProps) {
  const accounts = useStore((s) => s.accounts);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const contract = useStore((s) => s.contract);

  const [accountId, setAccountId] = useState(activeAccountId ?? accounts[0]?.id ?? '');
  const [contractId, setContractId] = useState(contract?.id ?? '');
  const [contractName, setContractName] = useState(contract?.name ?? '');
  const tickSize = contract?.tickSize ?? 0.25;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setLoading(true);
    setError(null);
    try {
      const result = await startStrategy(serverUrl, strategy.id, {
        accountId,
        contractId,
        contractName: contractName || undefined,
        tickSize,
      });
      onStarted(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0"
        style={{ zIndex: (Z.MODAL ?? 200) - 1, background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
      />
      {/* Modal — matches Popover shell */}
      <div
        className="fixed bg-(--color-surface) border border-(--color-border) rounded-xl shadow-lg"
        style={{ zIndex: Z.MODAL ?? 200, width: 380, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 10px' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>
            Start — {strategy.name}
          </span>
          <button
            onClick={onClose}
            className="focus:outline-none"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: RADIUS.MD,
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--color-text-muted)',
              transition: 'background var(--transition-fast), color var(--transition-fast)',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover-row)'; e.currentTarget.style.color = 'var(--color-text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />

        {/* Body */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Account */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-(--color-text-medium)">Account</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full text-[13px] bg-(--color-input) border border-(--color-border) text-(--color-text) rounded-md focus:outline-none focus:border-(--color-text-dim) cursor-pointer"
              style={{ padding: '10px 12px' }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name || a.id}</option>
              ))}
              {accounts.length === 0 && <option value="" disabled>No accounts</option>}
            </select>
          </label>

          {/* Contract ID */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-(--color-text-medium)">Contract ID</span>
            <input
              type="text"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              className="w-full text-[13px] bg-(--color-input) border border-(--color-border) text-(--color-text) rounded-md focus:outline-none focus:border-(--color-text-dim)"
              style={{ padding: '10px 12px' }}
              placeholder="e.g. CON.F.US.MNQ..."
            />
          </label>

          {/* Contract Name */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-(--color-text-medium)">Contract Name</span>
            <input
              type="text"
              value={contractName}
              onChange={(e) => setContractName(e.target.value)}
              className="w-full text-[13px] bg-(--color-input) border border-(--color-border) text-(--color-text) rounded-md focus:outline-none focus:border-(--color-text-dim)"
              style={{ padding: '10px 12px' }}
              placeholder="e.g. MNQ Sep 2025"
            />
          </label>

          {error && (
            <span className="text-[11px] text-(--color-sell)">{error}</span>
          )}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />

        {/* Footer */}
        <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded disabled:opacity-50"
            style={{ fontSize: 13, padding: '5px 16px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text)', transition: 'background var(--transition-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover-toolbar)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface)'; }}
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={loading || !accountId || !contractId}
            className="rounded disabled:opacity-50"
            style={{ fontSize: 13, padding: '5px 16px', background: 'var(--color-label-close)', color: 'var(--color-label-text)', border: 'none', cursor: 'pointer', transition: 'background var(--transition-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-label-close-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-label-close)'; }}
          >
            {loading ? 'Starting…' : 'Start Strategy'}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

const cols = 'grid-cols-[1.5fr_1.2fr_1.2fr_0.6fr_0.4fr]';

export function StrategiesTab() {
  const liveStrategies = useStore((s) => s.liveStrategies);
  const setLiveStrategies = useStore((s) => s.setLiveStrategies);
  const updateLiveStrategy = useStore((s) => s.updateLiveStrategy);
  const serverUrl = useStore((s) => resolveConditionServerUrl(s.conditionServerUrl));

  const [actionId, setActionId] = useState<string | null>(null);
  const [configStrategy, setConfigStrategy] = useState<LiveStrategyInfo | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (IS_DEMO) return;

    listStrategies(serverUrl).then(setLiveStrategies).catch(() => {
      // silently fail — SSE snapshot will populate
    });

    const es = subscribeStrategies(serverUrl, {
      onSnapshot: setLiveStrategies,
      onUpdate: updateLiveStrategy,
    });
    esRef.current = es;

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [serverUrl, setLiveStrategies, updateLiveStrategy]);

  async function handleStop(strategy: LiveStrategyInfo) {
    setActionId(strategy.id);
    try {
      const updated = await stopStrategy(serverUrl, strategy.id);
      updateLiveStrategy(updated);
    } catch {
      // ignore
    } finally {
      setActionId(null);
    }
  }

  const isTransitioning = (state: LiveStrategyInfo['state']) =>
    state === 'starting' || state === 'warming_up';

  return (
    <div className="text-xs" style={{ fontFeatureSettings: '"tnum"' }}>
      {/* Header */}
      <div
        className="sticky top-0 bg-(--color-panel) border-b border-(--color-border)"
        style={{ zIndex: Z.HEADER }}
      >
        <div className={`grid ${cols} items-center h-8 text-(--color-text-muted) pl-4`} style={{ width: '70%' }}>
          <div style={{ paddingLeft: 24 }}>Name</div>
          <div className="px-3 text-center">Status</div>
          <div className="px-3 text-center">Signal</div>
          <div className="px-3 text-center">Bars</div>
          <div className="px-3 text-center"></div>
        </div>
      </div>

      {/* Empty state */}
      {liveStrategies.length === 0 && (
        <div
          className="flex items-center justify-center text-(--color-text-dim) text-xs"
          style={{ height: 120 }}
        >
          No strategies configured
        </div>
      )}

      {/* Rows */}
      {liveStrategies.map((strategy, i) => {
        const stripe = i % 2 === 1 ? TABLE_ROW_STRIPE : '';
        const canStart = strategy.state === 'stopped' || strategy.state === 'error';
        const canStop = !canStart;
        const busy = actionId === strategy.id;

        return (
          <div key={strategy.id} className={`${stripe} row-hover`}>
            <div className={`grid ${cols} items-center h-7 pl-4`} style={{ width: '70%' }}>
              {/* Name */}
              <div className="text-(--color-text) truncate" style={{ paddingLeft: 24 }} title={strategy.description}>
                {strategy.name}
              </div>

              {/* Status */}
              <div className="px-3 flex items-center justify-center gap-1.5">
                <StatusDot state={strategy.state} />
                <StatusLabel strategy={strategy} />
              </div>

              {/* Signal (includes confidence %) */}
              <div className="px-3 text-center">
                <SignalCell strategy={strategy} />
              </div>

              {/* Bar count */}
              <div className="px-3 text-center text-(--color-text-medium)">
                {strategy.metadata?.barCount != null ? strategy.metadata.barCount : '—'}
              </div>

              {/* Action */}
              <div className="px-3 flex items-center justify-center">
                {canStart && (
                  <button
                    onClick={() => setConfigStrategy(strategy)}
                    className="flex items-center justify-center rounded-full text-(--color-text-muted) opacity-70 hover:opacity-100 hover:text-(--color-buy) hover:bg-(--color-border)/30 transition-all cursor-pointer"
                    style={{ width: 22, height: 22 }}
                    title="Start"
                  >
                    ▶
                  </button>
                )}
                {canStop && (
                  <button
                    onClick={() => handleStop(strategy)}
                    disabled={busy}
                    className="flex items-center justify-center rounded-full text-(--color-sell) opacity-60 hover:opacity-100 hover:bg-(--color-border)/30 transition-all cursor-pointer disabled:opacity-50"
                    style={{ width: 22, height: 22 }}
                    title="Stop"
                  >
                    {busy || isTransitioning(strategy.state)
                      ? '…'
                      : <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect width="10" height="10" rx="1.5" /></svg>
                    }
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Config modal */}
      {configStrategy && (
        <ConfigModal
          strategy={configStrategy}
          serverUrl={serverUrl}
          onClose={() => setConfigStrategy(null)}
          onStarted={updateLiveStrategy}
        />
      )}
    </div>
  );
}
