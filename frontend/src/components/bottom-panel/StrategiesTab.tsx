import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import type { LiveStrategyInfo } from '../../store/slices/liveStrategySlice';
import {
  listStrategies,
  startStrategy,
  stopStrategy,
  subscribeStrategies,
  testStrategySignal,
} from '../../services/liveStrategyService';
import { IS_DEMO } from '../../adapters/demo/index';
import { resolveConditionServerUrl } from '../../store/slices/conditionsSlice';
import { Z } from '../../constants/layout';
import { TABLE_ROW_STRIPE } from '../../constants/styles';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';

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
// Test signal modal
// ---------------------------------------------------------------------------

function TestSignalModal({ strategy, serverUrl, onClose }: { strategy: LiveStrategyInfo; serverUrl: string; onClose: () => void }) {
  const lastPrice = useStore((s) => s.lastPrice);

  const currentSignal = strategy.metadata?.signal;
  const defaultDir = currentSignal === 'short' ? 'short' : 'long';
  const [dir, setDir] = useState<'long' | 'short'>(defaultDir as 'long' | 'short');
  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);

  const cfg = strategy.metadata?.tradeConfig;
  const lastPollAt = strategy.metadata?.lastPollAt;

  const price = lastPrice ?? 0;
  const isLong = dir === 'long';
  const dirSign = isLong ? 1 : -1;

  const useTrailing = cfg ? (cfg.trailing_stop && cfg.trailing_dist_pts > 0) : false;
  const slPts = cfg ? (useTrailing ? cfg.trailing_dist_pts : cfg.sl_pts) : 0;
  const slPrice = cfg && !useTrailing && price > 0 ? price - dirSign * slPts : null;

  const targets = cfg
    ? (cfg.targets && cfg.targets.length > 0
        ? cfg.targets
        : cfg.tp_pts
          ? [{ tp_pts: cfg.tp_pts, contracts: cfg.total_contracts }]
          : [])
    : [];

  const fmt = (p: number) => p.toFixed(2);

  async function handleExecute() {
    setExecError(null);
    setExecuting(true);
    try {
      await testStrategySignal(serverUrl, strategy.id, dir);
      setPlaced(true);
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setExecuting(false);
    }
  }

  const ROW: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 0', borderBottom: '1px solid var(--color-border)',
  };
  const badge = (bg: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
    padding: '2px 5px', borderRadius: 3,
    background: bg, color: '#fff', flexShrink: 0, minWidth: 38,
  });
  const mono: React.CSSProperties = {
    fontFamily: 'var(--font-family-mono)', fontSize: 12,
  };

  return (
    <Modal
      onClose={onClose}
      title={`Test Signal — ${strategy.name}`}
      className="flex flex-col rounded-xl bg-(--color-surface) border border-(--color-border)"
      style={{ width: 400 }}
    >
      {/* Direction toggle */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)' }}>
        <Button
          variant="ghost"
          style={{
            flex: 1, borderRadius: 0, height: 36, fontSize: 12, fontWeight: 600,
            border: 'none',
            borderBottom: isLong ? '2px solid var(--color-buy)' : '2px solid transparent',
            color: isLong ? 'var(--color-buy)' : undefined,
          }}
          onClick={() => setDir('long')}
        >
          ▲ LONG
        </Button>
        <Button
          variant="ghost"
          style={{
            flex: 1, borderRadius: 0, height: 36, fontSize: 12, fontWeight: 600,
            border: 'none',
            borderBottom: !isLong ? '2px solid var(--color-sell)' : '2px solid transparent',
            color: !isLong ? 'var(--color-sell)' : undefined,
          }}
          onClick={() => setDir('short')}
        >
          ▼ SHORT
        </Button>
      </div>

      {/* Body */}
      <div style={{ padding: '14px 20px' }}>
        {!cfg ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '12px 0' }}>
            No config cached yet — wait for the strategy to complete its first poll.
          </p>
        ) : (
          <>
            {/* Meta row: current price + staleness */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontSize: 11, color: 'var(--color-text-muted)' }}>
              <span>
                Current price:{' '}
                <span style={{ ...mono, color: 'var(--color-text-medium)' }}>
                  {price > 0 ? fmt(price) : '—'}
                </span>
              </span>
              {lastPollAt && (
                <span title={lastPollAt}>
                  Config at {new Date(lastPollAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
            </div>

            {/* Entry */}
            <div style={ROW}>
              <span style={badge('var(--color-accent)')}>ENTRY</span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>
                Market{' '}
                <span style={{ color: 'var(--color-text-medium)' }}>×</span>{' '}
                <strong>{cfg.total_contracts}</strong> ct
              </span>
              <span style={{ ...mono, color: 'var(--color-text-medium)' }}>
                {price > 0 ? `~${fmt(price)}` : '—'}
              </span>
            </div>

            {/* Stop Loss */}
            <div style={ROW}>
              <span style={badge('var(--color-sell)')}>SL</span>
              {useTrailing ? (
                <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>
                  Trailing <strong>{slPts}</strong> pts
                  <span style={{ ...mono, color: 'var(--color-text-dim)', fontSize: 11, marginLeft: 6 }}>
                    ({slPts * 4} tks)
                  </span>
                </span>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>
                    <strong>{slPts}</strong> pts
                  </span>
                  <span style={{ ...mono, color: 'var(--color-sell)' }}>
                    {price > 0 && slPrice !== null ? fmt(slPrice) : '—'}
                  </span>
                </>
              )}
            </div>

            {/* Take Profit levels */}
            {targets.map((t, i) => {
              const tpPrice = price > 0 ? price + dirSign * t.tp_pts : null;
              return (
                <div key={i} style={{ ...ROW, borderBottom: i === targets.length - 1 ? 'none' : ROW.borderBottom }}>
                  <span style={badge('var(--color-buy)')}>TP{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>
                    <strong>{t.tp_pts}</strong> pts
                    <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>
                      × <strong>{t.contracts}</strong> ct
                    </span>
                  </span>
                  <span style={{ ...mono, color: 'var(--color-buy)' }}>
                    {tpPrice !== null ? fmt(tpPrice) : '—'}
                  </span>
                </div>
              );
            })}

            {targets.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--color-text-dim)', paddingTop: 6 }}>
                No TP targets in current config
              </p>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid var(--color-border)', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        {execError && (
          <span style={{ flex: 1, fontSize: 11, color: 'var(--color-sell)' }}>{execError}</span>
        )}
        {placed && !execError && (
          <span style={{ flex: 1, fontSize: 11, color: 'var(--color-buy)' }}>✓ Order placed</span>
        )}
        <Button variant="ghost" onClick={onClose} style={{ fontSize: 12 }}>
          Close
        </Button>
        {cfg && !placed && (
          <Button
            variant="filled"
            onClick={handleExecute}
            disabled={executing}
            style={{ fontSize: 12, opacity: executing ? 0.6 : 1 }}
          >
            {executing ? 'Placing…' : `Execute ${dir === 'long' ? '▲ Long' : '▼ Short'}`}
          </Button>
        )}
        {placed && (
          <Button variant="ghost" onClick={() => { setPlaced(false); setExecError(null); }} style={{ fontSize: 12 }}>
            Reset
          </Button>
        )}
      </div>
    </Modal>
  );
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

  const rowLabel: React.CSSProperties = {
    fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap', width: 100, flexShrink: 0,
  };
  const btnBase: React.CSSProperties = {
    fontSize: 13, padding: '5px 16px', borderRadius: 4, cursor: 'pointer',
    transition: 'background var(--transition-fast)',
  };
  const canStart = !loading && !!accountId && !!contractId;

  return (
    <Modal
      onClose={onClose}
      className="flex flex-col rounded-xl bg-(--color-surface) border border-(--color-border)"
      style={{ width: 380 }}
      title={`Start — ${strategy.name}`}
    >

        {/* Body */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={rowLabel}>Account</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              style={{ flex: 1, background: 'var(--color-input)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', fontSize: 13, cursor: 'pointer', outline: 'none' }}
            >
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
              {accounts.length === 0 && <option value="" disabled>No accounts</option>}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={rowLabel}>Contract ID</span>
            <input type="text" value={contractId} onChange={(e) => setContractId(e.target.value)}
              style={{ flex: 1, background: 'var(--color-input)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 8px', fontSize: 13, outline: 'none' }}
              placeholder="CON.F.US.MNQ..."
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={rowLabel}>Contract Name</span>
            <input type="text" value={contractName} onChange={(e) => setContractName(e.target.value)}
              style={{ flex: 1, background: 'var(--color-input)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 8px', fontSize: 13, outline: 'none' }}
              placeholder="e.g. MNQ Sep 2025"
            />
          </div>

          {error && <span style={{ fontSize: 11, color: 'var(--color-sell)' }}>{error}</span>}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '8px 16px', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button onClick={onClose} disabled={loading} style={{ ...btnBase, background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover-toolbar)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface)'; }}>
            Cancel
          </button>
          <button onClick={handleStart} disabled={!canStart} style={{ ...btnBase, background: 'var(--color-label-close)', color: 'var(--color-label-text)', border: 'none', opacity: canStart ? 1 : 0.5 }}
            onMouseEnter={(e) => { if (canStart) e.currentTarget.style.background = 'var(--color-label-close-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-label-close)'; }}>
            {loading ? 'Starting…' : 'Start Strategy'}
          </button>
        </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

const cols = 'grid-cols-[1.5fr_1.2fr_1.2fr_0.6fr_0.7fr]';

export function StrategiesTab() {
  const liveStrategies = useStore((s) => s.liveStrategies);
  const setLiveStrategies = useStore((s) => s.setLiveStrategies);
  const updateLiveStrategy = useStore((s) => s.updateLiveStrategy);
  const serverUrl = useStore((s) => resolveConditionServerUrl(s.conditionServerUrl));

  const [actionId, setActionId] = useState<string | null>(null);
  const [configStrategy, setConfigStrategy] = useState<LiveStrategyInfo | null>(null);
  const [testStrategy, setTestStrategy] = useState<LiveStrategyInfo | null>(null);
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
              <div className="px-3 flex items-center justify-center gap-1">
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
                {canStop && !isTransitioning(strategy.state) && strategy.metadata?.tradeConfig && (
                  <button
                    onClick={() => setTestStrategy(strategy)}
                    className="flex items-center justify-center rounded-full text-(--color-text-muted) opacity-60 hover:opacity-100 hover:text-(--color-warning) hover:bg-(--color-border)/30 transition-all cursor-pointer"
                    style={{ width: 22, height: 22 }}
                    title="Preview signal orders"
                  >
                    {/* Flask / test icon */}
                    <svg width="11" height="12" viewBox="0 0 20 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 3h6M7 3v8L2 19h16L13 11V3" />
                      <circle cx="6.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
                      <circle cx="10" cy="14" r="1" fill="currentColor" stroke="none" />
                    </svg>
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

      {/* Test signal modal */}
      {testStrategy && (
        <TestSignalModal
          strategy={testStrategy}
          serverUrl={serverUrl}
          onClose={() => setTestStrategy(null)}
        />
      )}
    </div>
  );
}
