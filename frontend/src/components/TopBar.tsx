import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronDown } from './icons/ChevronDown';
import { accountService } from '../services/accountService';
import { realtimeService } from '../services/realtimeService';
import type { RealtimeAccount } from '../services/realtimeService';
import { PositionType } from '../types/enums';
import { calcPnl } from '../utils/instrument';
import { getPnlColorClass } from '../utils/formatters';
import { useClickOutside } from '../hooks/useClickOutside';
import type { Trade } from '../services/tradeService';
import { useStore } from '../store/useStore';

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

function aggregatePnl(trades: Trade[]): { pnl: number; fees: number } {
  let pnl = 0;
  let fees = 0;
  for (const t of trades) {
    if (!t.voided) {
      pnl += t.profitAndLoss ?? 0;
      fees += t.fees ?? 0;
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
  })));

  const { pnl: realizedPnl, fees: realizedFees } = useMemo(() => aggregatePnl(sessionTrades), [sessionTrades]);

  // Auto-select first account when accounts load, or if persisted ID is stale
  useEffect(() => {
    if (accounts.length === 0) return;
    if (activeAccountId === null || !accounts.find((a) => a.id === activeAccountId)) {
      setActiveAccountId(accounts[0].id);
    }
  }, [accounts, activeAccountId, setActiveAccountId]);

  // Reload accounts when connection state becomes true
  useEffect(() => {
    if (connected) {
      accountService.searchAccounts().then((a) => useStore.getState().setAccounts(a)).catch(() => {});
    } else {
      useStore.getState().setAccounts([]);
    }
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
  const [privacyOn, setPrivacyOn] = useState(true);
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
    <header className="flex items-center h-10 bg-black border-b border-(--color-border) shrink-0">
      {/* Left — account selector + privacy toggle */}
      <div className="flex items-center gap-2 w-48 shrink-0" style={{ marginLeft: '16px' }}>
        {accounts.length > 0 ? (
          <div ref={acctRef} className="relative">
            <button
              onClick={() => setAcctOpen((o) => !o)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-(--color-text) font-medium hover:bg-(--color-surface) transition-colors cursor-pointer"
            >
              <span>{(() => {
                const name = activeAccount?.name ?? '';
                return privacyOn && name.length > 7 ? name.slice(0, 7) + '***' : name;
              })()}</span>
              <ChevronDown />
            </button>
            {acctOpen && (
              <div
                className="absolute top-full left-0 mt-1 bg-black border border-(--color-border) rounded-lg shadow-lg z-50 py-1 animate-dropdown-in"
                style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.4)', minWidth: 160 }}
              >
                {accounts.map((a) => {
                  const display = privacyOn && a.name.length > 7
                    ? a.name.slice(0, 7) + '***'
                    : a.name;
                  const active = a.id === activeAccountId;
                  return (
                    <button
                      key={a.id}
                      onClick={() => { setActiveAccountId(a.id); setAcctOpen(false); }}
                      className={`w-full text-left text-xs font-medium px-3 py-1.5 transition-colors rounded-md mx-0 hover:bg-(--color-surface) ${
                        active ? 'text-(--color-warning)' : 'text-(--color-text)'
                      }`}
                    >
                      {display}
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
          onClick={() => setPrivacyOn((p) => !p)}
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
          <span className="text-xs text-(--color-text-muted)">
            Balance: ${((activeAccount.balance ?? 0) + unrealizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-xs text-(--color-text-muted)">
            RP&L: {(() => { const net = realizedPnl - realizedFees; return (
              <span className={getPnlColorClass(net)}>
                {net > 0 ? '+' : ''}{net.toFixed(2)} $
              </span>
            ); })()}
          </span>
          <span className="text-xs text-(--color-text-muted)">
            UP&L: <span className={getPnlColorClass(unrealizedPnl)}>
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

        {/* Latency */}
        {connected && latency !== null && (
          <div className="flex items-center gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: latency < 50 ? 'var(--color-buy)' : latency < 150 ? 'var(--color-warning)' : 'var(--color-sell)' }}
            />
            <span className="text-xs" style={{ color: latency < 50 ? 'var(--color-buy)' : latency < 150 ? 'var(--color-warning)' : 'var(--color-sell)' }}>
              {latency}ms
            </span>
          </div>
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
