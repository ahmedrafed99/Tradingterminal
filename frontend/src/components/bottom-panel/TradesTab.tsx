import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Z } from '../../constants/layout';
import { TABLE_ROW_STRIPE } from '../../constants/styles';
import { realtimeService } from '../../services/realtimeService';
import type { Trade } from '../../services/tradeService';
import { tradeService } from '../../services/tradeService';
import { useStore } from '../../store/useStore';
import { OrderSide } from '../../types/enums';
import { getDateRange, type DatePreset } from '../../utils/cmeSession';
import { shortSymbol, formatTime, formatDuration } from '../../utils/formatters';
import { tradingDurationMs } from '../../utils/marketHours';
import { buildEntryMap } from '../chart/TradeZonePrimitive';
import { DatePresetSelector } from './DatePresetSelector';

type SortColumn = 'time' | 'side' | 'symbol' | 'qty' | 'entry' | 'exit' | 'pnl' | 'fees' | 'commissions' | 'net' | 'duration';
type SortDir = 'asc' | 'desc';

interface TradeGroup {
  entryId: number;
  entry: Trade;
  exits: Trade[]; // sorted chronologically
  // aggregated values
  totalQty: number;
  totalPnl: number;
  totalFees: number;
  totalCommissions: number;
  totalNet: number;
  earliestTime: string;
  latestTime: string;
  isLong: boolean;
}

// In-memory cache for all trades, keyed by accountId
export const allTradesCache = new Map<string, Trade[]>();

function filterByPreset(allTrades: Trade[], preset: DatePreset): Trade[] {
  if (preset === 'all') return allTrades;
  const { startTimestamp } = getDateRange(preset);
  return allTrades.filter((t) => t.creationTimestamp >= startTimestamp);
}

export function TradesTab() {
  const connected = useStore((s) => s.connected);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const visibleTradeIds = useStore((s) => s.visibleTradeIds);
  const toggleTradeVisibility = useStore((s) => s.toggleTradeVisibility);
  const toggleTradeVisibilityBulk = useStore((s) => s.toggleTradeVisibilityBulk);
  const clearVisibleTradeIds = useStore((s) => s.clearVisibleTradeIds);
  const tradesDatePreset = useStore((s) => s.tradesDatePreset);
  const presetCounts = useStore((s) => s.presetCounts);
  const setPresetCounts = useStore((s) => s.setPresetCounts);
  const bottomPanelTab = useStore((s) => s.bottomPanelTab);

  // Display trades in store so the chart can access them for trade zone markers
  const displayTradesRaw = useStore((s) => s.displayTrades);
  const displayTrades = useDeferredValue(displayTradesRaw);
  const setDisplayTrades = useStore((s) => s.setDisplayTrades);

  const showDate = tradesDatePreset !== 'today';

  const ALL_PRESETS: DatePreset[] = ['today', 'week', 'month', 'all'];

  // Derive display trades and preset counts from the all-trades cache
  const applyPreset = useCallback((allTrades: Trade[]) => {
    const countClosing = (trades: Trade[]) =>
      trades.filter((t) => t.profitAndLoss != null && !t.voided).length;

    const preset = useStore.getState().tradesDatePreset;
    const filtered = filterByPreset(allTrades, preset);
    startTransition(() => setDisplayTrades(filtered));

    const counts: Partial<Record<DatePreset, number>> = {};
    for (const p of ALL_PRESETS) {
      counts[p] = countClosing(filterByPreset(allTrades, p));
    }
    setPresetCounts(counts);
  }, []);

  // Fetch all trades once, filter client-side for the active preset
  useEffect(() => {
    if (!connected || activeAccountId == null) return;
    let cancelled = false;

    const cached = allTradesCache.get(activeAccountId);
    if (cached) {
      applyPreset(cached);
      return;
    }

    const { startTimestamp } = getDateRange('all');
    tradeService
      .searchTrades(activeAccountId, startTimestamp)
      .then((trades) => {
        if (cancelled) return;
        allTradesCache.set(activeAccountId, trades);
        applyPreset(trades);
      })
      .catch((err) => {
        console.error('[TradesTab] Trades fetch failed:', err instanceof Error ? err.message : err);
      });
    return () => { cancelled = true; };
  }, [connected, activeAccountId]);

  // Re-filter when preset changes (no API call)
  useEffect(() => {
    if (activeAccountId == null) return;
    const cached = allTradesCache.get(activeAccountId);
    if (cached) applyPreset(cached);
  }, [tradesDatePreset]);

  // Re-fetch all trades on SignalR trade events (debounced 500ms)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!connected) return;
    const handler = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const state = useStore.getState();
        if (state.activeAccountId == null) return;
        allTradesCache.delete(state.activeAccountId);
        const { startTimestamp } = getDateRange('all');
        tradeService
          .searchTrades(state.activeAccountId, startTimestamp)
          .then((trades) => {
            allTradesCache.set(state.activeAccountId!, trades);
            applyPreset(trades);
          })
          .catch((err) => {
            console.error('[TradesTab] Trade event re-fetch failed:', err instanceof Error ? err.message : err);
          });
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const RENDER_LIMIT = 50;
  const [showAll, setShowAll] = useState(false);
  // Reset to limited view when data changes (filter switch)
  const prevTradesRef = useRef(displayTrades);
  if (displayTrades !== prevTradesRef.current) {
    prevTradesRef.current = displayTrades;
    if (showAll) setShowAll(false);
  }

  const toggleSort = useCallback((col: SortColumn) => {
    if (col === sortCol) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }, [sortCol, sortDir]);

  const toggleExpand = useCallback((entryId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  // When stats popover is open it covers the entire screen — skip expensive
  // row computation and rendering so only StatsPopover pays the cost.
  const statsOpen = bottomPanelTab === 'stats';

  // Build entry map and filter to closing trades
  const entryMap = useMemo(() => statsOpen ? new Map<string, Trade>() : buildEntryMap(displayTrades), [displayTrades, statsOpen]);
  const closingTrades = useMemo(
    () => statsOpen ? [] : [...displayTrades].filter((t) => t.profitAndLoss != null && !t.voided).reverse(),
    [displayTrades, statsOpen],
  );

  // Group closing trades by their matched entry
  const groups = useMemo(() => {
    const byEntry = new Map<string, Trade[]>();
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
      const totalFees = exits.reduce((s, t) => s + t.fees, 0) + entry.fees;
      const totalCommissions = exits.reduce((s, t) => s + t.commissions, 0) + entry.commissions;
      result.push({
        entryId,
        entry,
        exits,
        totalQty: exits.reduce((s, t) => s + t.size, 0),
        totalPnl,
        totalFees,
        totalCommissions,
        totalNet: totalPnl - totalFees - totalCommissions,
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
        totalCommissions: t.commissions,
        totalNet: t.profitAndLoss! - t.fees - t.commissions,
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
        case 'duration': return g.entry ? tradingDurationMs(g.entry.creationTimestamp, g.latestTime) : 0;
        case 'pnl': return g.totalPnl;
        case 'fees': return g.totalFees;
        case 'commissions': return g.totalCommissions;
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
    all: 'No trades found',
  };

  if (statsOpen) return null;

  if (closingTrades.length === 0) {
    return (
      <div className="flex flex-col h-full" style={{ width: '100%' }}>
        <div className="flex items-center h-8 shrink-0 border-b border-(--color-border)">
          <div style={{ width: '70%' }} />
          <div className="ml-auto" style={{ paddingRight: 16 }}>
            <DatePresetSelector counts={presetCounts} />
          </div>
        </div>
        <div className="flex items-center justify-center flex-1 text-(--color-text-dim) text-xs">
          {emptyLabels[tradesDatePreset]}
        </div>
      </div>
    );
  }

  const cols = 'grid-cols-[1.2fr_0.7fr_1fr_0.5fr_1.2fr_1.2fr_0.9fr_1fr_0.7fr_0.7fr_1fr]';

  let rowIdx = 0;

  return (
    <div className="text-xs" style={{ fontFeatureSettings: '"tnum"' }}>
      {/* Header */}
      <div className="sticky top-0 bg-(--color-panel) border-b border-(--color-border)" style={{ zIndex: Z.HEADER }}>
        <div className="flex items-center h-8 relative">
          <div className={`grid ${cols} items-center h-8 text-(--color-text-muted) pl-4`} style={{ width: '70%' }}>
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
              ['Comm.', 'commissions'],
              ['Net', 'net'],
            ] as const).map(([label, col]) => {
              const active = sortCol === col;
              return (
                <div
                  key={col}
                  className={`px-3 text-center cursor-pointer select-none hover:text-(--color-text) transition-colors ${active ? 'text-(--color-text)' : ''}`}
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
          <div className="ml-auto flex items-center" style={{ paddingRight: 16 }}>
            {visibleTradeIds.length > 0 && (
              <button
                className="text-xs text-(--color-text-muted) hover:text-(--color-text) transition-colors cursor-pointer select-none"
                style={{ position: 'absolute', right: 120 }}
                onClick={clearVisibleTradeIds}
              >
                Hide drawings
              </button>
            )}
            <DatePresetSelector counts={presetCounts} />
          </div>
        </div>
      </div>

      {/* Rows */}
      {(showAll ? sortedGroups : sortedGroups.slice(0, RENDER_LIMIT)).map((group) => {
        const isMulti = group.exits.length > 1;
        const isExpanded = expandedGroups.has(group.entryId);
        const exitIds = group.exits.map((t) => t.id);
        const allVisible = exitIds.every((id) => visibleTradeIds.includes(id));
        const anyVisible = exitIds.some((id) => visibleTradeIds.includes(id));

        // For single-exit groups, render exactly like before
        if (!isMulti) {
          const trade = group.exits[0];
          const net = group.totalNet;
          const isVisible = visibleTradeIds.includes(trade.id);
          const stripe = rowIdx++ % 2 === 1 ? TABLE_ROW_STRIPE : '';
          const selected = isVisible ? 'bg-(--color-warning)/10 border border-(--color-warning)/60' : 'border border-transparent';

          return (
            <div
              key={trade.id}
              className={`${stripe} ${selected} row-hover`}
              style={{ contentVisibility: 'auto', containIntrinsicSize: '0 28px' }}
              onClick={() => toggleTradeVisibility(trade.id)}
            >
              <div className={`grid ${cols} items-center h-7 pl-4`} style={{ width: '70%' }}>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {trade.creationTimestamp ? formatTime(trade.creationTimestamp, showDate) : '\u2014'}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={group.isLong ? 'text-(--color-buy)' : 'text-(--color-sell)'}>
                    {group.isLong ? 'Long' : 'Short'}
                  </span>
                </div>
                <div className="px-3 text-center text-(--color-text-medium) whitespace-nowrap">
                  {shortSymbol(trade.contractId)}
                </div>
                <div className="px-3 text-center text-(--color-text)">{trade.size}</div>
                <div className="px-3 text-center text-(--color-text) whitespace-nowrap">
                  {group.entry ? group.entry.price.toFixed(2) : '\u2014'}
                </div>
                <div className="px-3 text-center text-(--color-text) whitespace-nowrap">{trade.price.toFixed(2)}</div>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {group.entry ? formatDuration(tradingDurationMs(group.entry.creationTimestamp, trade.creationTimestamp)) : '\u2014'}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={trade.profitAndLoss! > 0 ? 'text-(--color-buy)' : trade.profitAndLoss! < 0 ? 'text-(--color-sell)' : 'text-(--color-text-muted)'}>
                    {trade.profitAndLoss! > 0 ? '+' : ''}{trade.profitAndLoss!.toFixed(2)}
                  </span>
                </div>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {group.totalFees.toFixed(2)}
                </div>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {group.totalCommissions.toFixed(2)}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={`font-medium ${net > 0 ? 'text-(--color-buy)' : net < 0 ? 'text-(--color-sell)' : 'text-(--color-text-muted)'}`}>
                    {net > 0 ? '+' : ''}{net.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          );
        }

        // Multi-exit group
        const parentStripe = rowIdx++ % 2 === 1 ? TABLE_ROW_STRIPE : '';
        const parentSelected = anyVisible ? 'bg-(--color-warning)/10 border border-(--color-warning)/60' : 'border border-transparent';

        return (
          <div key={`group-${group.entryId}`} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 28px' }}>
            {/* Parent row */}
            <div
              className={`${parentStripe} ${parentSelected} row-hover`}
              onClick={() => toggleTradeVisibilityBulk(exitIds)}
            >
              <div className={`grid ${cols} items-center h-7 pl-4`} style={{ width: '70%' }}>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {group.entry ? formatTime(group.entry.creationTimestamp, showDate) : formatTime(group.earliestTime, showDate)}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={group.isLong ? 'text-(--color-buy)' : 'text-(--color-sell)'}>
                    {group.isLong ? 'Long' : 'Short'}
                  </span>
                </div>
                <div className="px-3 text-center text-(--color-text-medium) whitespace-nowrap">
                  {shortSymbol(group.exits[0].contractId)}
                </div>
                <div className="px-3 text-center text-(--color-text)">{group.totalQty}</div>
                <div className="px-3 text-center text-(--color-text) whitespace-nowrap">
                  {group.entry ? group.entry.price.toFixed(2) : '\u2014'}
                </div>
                <div
                  className="px-3 text-center text-(--color-text-muted) whitespace-nowrap cursor-pointer select-none hover:text-(--color-text) transition-colors"
                  onClick={(e) => { e.stopPropagation(); toggleExpand(group.entryId); }}
                >
                  {group.exits.length} exits {isExpanded ? '\u25BE' : '\u25B8'}
                </div>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {group.entry ? formatDuration(tradingDurationMs(group.entry.creationTimestamp, group.latestTime)) : '\u2014'}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={group.totalPnl > 0 ? 'text-(--color-buy)' : group.totalPnl < 0 ? 'text-(--color-sell)' : 'text-(--color-text-muted)'}>
                    {group.totalPnl > 0 ? '+' : ''}{group.totalPnl.toFixed(2)}
                  </span>
                </div>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {group.totalFees.toFixed(2)}
                </div>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {group.totalCommissions.toFixed(2)}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={`font-medium ${group.totalNet > 0 ? 'text-(--color-buy)' : group.totalNet < 0 ? 'text-(--color-sell)' : 'text-(--color-text-muted)'}`}>
                    {group.totalNet > 0 ? '+' : ''}{group.totalNet.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Sub-rows (expanded) */}
            {isExpanded && group.exits.map((trade) => {
              const tradeFees = trade.fees;
              const tradeCommissions = trade.commissions;
              const net = trade.profitAndLoss! - tradeFees - tradeCommissions;
              const isVisible = visibleTradeIds.includes(trade.id);
              const subStripe = rowIdx++ % 2 === 1 ? TABLE_ROW_STRIPE : '';
              const subSelected = isVisible ? 'bg-(--color-warning)/10 border border-(--color-warning)/60' : 'border border-transparent';

              return (
                <div
                  key={trade.id}
                  className={`${subStripe} ${subSelected} row-hover`}
                  onClick={(e) => { e.stopPropagation(); toggleTradeVisibility(trade.id); }}
                >
                  <div className={`grid ${cols} items-center h-7`} style={{ width: '70%', paddingLeft: 'calc(1rem + 20px)' }}>
                    <div className="px-3 text-center text-(--color-text-muted)/60 whitespace-nowrap">
                      {formatTime(trade.creationTimestamp, showDate)}
                    </div>
                    <div className="px-3 text-center" />
                    <div className="px-3 text-center" />
                    <div className="px-3 text-center text-(--color-text-muted)">{trade.size}</div>
                    <div className="px-3 text-center" />
                    <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">{trade.price.toFixed(2)}</div>
                    <div className="px-3 text-center text-(--color-text-muted)/60 whitespace-nowrap">
                      {group.entry ? formatDuration(tradingDurationMs(group.entry.creationTimestamp, trade.creationTimestamp)) : '\u2014'}
                    </div>
                    <div className="px-3 text-center whitespace-nowrap">
                      <span className={trade.profitAndLoss! > 0 ? 'text-(--color-buy)/70' : trade.profitAndLoss! < 0 ? 'text-(--color-sell)/70' : 'text-(--color-text-muted)'}>
                        {trade.profitAndLoss! > 0 ? '+' : ''}{trade.profitAndLoss!.toFixed(2)}
                      </span>
                    </div>
                    <div className="px-3 text-center text-(--color-text-muted)/60 whitespace-nowrap">
                      {tradeFees.toFixed(2)}
                    </div>
                    <div className="px-3 text-center text-(--color-text-muted)/60 whitespace-nowrap">
                      {tradeCommissions.toFixed(2)}
                    </div>
                    <div className="px-3 text-center whitespace-nowrap">
                      <span className={`${net > 0 ? 'text-(--color-buy)/70' : net < 0 ? 'text-(--color-sell)/70' : 'text-(--color-text-muted)'}`}>
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
      {!showAll && sortedGroups.length > RENDER_LIMIT && (
        <div
          className="flex items-center justify-center text-xs text-(--color-text-muted) hover:text-(--color-text) transition-colors cursor-pointer"
          style={{ padding: '6px 0' }}
          onClick={() => setShowAll(true)}
        >
          Show all {sortedGroups.length} trades
        </div>
      )}
    </div>
  );
}
