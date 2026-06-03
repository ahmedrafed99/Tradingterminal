import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react';
import { realtimeService } from '../../services/realtimeService';
import type { Trade } from '../../services/tradeService';
import { tradeService } from '../../services/tradeService';
import { useStore } from '../../store/useStore';
import { OrderSide } from '../../types/enums';
import { getDateRange, type DatePreset, DATE_PRESET_LABELS } from '../../utils/cmeSession';
import { buildEntryMap } from '../chart/TradeZonePrimitive';
import { CustomSelect } from '../shared/CustomSelect';
import { TradesTable, type TradeRowInput } from '../shared/TradesTable';


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
  const pnlMode = useStore((s) => s.pnlMode);
  const setPnlMode = useStore((s) => s.setPnlMode);

  // Display trades in store so the chart can access them for trade zone markers
  const displayTradesRaw = useStore((s) => s.displayTrades);
  const displayTrades = useDeferredValue(displayTradesRaw);
  const setDisplayTrades = useStore((s) => s.setDisplayTrades);

  const setTradesDatePreset = useStore((s) => s.setTradesDatePreset);

  const showDate = tradesDatePreset !== 'today';

  const ALL_PRESETS: DatePreset[] = ['today', 'week', 'month', 'all'];

  const presetOptions = ALL_PRESETS.map((p) => ({
    value: p,
    label: presetCounts?.[p] != null ? `${DATE_PRESET_LABELS[p]} (${presetCounts[p]})` : DATE_PRESET_LABELS[p],
  }));

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

  // When stats popover is open it covers the entire screen — skip expensive
  // row computation and rendering so only StatsPopover pays the cost.
  const statsOpen = bottomPanelTab === 'stats';

  // Build entry map and filter to closing trades
  const entryMap = useMemo(() => statsOpen ? new Map<string, Trade>() : buildEntryMap(displayTrades), [displayTrades, statsOpen]);
  const closingTrades = useMemo(
    () => statsOpen ? [] : [...displayTrades].filter((t) => t.profitAndLoss != null && !t.voided).reverse(),
    [displayTrades, statsOpen],
  );

  // Group closing trades by matched entry
  const tradeInputs = useMemo(() => {
    const byEntry = new Map<string, Trade[]>();
    const unmatched: Trade[] = [];

    for (const t of closingTrades) {
      const entry = entryMap.get(t.id);
      if (!entry) { unmatched.push(t); continue; }
      const key = entry.id;
      if (!byEntry.has(key)) byEntry.set(key, []);
      byEntry.get(key)!.push(t);
    }

    const result: TradeRowInput[] = [];

    for (const [entryId, exits] of byEntry) {
      exits.sort((a, b) => new Date(a.creationTimestamp).getTime() - new Date(b.creationTimestamp).getTime());
      const entry = entryMap.get(exits[0].id)!;
      result.push({ entryId, entry, exits, isLong: exits[0].side !== OrderSide.Buy });
    }

    for (const t of unmatched) {
      result.push({ entryId: `unmatched:${t.id}`, entry: null, exits: [t], isLong: t.side !== OrderSide.Buy });
    }

    return result;
  }, [closingTrades, entryMap]);

  const togglePnlMode = useCallback(() => setPnlMode(pnlMode === '$' ? 'points' : '$'), [pnlMode, setPnlMode]);

  const emptyLabels: Record<string, string> = {
    today: 'No trades today',
    week: 'No trades this week',
    month: 'No trades this month',
    all: 'No trades found',
  };

  if (statsOpen) return null;

  const filterSelect = (
    <CustomSelect
      value={tradesDatePreset}
      onChange={(v) => setTradesDatePreset(v as DatePreset)}
      options={presetOptions}
      padding="4px 8px"
      fontSize={11}
      dropdownMinWidth={130}
    />
  );

  if (closingTrades.length === 0) {
    return (
      <div className="flex flex-col h-full" style={{ width: '100%' }}>
        <div className="flex items-center h-8 shrink-0 border-b border-(--color-border)">
          <div style={{ width: '70%' }} />
          <div className="ml-auto" style={{ paddingRight: 16 }}>
            {filterSelect}
          </div>
        </div>
        <div className="flex items-center justify-center flex-1 text-(--color-text-dim) text-xs">
          {emptyLabels[tradesDatePreset]}
        </div>
      </div>
    );
  }

  return (
    <TradesTable
      groups={tradeInputs}
      showDate={showDate}
      contentWidth="70%"
      onSingleClick={toggleTradeVisibility}
      onGroupClick={toggleTradeVisibilityBulk}
      selectedIds={visibleTradeIds}
      pnlMode={pnlMode}
      onPnlModeToggle={togglePnlMode}
      headerExtra={
        <>
          {visibleTradeIds.length > 0 && (
            <button
              className="text-xs text-(--color-text-muted) hover:text-(--color-text) transition-colors cursor-pointer select-none"
              onClick={clearVisibleTradeIds}
            >
              Hide drawings
            </button>
          )}
          {filterSelect}
        </>
      }
    />
  );
}
