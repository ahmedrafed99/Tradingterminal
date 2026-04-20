import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronDown } from './icons/ChevronDown';
import { realtimeService } from '../services/realtimeService';
import type { RealtimeAccount } from '../services/realtimeService';
import { PositionType } from '../types/enums';
import { calcPnl } from '../utils/instrument';
import { getPnlColorClass } from '../utils/formatters';
import { useClickOutside } from '../hooks/useClickOutside';
import type { Trade } from '../services/tradeService';
import { useStore } from '../store/useStore';
import { SHADOW, Z } from '../constants/layout';
import { metricCollector } from '../services/monitor/metricCollector';
import { MonitorPanel } from './monitor/MonitorPanel';
import type { NodeState } from '../services/monitor/types';

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}




function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function FollowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 46.032 46.033" fill="currentColor">
      <path d="M45.973,31.64c-1.396-5.957-5.771-14.256-18.906-16.01v-5.252c0-1.095-0.664-2.082-1.676-2.5c-0.334-0.138-0.686-0.205-1.033-0.205c-0.705,0-1.398,0.276-1.917,0.796L10.49,20.479c-1.396,1.402-1.396,3.669-0.001,5.073l11.95,12.009c0.517,0.521,1.212,0.797,1.92,0.797c0.347,0,0.697-0.066,1.031-0.205c1.012-0.418,1.676-1.404,1.676-2.5V30.57c4.494,0.004,10.963,0.596,15.564,3.463c0.361,0.225,0.77,0.336,1.176,0.336c0.457,0,0.91-0.139,1.297-0.416C45.836,33.429,46.18,32.515,45.973,31.64z" />
    </svg>
  );
}

/** Format TopstepX account names into { label, id } for selective privacy blur */
function formatAccountName(raw: string): { label: string; id: string } {
  // Practice accounts: "PRAC..." → "Practice" + id
  if (/^prac/i.test(raw)) {
    const id = raw.split('-').pop() ?? raw;
    return { label: 'Practice', id };
  }
  // Combine accounts: "$50K TRADING COMBINE | 50KTC-V2-..." or just "50KTC-V2-..."
  const combineMatch = raw.match(/\$?(\d+)K\s*(?:TRADING\s*COMBINE)?/i) ?? raw.match(/^(\d+)KTC/i);
  if (combineMatch) {
    const size = combineMatch[1];
    const id = raw.split('-').pop() ?? raw;
    return { label: `${size}K Trading Combine`, id };
  }
  // Fallback: treat whole name as label
  return { label: raw, id: '' };
}

function aggregatePnl(trades: Trade[]): { pnl: number; fees: number } {
  let pnl = 0;
  let fees = 0;
  for (const t of trades) {
    if (!t.voided) {
      pnl += t.profitAndLoss ?? 0;
      fees += (t.fees ?? 0) + (t.commissions ?? 0);
    }
  }
  return { pnl, fees };
}

export function TopBar() {
  const {
    connected,
    accounts,
    activeAccountId,
    setAccounts,
    setActiveAccountId,
    setSettingsOpen,
    updateAccount,
    positions,
    lastPrice,
    orderContract,
    sessionTrades,
    hideAccountName,
    hideBalance,
    hideRpnl,
    hideUpnl,
    setHideAccountName,
    setHideBalance,
    setHideRpnl,
    setHideUpnl,
    copyEnabled,
    copyMasterAccountId,
    copyFollowerIds,
  } = useStore(useShallow((s) => ({
    connected: s.connected,
    accounts: s.accounts,
    activeAccountId: s.activeAccountId,
    setAccounts: s.setAccounts,
    setActiveAccountId: s.setActiveAccountId,
    setSettingsOpen: s.setSettingsOpen,
    updateAccount: s.updateAccount,
    positions: s.positions,
    lastPrice: s.lastPrice,
    orderContract: s.orderContract,
    sessionTrades: s.sessionTrades,
    hideAccountName: s.hideAccountName,
    hideBalance: s.hideBalance,
    hideRpnl: s.hideRpnl,
    hideUpnl: s.hideUpnl,
    setHideAccountName: s.setHideAccountName,
    setHideBalance: s.setHideBalance,
    setHideRpnl: s.setHideRpnl,
    setHideUpnl: s.setHideUpnl,
    copyEnabled: s.copyEnabled,
    copyMasterAccountId: s.copyMasterAccountId,
    copyFollowerIds: s.copyFollowerIds,
  })));

  function getCopyRole(accountId: string): 'master' | 'follower' | null {
    if (!copyEnabled) return null;
    if (accountId === copyMasterAccountId) return 'master';
    if (copyFollowerIds.includes(accountId)) return 'follower';
    return null;
  }

  const { pnl: realizedPnl, fees: realizedFees } = useMemo(() => aggregatePnl(sessionTrades), [sessionTrades]);

  // Auto-select first account when accounts load, or if persisted ID is stale
  useEffect(() => {
    if (accounts.length === 0) return;
    if (activeAccountId === null || !accounts.find((a) => a.id === activeAccountId)) {
      setActiveAccountId(accounts[0].id);
    }
  }, [accounts, activeAccountId, setActiveAccountId]);

  // Clear accounts on disconnect (accounts are loaded by SettingsModal on connect
  // and by App on page refresh via getStatus + searchAccounts)
  useEffect(() => {
    if (!connected) useStore.getState().setAccounts([]);
  }, [connected]);


  // Live balance updates via SignalR
  useEffect(() => {
    if (!connected) return;
    const handler = (account: RealtimeAccount) => {
      updateAccount({ id: account.id, balance: account.balance });
    };
    realtimeService.onAccount(handler);
    return () => { realtimeService.offAccount(handler); };
  }, [connected, updateAccount]);

  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const privacyOn = hideAccountName;
  const [acctOpen, setAcctOpen] = useState(false);
  const acctRef = useRef<HTMLDivElement>(null);
  const closeAcctDropdown = useCallback(() => setAcctOpen(false), []);
  useClickOutside(acctRef, acctOpen, closeAcctDropdown);

  // Latency ping (every 5s when connected)
  const [latency, setLatency] = useState<number | null>(null);
  useEffect(() => {
    if (!connected) { setLatency(null); return; }
    let cancelled = false;
    const measure = async () => {
      const ms = await realtimeService.ping();
      if (!cancelled && ms >= 0) setLatency(ms);
    };
    measure();
    const id = setInterval(measure, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [connected]);

  // Monitor collector — start when connected, stop on disconnect
  useEffect(() => {
    if (connected) {
      metricCollector.start();
    } else {
      metricCollector.stop();
    }
    return () => { metricCollector.stop(); };
  }, [connected]);

  // Monitor panel
  const [monitorOpen, setMonitorOpen] = useState(false);
  const latencyRef = useRef<HTMLDivElement>(null);

  const monitorSnapshot = useSyncExternalStore(
    (cb) => metricCollector.subscribe(cb),
    () => metricCollector.getSnapshot(),
  );

  const worstState: NodeState = monitorSnapshot.worstState ?? 'normal';
  const monitorDotColor = worstState === 'frozen' ? 'var(--color-sell)' : worstState === 'degraded' ? 'var(--color-warning)' : 'var(--color-buy)';

  // Compute unrealized P&L from open positions (sticky ref — retains last valid value)
  const upnlRef = useRef(0);
  if (activeAccountId != null && orderContract && lastPrice != null) {
    let pnl = 0;
    for (const pos of positions) {
      if (pos.accountId === activeAccountId && pos.size !== 0 && String(pos.contractId) === String(orderContract.id)) {
        const isLong = pos.type === PositionType.Long;
        const diff = isLong ? lastPrice - pos.averagePrice : pos.averagePrice - lastPrice;
        pnl += calcPnl(diff, orderContract, pos.size);
      }
    }
    upnlRef.current = pnl;
  } else if (!positions.some((p) => p.accountId === activeAccountId && p.size !== 0)) {
    // No open position → reset to 0
    upnlRef.current = 0;
  }
  const unrealizedPnl = upnlRef.current;

  return (
    <header className="flex items-center h-10 bg-(--color-panel) border-b border-(--color-border) shrink-0">
      {/* Left — account selector + privacy toggle */}
      <div className="flex items-center gap-2 shrink-0" style={{ marginLeft: '16px' }}>
        {accounts.length > 0 ? (
          <div ref={acctRef} className="relative">
            <button
              onClick={() => setAcctOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-md text-xs text-(--color-text) font-medium hover:bg-(--color-surface) transition-colors cursor-pointer"
              style={{ padding: '6px 10px' }}
            >
              <span style={{ display: 'inline-flex', gap: 4, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(() => { const { label, id } = formatAccountName(activeAccount?.name ?? ''); return (<>
                  <span>{label}</span>
                  {id && <span style={{ transition: 'opacity var(--transition-normal) ease, filter var(--transition-normal) ease', opacity: privacyOn ? 0.4 : 1, filter: privacyOn ? 'blur(5px)' : 'none', userSelect: privacyOn ? 'none' : 'auto' }}>- {id}</span>}
                </>); })()}
              </span>
              {activeAccount && getCopyRole(activeAccount.id) && (
                <span
                  className={`text-xs font-semibold flex items-center gap-1 ${
                    getCopyRole(activeAccount.id) === 'master' ? 'text-(--color-role-master)' : 'text-(--color-role-follower)'
                  }`}
                  style={{ marginLeft: 16 }}
                >
                  {getCopyRole(activeAccount.id) === 'master' ? 'Master' : 'Follower'}
                  {getCopyRole(activeAccount.id) === 'follower' && <FollowIcon />}
                </span>
              )}
              <ChevronDown />
            </button>
            {acctOpen && (
              <div
                className="absolute top-full left-0 mt-1 bg-(--color-panel) border border-(--color-border) rounded-lg shadow-lg animate-dropdown-in"
                style={{ zIndex: Z.DROPDOWN, boxShadow: SHADOW.LG, padding: '4px 5px', whiteSpace: 'nowrap', display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 20 }}
              >
                {accounts.map((a) => {
                  const active = a.id === activeAccountId;
                  const role = getCopyRole(a.id);
                  return (
                    <button
                      key={a.id}
                      onClick={() => { setActiveAccountId(a.id); setAcctOpen(false); }}
                      className={`text-left text-xs font-medium transition-colors rounded-lg hover:bg-(--color-hover-row) flex items-center gap-3 ${
                        active ? 'text-(--color-warning)' : 'text-(--color-text)'
                      }`}
                      style={{ padding: '7px 10px', gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'subgrid', ...(active ? { backgroundColor: '#0d0d0d' } : {}) }}
                    >
                      <span>
                        {(() => { const { label, id } = formatAccountName(a.name); return (<>
                          <span>{label}</span>
                          {id && <span style={{ transition: 'opacity var(--transition-normal) ease, filter var(--transition-normal) ease', opacity: privacyOn ? 0.4 : 1, filter: privacyOn ? 'blur(5px)' : 'none', userSelect: privacyOn ? 'none' : 'auto' }}> - {id}</span>}
                        </>); })()}
                      </span>
                      {role ? (
                        <span
                          className={`text-xs font-semibold flex items-center gap-1 ${
                            role === 'master' ? 'text-(--color-role-master)' : 'text-(--color-role-follower)'
                          }`}
                          style={{ marginLeft: 16 }}
                        >
                          {role === 'master' ? 'Master' : 'Follower'}
                          {role === 'follower' && <FollowIcon />}
                        </span>
                      ) : <span />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs text-(--color-text-dim)">No accounts</span>
        )}
        <button
          onClick={() => setHideAccountName(!hideAccountName)}
          className="text-(--color-text-muted) hover:text-white transition-colors p-0.5 rounded"
          title={privacyOn ? 'Show full account info' : 'Hide account info'}
        >
          {privacyOn ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Centre — balance + UP&L */}
      {activeAccount && (
        <div className="flex items-center gap-3">
          <span
            className="text-xs text-(--color-text-muted) cursor-pointer select-none transition-colors hover:text-(--color-text)"
            onClick={() => setHideBalance(!hideBalance)}
            title={hideBalance ? 'Show balance' : 'Hide balance'}
          >

            Balance: <span style={{ display: 'inline-block', transition: 'opacity var(--transition-normal) ease, filter var(--transition-normal) ease', opacity: hideBalance ? 0.4 : 1, filter: hideBalance ? 'blur(5px)' : 'none', userSelect: hideBalance ? 'none' : 'auto' }}>
              ${((activeAccount.balance ?? 0) + unrealizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </span>
          <span
            className="text-xs text-(--color-text-muted) cursor-pointer select-none transition-colors hover:text-(--color-text)"
            onClick={() => setHideRpnl(!hideRpnl)}
            title={hideRpnl ? 'Show RP&L' : 'Hide RP&L'}
          >

            RP&L: {(() => { const net = realizedPnl - realizedFees; return (
              <span className={getPnlColorClass(net)} style={{ display: 'inline-block', transition: 'opacity var(--transition-normal) ease, filter var(--transition-normal) ease', opacity: hideRpnl ? 0.4 : 1, filter: hideRpnl ? 'blur(5px)' : 'none', userSelect: hideRpnl ? 'none' : 'auto' }}>
                {net > 0 ? '+' : ''}{net.toFixed(2)} $
              </span>
            ); })()}
          </span>
          <span
            className="text-xs text-(--color-text-muted) cursor-pointer select-none transition-colors hover:text-(--color-text)"
            onClick={() => setHideUpnl(!hideUpnl)}
            title={hideUpnl ? 'Show UP&L' : 'Hide UP&L'}
          >

            UP&L: <span className={getPnlColorClass(unrealizedPnl)} style={{ display: 'inline-block', transition: 'opacity var(--transition-normal) ease, filter var(--transition-normal) ease', opacity: hideUpnl ? 0.4 : 1, filter: hideUpnl ? 'blur(5px)' : 'none', userSelect: hideUpnl ? 'none' : 'auto' }}>
              {unrealizedPnl > 0 ? '+' : ''}{unrealizedPnl.toFixed(2)} $
            </span>
          </span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right — status + settings */}
      <div className="flex items-center justify-end gap-3 w-48 shrink-0" style={{ marginRight: '16px' }}>
        {/* Connection status pill */}
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`}
          />
          <span className="text-xs text-(--color-text-muted)">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>

        {/* Latency + monitor entry point */}
        {connected && latency !== null && (
          <div
            ref={latencyRef}
            onClick={() => setMonitorOpen((o) => !o)}
            className="flex items-center gap-1 cursor-pointer rounded"
            style={{ padding: '3px 5px', transition: 'background var(--transition-fast)' }}
            title="Open system monitor"
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: monitorDotColor, transition: 'background-color 0.5s' }}
            />
            <span className="text-xs" style={{
              color: latency < 50 ? 'var(--color-buy)' : latency < 150 ? 'var(--color-warning)' : 'var(--color-sell)',
            }}>
              {latency}ms
            </span>
            {worstState !== 'normal' && (
              <span style={{ fontSize: 10, color: 'var(--color-warning)', marginLeft: 1 }}>⚠</span>
            )}
          </div>
        )}
        {monitorOpen && connected && (
          <MonitorPanel
            anchorRef={latencyRef}
            onClose={() => setMonitorOpen(false)}
          />
        )}

        {/* Settings icon */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="text-(--color-text-muted) hover:text-white transition-colors p-1 rounded"
          title="API Settings"
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
