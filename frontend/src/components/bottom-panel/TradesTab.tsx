import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { realtimeService } from '../../services/realtimeService';
import type { Trade } from '../../services/tradeService';
import { tradeService } from '../../services/tradeService';
import { useStore } from '../../store/useStore';
import { OrderSide } from '../../types/enums';
import { getDateRange } from '../../utils/cmeSession';
import { buildEntryMap } from '../chart/TradeZonePrimitive';

type SortColumn = 'time' | 'side' | 'symbol' | 'qty' | 'entry' | 'exit' | 'pnl' | 'fees' | 'net' | 'duration';
type SortDir = 'asc' | 'desc';

interface TradeGroup {
  entryId: number;
  entry: Trade;
  exits: Trade[]; // sorted chronologically
  // aggregated values
  totalQty: number;
  totalPnl: number;
  totalFees: number;
  totalNet: number;
  earliestTime: string;
  latestTime: string;
  isLong: boolean;
}

function shortSymbol(contractId: string): string {
  const parts = contractId.split('.');
  if (parts.length >= 5) {
    const sym = parts[3];
    const expiry = parts[4];
    return sym + expiry.charAt(0) + expiry.slice(-1);
  }
  return contractId;
}

function formatTime(iso: string, showDate = false): string {
  const d = new Date(iso);
  if (showDate) {
    return d.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    });
  }
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
  });
}

function durationMs(entryIso: string, exitIso: string): number {
  return new Date(exitIso).getTime() - new Date(entryIso).getTime();
}

function formatDuration(ms: number): string {
  if (ms < 0) return '\u2014';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// In-memory cache for filtered presets, keyed by `accountId:preset`
const tradesCache = new Map<string, Trade[]>();

export function TradesTab() {
  const connected = useStore((s) => s.connected);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const visibleTradeIds = useStore((s) => s.visibleTradeIds);
  const toggleTradeVisibility = useStore((s) => s.toggleTradeVisibility);
  const toggleTradeVisibilityBulk = useStore((s) => s.toggleTradeVisibilityBulk);
  const tradesDatePreset = useStore((s) => s.tradesDatePreset);

  // Local state for display trades (decoupled from sessionTrades used for RPNL)
  const [displayTrades, setDisplayTrades] = useState<Trade[]>([]);

  const showDate = tradesDatePreset === 'week' || tradesDatePreset === 'month';

  // Fetch filtered trades for display (with cache)
  useEffect(() => {
    if (!connected || activeAccountId == null) return;
    let cancelled = false;

    const cacheKey = `${activeAccountId}:${tradesDatePreset}`;
    const cached = tradesCache.get(cacheKey);
    if (cached) {
      setDisplayTrades(cached);
      return;
    }

    const { startTimestamp, endTimestamp } = getDateRange(tradesDatePreset);
    tradeService
      .searchTrades(activeAccountId, startTimestamp, endTimestamp)
      .then((trades) => {
        if (cancelled) return;
        tradesCache.set(cacheKey, trades);
        setDisplayTrades(trades);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [connected, activeAccountId, tradesDatePreset]);

  // Re-fetch display trades on SignalR trade events (debounced 500ms)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!connected) return;
    const handler = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const state = useStore.getState();
        if (state.activeAccountId == null) return;
        // Invalidate cache & refresh display trades
        for (const key of tradesCache.keys()) {
          if (key.startsWith(`${state.activeAccountId}:`)) tradesCache.delete(key);
        }
        const { startTimestamp, endTimestamp } = getDateRange(state.tradesDatePreset);
        tradeService
          .searchTrades(state.activeAccountId, startTimestamp, endTimestamp)
          .then((trades) => {
            tradesCache.set(`${state.activeAccountId}:${state.tradesDatePreset}`, trades);
            setDisplayTrades(trades);
          })
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
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const toggleSort = useCallback((col: SortColumn) => {
    if (col === sortCol) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }, [sortCol, sortDir]);

  const toggleExpand = useCallback((entryId: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  // Build entry map and filter to closing trades
  const entryMap = useMemo(() => buildEntryMap(displayTrades), [displayTrades]);
  const closingTrades = useMemo(
    () => [...displayTrades].filter((t) => t.profitAndLoss != null && !t.voided).reverse(),
    [displayTrades],
  );

  // Group closing trades by their matched entry
  const groups = useMemo(() => {
    const byEntry = new Map<number, Trade[]>();
    const unmatched: Trade[] = [];

    for (const t of closingTrades) {
      const entry = entryMap.get(t.id);
      if (!entry) {
        unmatched.push(t);
        continue;
      }
      const key = entry.id;
      if (!byEntry.has(key)) byEntry.set(key, []);
      byEntry.get(key)!.push(t);
    }

    const result: TradeGroup[] = [];

    for (const [entryId, exits] of byEntry) {
      // Sort exits chronologically within group
      exits.sort(
        (a, b) =>
          new Date(a.creationTimestamp).getTime() -
          new Date(b.creationTimestamp).getTime(),
      );
      const entry = entryMap.get(exits[0].id)!;
      const totalPnl = exits.reduce((s, t) => s + t.profitAndLoss!, 0);
      const totalFees = exits.reduce((s, t) => s + t.fees, 0);
      result.push({
        entryId,
        entry,
        exits,
        totalQty: exits.reduce((s, t) => s + t.size, 0),
        totalPnl,
        totalFees,
        totalNet: totalPnl - totalFees,
        earliestTime: exits[0].creationTimestamp,
        latestTime: exits[exits.length - 1].creationTimestamp,
        isLong: exits[0].side !== OrderSide.Buy,
      });
    }

    // Unmatched trades become single-exit groups
    for (const t of unmatched) {
      result.push({
        entryId: -t.id, // negative to avoid collision with real entry IDs
        entry: null as unknown as Trade,
        exits: [t],
        totalQty: t.size,
        totalPnl: t.profitAndLoss!,
        totalFees: t.fees,
        totalNet: t.profitAndLoss! - t.fees,
        earliestTime: t.creationTimestamp,
        latestTime: t.creationTimestamp,
        isLong: t.side !== OrderSide.Buy,
      });
    }

    return result;
  }, [closingTrades, entryMap]);

  // Sort groups
  const sortedGroups = useMemo(() => {
    const arr = [...groups];
    const dir = sortDir === 'asc' ? 1 : -1;

    const getValue = (g: TradeGroup): number | string => {
      switch (sortCol) {
        case 'time': return g.earliestTime ?? '';
        case 'side': return g.isLong ? 'Long' : 'Short';
        case 'symbol': return shortSymbol(g.exits[0].contractId);
        case 'qty': return g.totalQty;
        case 'entry': return g.entry?.price ?? 0;
        case 'exit': return g.exits.length === 1 ? g.exits[0].price : g.exits.length;
        case 'duration': return g.entry ? durationMs(g.entry.creationTimestamp, g.latestTime) : 0;
        case 'pnl': return g.totalPnl;
        case 'fees': return g.totalFees;
        case 'net': return g.totalNet;
      }
    };

    arr.sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
    return arr;
  }, [groups, sortCol, sortDir]);

  const emptyLabels: Record<string, string> = {
    today: 'No trades today',
    week: 'No trades this week',
    month: 'No trades this month',
  };

  if (closingTrades.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[#434651] text-xs">
        {emptyLabels[tradesDatePreset]}
      </div>
    );
  }

  const cols = 'grid-cols-[1.2fr_0.7fr_1fr_0.5fr_1.2fr_1.2fr_0.9fr_1fr_0.7fr_1fr]';

  let rowIdx = 0;

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
            ['Duration', 'duration'],
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
      {sortedGroups.map((group) => {
        const isMulti = group.exits.length > 1;
        const isExpanded = expandedGroups.has(group.entryId);
        const exitIds = group.exits.map((t) => t.id);
        const allVisible = exitIds.every((id) => visibleTradeIds.includes(id));
        const anyVisible = exitIds.some((id) => visibleTradeIds.includes(id));

        // For single-exit groups, render exactly like before
        if (!isMulti) {
          const trade = group.exits[0];
          const net = trade.profitAndLoss! - trade.fees;
          const isVisible = visibleTradeIds.includes(trade.id);
          const stripe = rowIdx++ % 2 === 1 ? 'bg-[#0d1117]/40' : '';
          const selected = isVisible ? 'bg-[#2962ff]/15 border-l-2 border-l-[#2962ff]' : 'border-l-2 border-l-transparent';

          return (
            <div
              key={trade.id}
              className={`${stripe} ${selected} hover:bg-[#1e222d]/50 transition-colors cursor-pointer`}
              onClick={() => toggleTradeVisibility(trade.id)}
            >
              <div className={`grid ${cols} items-center h-7 pl-4`} style={{ width: '70%' }}>
                <div className="px-3 text-center text-[#787b86] whitespace-nowrap">
                  {trade.creationTimestamp ? formatTime(trade.creationTimestamp, showDate) : '\u2014'}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={group.isLong ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                    {group.isLong ? 'Long' : 'Short'}
                  </span>
                </div>
                <div className="px-3 text-center text-[#9598a1] whitespace-nowrap">
                  {shortSymbol(trade.contractId)}
                </div>
                <div className="px-3 text-center text-[#d1d4dc]">{trade.size}</div>
                <div className="px-3 text-center text-[#d1d4dc] whitespace-nowrap">
                  {group.entry ? group.entry.price.toFixed(2) : '\u2014'}
                </div>
                <div className="px-3 text-center text-[#d1d4dc] whitespace-nowrap">{trade.price.toFixed(2)}</div>
                <div className="px-3 text-center text-[#787b86] whitespace-nowrap">
                  {group.entry ? formatDuration(durationMs(group.entry.creationTimestamp, trade.creationTimestamp)) : '\u2014'}
                </div>
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
        }

        // Multi-exit group
        const parentStripe = rowIdx++ % 2 === 1 ? 'bg-[#0d1117]/40' : '';
        const parentSelected = anyVisible ? 'bg-[#2962ff]/15 border-l-2 border-l-[#2962ff]' : 'border-l-2 border-l-transparent';

        return (
          <div key={`group-${group.entryId}`}>
            {/* Parent row */}
            <div
              className={`${parentStripe} ${parentSelected} hover:bg-[#1e222d]/50 transition-colors cursor-pointer`}
              onClick={() => toggleTradeVisibilityBulk(exitIds)}
            >
              <div className={`grid ${cols} items-center h-7 pl-4`} style={{ width: '70%' }}>
                <div className="px-3 text-center text-[#787b86] whitespace-nowrap">
                  {group.entry ? formatTime(group.entry.creationTimestamp, showDate) : formatTime(group.earliestTime, showDate)}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={group.isLong ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                    {group.isLong ? 'Long' : 'Short'}
                  </span>
                </div>
                <div className="px-3 text-center text-[#9598a1] whitespace-nowrap">
                  {shortSymbol(group.exits[0].contractId)}
                </div>
                <div className="px-3 text-center text-[#d1d4dc]">{group.totalQty}</div>
                <div className="px-3 text-center text-[#d1d4dc] whitespace-nowrap">
                  {group.entry ? group.entry.price.toFixed(2) : '\u2014'}
                </div>
                <div
                  className="px-3 text-center text-[#787b86] whitespace-nowrap cursor-pointer select-none hover:text-[#d1d4dc] transition-colors"
                  onClick={(e) => { e.stopPropagation(); toggleExpand(group.entryId); }}
                >
                  {group.exits.length} exits {isExpanded ? '\u25BE' : '\u25B8'}
                </div>
                <div className="px-3 text-center text-[#787b86] whitespace-nowrap">
                  {group.entry ? formatDuration(durationMs(group.entry.creationTimestamp, group.latestTime)) : '\u2014'}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={group.totalPnl > 0 ? 'text-[#26a69a]' : group.totalPnl < 0 ? 'text-[#ef5350]' : 'text-[#787b86]'}>
                    {group.totalPnl > 0 ? '+' : ''}{group.totalPnl.toFixed(2)}
                  </span>
                </div>
                <div className="px-3 text-center text-[#787b86] whitespace-nowrap">
                  {group.totalFees.toFixed(2)}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={`font-medium ${group.totalNet > 0 ? 'text-[#26a69a]' : group.totalNet < 0 ? 'text-[#ef5350]' : 'text-[#787b86]'}`}>
                    {group.totalNet > 0 ? '+' : ''}{group.totalNet.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Sub-rows (expanded) */}
            {isExpanded && group.exits.map((trade) => {
              const net = trade.profitAndLoss! - trade.fees;
              const isVisible = visibleTradeIds.includes(trade.id);
              const subStripe = rowIdx++ % 2 === 1 ? 'bg-[#0d1117]/40' : '';
              const subSelected = isVisible ? 'bg-[#2962ff]/15 border-l-2 border-l-[#2962ff]' : 'border-l-2 border-l-transparent';

              return (
                <div
                  key={trade.id}
                  className={`${subStripe} ${subSelected} hover:bg-[#1e222d]/50 transition-colors cursor-pointer`}
                  onClick={(e) => { e.stopPropagation(); toggleTradeVisibility(trade.id); }}
                >
                  <div className={`grid ${cols} items-center h-7`} style={{ width: '70%', paddingLeft: 'calc(1rem + 20px)' }}>
                    <div className="px-3 text-center text-[#787b86]/60 whitespace-nowrap">
                      {formatTime(trade.creationTimestamp, showDate)}
                    </div>
                    <div className="px-3 text-center" />
                    <div className="px-3 text-center" />
                    <div className="px-3 text-center text-[#787b86]">{trade.size}</div>
                    <div className="px-3 text-center" />
                    <div className="px-3 text-center text-[#787b86] whitespace-nowrap">{trade.price.toFixed(2)}</div>
                    <div className="px-3 text-center text-[#787b86]/60 whitespace-nowrap">
                      {group.entry ? formatDuration(durationMs(group.entry.creationTimestamp, trade.creationTimestamp)) : '\u2014'}
                    </div>
                    <div className="px-3 text-center whitespace-nowrap">
                      <span className={trade.profitAndLoss! > 0 ? 'text-[#26a69a]/70' : trade.profitAndLoss! < 0 ? 'text-[#ef5350]/70' : 'text-[#787b86]'}>
                        {trade.profitAndLoss! > 0 ? '+' : ''}{trade.profitAndLoss!.toFixed(2)}
                      </span>
                    </div>
                    <div className="px-3 text-center text-[#787b86]/60 whitespace-nowrap">
                      {trade.fees.toFixed(2)}
                    </div>
                    <div className="px-3 text-center whitespace-nowrap">
                      <span className={`${net > 0 ? 'text-[#26a69a]/70' : net < 0 ? 'text-[#ef5350]/70' : 'text-[#787b86]'}`}>
                        {net > 0 ? '+' : ''}{net.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
