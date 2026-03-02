import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { realtimeService } from '../../services/realtimeService';
import type { Trade } from '../../services/tradeService';
import { tradeService } from '../../services/tradeService';
import { useStore } from '../../store/useStore';
import { getCmeSessionStart } from '../../utils/cmeSession';
import { buildEntryMap } from '../chart/TradeZonePrimitive';

type SortColumn = 'time' | 'side' | 'symbol' | 'qty' | 'entry' | 'exit' | 'pnl' | 'fees' | 'net';
type SortDir = 'asc' | 'desc';

function shortSymbol(contractId: string): string {
  const parts = contractId.split('.');
  if (parts.length >= 5) {
    const sym = parts[3];
    const expiry = parts[4];
    return sym + expiry.charAt(0) + expiry.slice(-1);
  }
  return contractId;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
  });
}

export function TradesTab() {
  const connected = useStore((s) => s.connected);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const sessionTrades = useStore((s) => s.sessionTrades);
  const setSessionTrades = useStore((s) => s.setSessionTrades);
  const visibleTradeIds = useStore((s) => s.visibleTradeIds);
  const toggleTradeVisibility = useStore((s) => s.toggleTradeVisibility);

  // Fetch trades on mount / account change
  useEffect(() => {
    if (!connected || activeAccountId == null) return;
    let cancelled = false;
    tradeService
      .searchTrades(activeAccountId, getCmeSessionStart())
      .then((trades) => {
        if (!cancelled) setSessionTrades(trades);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [connected, activeAccountId, setSessionTrades]);

  // Re-fetch on SignalR trade events (debounced 500ms)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!connected) return;
    const handler = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const acctId = useStore.getState().activeAccountId;
        if (acctId == null) return;
        tradeService
          .searchTrades(acctId, getCmeSessionStart())
          .then((trades) => useStore.getState().setSessionTrades(trades))
          .catch(() => {});
      }, 500);
    };
    realtimeService.onTrade(handler);
    return () => {
      realtimeService.offTrade(handler);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [connected]);

  const [sortCol, setSortCol] = useState<SortColumn>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = useCallback((col: SortColumn) => {
    if (col === sortCol) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }, [sortCol, sortDir]);

  // Build entry map and filter to closing trades, most recent first
  const entryMap = useMemo(() => buildEntryMap(sessionTrades), [sessionTrades]);
  const closingTrades = useMemo(
    () => [...sessionTrades].filter((t) => t.profitAndLoss != null && !t.voided).reverse(),
    [sessionTrades],
  );

  const sorted = useMemo(() => {
    const arr = [...closingTrades];
    const dir = sortDir === 'asc' ? 1 : -1;
    const em = entryMap;

    const getValue = (t: Trade): number | string => {
      switch (sortCol) {
        case 'time': return t.creationTimestamp ?? '';
        case 'side': return t.side !== 0 ? 'Long' : 'Short';
        case 'symbol': return shortSymbol(t.contractId);
        case 'qty': return t.size;
        case 'entry': return em.get(t.id)?.price ?? 0;
        case 'exit': return t.price;
        case 'pnl': return t.profitAndLoss ?? 0;
        case 'fees': return t.fees;
        case 'net': return t.profitAndLoss! - t.fees;
      }
    };

    arr.sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
    return arr;
  }, [closingTrades, sortCol, sortDir, entryMap]);

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[#434651] text-xs">
        No trades this session
      </div>
    );
  }

  const cols = 'grid-cols-[1.2fr_0.7fr_1fr_0.5fr_1.2fr_1.2fr_1fr_0.7fr_1fr]';

  return (
    <div className="text-xs" style={{ fontFeatureSettings: '"tnum"' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black border-b border-[#2a2e39]">
        <div className={`grid ${cols} items-center h-8 text-[#787b86] pl-4`} style={{ width: '70%' }}>
          {([
            ['Time', 'time'],
            ['Side', 'side'],
            ['Symbol', 'symbol'],
            ['Qty', 'qty'],
            ['Entry', 'entry'],
            ['Exit', 'exit'],
            ['P&L', 'pnl'],
            ['Fees', 'fees'],
            ['Net', 'net'],
          ] as const).map(([label, col]) => {
            const active = sortCol === col;
            return (
              <div
                key={col}
                className={`px-3 text-center cursor-pointer select-none hover:text-[#d1d4dc] transition-colors ${active ? 'text-[#d1d4dc]' : ''}`}
                onClick={() => toggleSort(col)}
              >
                {label}
                {active && (
                  <span className="ml-0.5 text-[10px]">{sortDir === 'asc' ? ' \u25B2' : ' \u25BC'}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Rows */}
      {sorted.map((trade, i) => {
        const entry = entryMap.get(trade.id);
        // Closing side is the exit direction; entry is opposite
        const isLong = trade.side !== 0; // closed with sell → was long
        const net = trade.profitAndLoss! - trade.fees;
        const isVisible = visibleTradeIds.includes(trade.id);
        const stripe = i % 2 === 1 ? 'bg-[#0d1117]/40' : '';
        const selected = isVisible ? 'bg-[#2962ff]/15 border-l-2 border-l-[#2962ff]' : 'border-l-2 border-l-transparent';

        return (
          <div
            key={trade.id}
            className={`${stripe} ${selected} hover:bg-[#1e222d]/50 transition-colors cursor-pointer`}
            onClick={() => toggleTradeVisibility(trade.id)}
          >
            <div className={`grid ${cols} items-center h-7 pl-4`} style={{ width: '70%' }}>
              <div className="px-3 text-center text-[#787b86] whitespace-nowrap">
                {trade.creationTimestamp ? formatTime(trade.creationTimestamp) : '\u2014'}
              </div>
              <div className="px-3 text-center whitespace-nowrap">
                <span className={isLong ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                  {isLong ? 'Long' : 'Short'}
                </span>
              </div>
              <div className="px-3 text-center text-[#9598a1] whitespace-nowrap">
                {shortSymbol(trade.contractId)}
              </div>
              <div className="px-3 text-center text-[#d1d4dc]">{trade.size}</div>
              <div className="px-3 text-center text-[#d1d4dc] whitespace-nowrap">
                {entry ? entry.price.toFixed(2) : '\u2014'}
              </div>
              <div className="px-3 text-center text-[#d1d4dc] whitespace-nowrap">{trade.price.toFixed(2)}</div>
              <div className="px-3 text-center whitespace-nowrap">
                <span className={trade.profitAndLoss! > 0 ? 'text-[#26a69a]' : trade.profitAndLoss! < 0 ? 'text-[#ef5350]' : 'text-[#787b86]'}>
                  {trade.profitAndLoss! > 0 ? '+' : ''}{trade.profitAndLoss!.toFixed(2)}
                </span>
              </div>
              <div className="px-3 text-center text-[#787b86] whitespace-nowrap">
                {trade.fees.toFixed(2)}
              </div>
              <div className="px-3 text-center whitespace-nowrap">
                <span className={`font-medium ${net > 0 ? 'text-[#26a69a]' : net < 0 ? 'text-[#ef5350]' : 'text-[#787b86]'}`}>
                  {net > 0 ? '+' : ''}{net.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
