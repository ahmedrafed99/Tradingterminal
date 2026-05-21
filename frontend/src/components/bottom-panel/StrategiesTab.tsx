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
import { Z } from '../../constants/layout';
import { TABLE_ROW_STRIPE } from '../../constants/styles';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

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

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={loading}>
        Cancel
      </Button>
      <Button
        variant="primary"
        onClick={handleStart}
        disabled={loading || !accountId || !contractId}
      >
        {loading ? 'Starting…' : 'Start Strategy'}
      </Button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Start — ${strategy.name}`}
      width={380}
      footer={footer}
    >
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
    </Modal>
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
