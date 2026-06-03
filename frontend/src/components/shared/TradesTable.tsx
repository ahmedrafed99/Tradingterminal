import { useCallback, useMemo, useRef, useState } from 'react';
import type { Trade } from '../../services/tradeService';
import { Z } from '../../constants/layout';
import { TABLE_ROW_STRIPE } from '../../constants/styles';
import { shortSymbol, formatTime, formatDuration } from '../../utils/formatters';
import { tradingDurationMs } from '../../utils/marketHours';

export interface TradeRowInput {
  entryId: string;
  entry: Trade | null;
  exits: Trade[];
  isLong: boolean;
}

type SortCol = 'time' | 'side' | 'symbol' | 'qty' | 'entry' | 'exit' | 'pnl' | 'fees' | 'commissions' | 'net' | 'duration';
type SortDir = 'asc' | 'desc';

interface AugGroup extends TradeRowInput {
  totalQty: number;
  totalPnl: number;
  totalFees: number;
  totalCommissions: number;
  totalNet: number;
  earliestTime: string;
  latestTime: string;
}

interface Props {
  groups: TradeRowInput[];
  showDate?: boolean;
  contentWidth?: string;
  stickyBg?: string;
  stickyHeader?: boolean;
  onSingleClick?: (tradeId: string) => void;
  onGroupClick?: (exitIds: string[]) => void;
  selectedIds?: string[];
  headerExtra?: React.ReactNode;
  pnlMode?: '$' | 'points';
  onPnlModeToggle?: () => void;
}

const COLS = 'grid-cols-[1.2fr_0.7fr_1fr_0.5fr_1.2fr_1.2fr_0.9fr_1fr_0.7fr_0.7fr_1fr]';
const RENDER_LIMIT = 50;

function augment(g: TradeRowInput): AugGroup {
  const { exits, entry } = g;
  const totalQty = exits.reduce((s, t) => s + t.size, 0);
  const totalPnl = exits.reduce((s, t) => s + (t.profitAndLoss ?? 0), 0);
  const totalFees = exits.reduce((s, t) => s + t.fees, 0) + (entry?.fees ?? 0);
  const totalCommissions = exits.reduce((s, t) => s + t.commissions, 0) + (entry?.commissions ?? 0);
  const totalNet = totalPnl - totalFees - totalCommissions;
  const earliestTime = exits[0]?.creationTimestamp ?? '';
  const latestTime = exits[exits.length - 1]?.creationTimestamp ?? '';
  return { ...g, totalQty, totalPnl, totalFees, totalCommissions, totalNet, earliestTime, latestTime };
}

export function TradesTable({
  groups,
  showDate = false,
  contentWidth = '70%',
  stickyBg = 'var(--color-panel)',
  stickyHeader = true,
  onSingleClick,
  onGroupClick,
  selectedIds = [],
  headerExtra,
  pnlMode = '$',
  onPnlModeToggle,
}: Props) {
  const [sortCol, setSortCol] = useState<SortCol>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  // Reset showAll when underlying data changes
  const prevGroupsRef = useRef(groups);
  if (groups !== prevGroupsRef.current) {
    prevGroupsRef.current = groups;
    if (showAll) setShowAll(false);
  }

  const augmented = useMemo(() => groups.map(augment), [groups]);

  const toggleSort = useCallback((col: SortCol) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
        return prev;
      }
      setSortDir('desc');
      return col;
    });
  }, []);

  const toggleExpand = useCallback((entryId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  const sortedGroups = useMemo(() => {
    const arr = [...augmented];
    const dir = sortDir === 'asc' ? 1 : -1;
    const getValue = (g: AugGroup): number | string => {
      switch (sortCol) {
        case 'time': return g.earliestTime;
        case 'side': return g.isLong ? 'Long' : 'Short';
        case 'symbol': return g.exits[0] ? shortSymbol(g.exits[0].contractId) : '';
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
  }, [augmented, sortCol, sortDir]);

  const displayed = showAll ? sortedGroups : sortedGroups.slice(0, RENDER_LIMIT);

  const headerStyle = stickyHeader
    ? { position: 'sticky' as const, top: 0, zIndex: Z.HEADER, background: stickyBg }
    : {};

  let rowIdx = 0;

  return (
    <div className="text-xs" style={{ fontFeatureSettings: '"tnum"' }}>
      {/* Header */}
      <div
        className="border-b border-(--color-border)"
        style={headerStyle}
      >
        <div className="flex items-center h-8 relative">
          <div className={`grid ${COLS} items-center h-8 text-(--color-text-muted) pl-4`} style={{ width: contentWidth }}>
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
                    <span className="ml-0.5 text-[10px]">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
                  )}
                </div>
              );
            })}
          </div>
          {headerExtra && (
            <div className="ml-auto flex items-center gap-2" style={{ paddingRight: 16 }}>
              {headerExtra}
            </div>
          )}
        </div>
      </div>

      {/* Rows */}
      {displayed.map((group) => {
        const isMulti = group.exits.length > 1;
        const isExpanded = expandedGroups.has(group.entryId);
        const exitIds = group.exits.map((t) => t.id);
        const anyVisible = selectedIds.length > 0 && exitIds.some((id) => selectedIds.includes(id));

        if (!isMulti) {
          const trade = group.exits[0];
          const net = group.totalNet;
          const isVisible = selectedIds.includes(trade.id);
          const stripe = rowIdx++ % 2 === 1 ? TABLE_ROW_STRIPE : '';
          const selected = isVisible ? 'bg-(--color-warning)/10 border border-(--color-warning)/60' : 'border border-transparent';

          return (
            <div
              key={trade.id}
              className={`${stripe} ${selected} row-hover`}
              style={{ contentVisibility: 'auto', containIntrinsicSize: '0 28px' }}
              onClick={onSingleClick ? () => onSingleClick(trade.id) : undefined}
            >
              <div className={`grid ${COLS} items-center h-7 pl-4`} style={{ width: contentWidth }}>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {trade.creationTimestamp ? formatTime(trade.creationTimestamp, showDate) : '—'}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={group.isLong ? 'text-(--color-buy)' : 'text-(--color-sell)'}>
                    {group.isLong ? 'Long' : 'Short'}
                  </span>
                </div>
                <div className="px-3 text-center text-(--color-text) whitespace-nowrap">
                  {shortSymbol(trade.contractId)}
                </div>
                <div className="px-3 text-center text-(--color-text)">{trade.size}</div>
                <div className="px-3 text-center text-(--color-text) whitespace-nowrap">
                  {group.entry ? group.entry.price.toFixed(2) : '—'}
                </div>
                <div className="px-3 text-center text-(--color-text) whitespace-nowrap">{trade.price.toFixed(2)}</div>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {group.entry ? formatDuration(tradingDurationMs(group.entry.creationTimestamp, trade.creationTimestamp)) : '—'}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  {onPnlModeToggle ? (
                    <span
                      onClick={(e) => { e.stopPropagation(); onPnlModeToggle(); }}
                      title={pnlMode === '$' ? 'Switch to points' : 'Switch to dollars'}
                      className="cursor-pointer rounded px-1 hover:bg-(--color-hover-row) transition-all"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <span className={trade.profitAndLoss! > 0 ? 'text-(--color-buy)' : trade.profitAndLoss! < 0 ? 'text-(--color-sell)' : 'text-(--color-text-muted)'}>
                        {trade.profitAndLoss! > 0 ? '+' : ''}{trade.profitAndLoss!.toFixed(2)}
                      </span>
                      <span className="font-normal text-(--color-text-muted)" style={{ opacity: 0.6 }}>
                        {pnlMode === '$' ? '$' : 'pt'}
                      </span>
                    </span>
                  ) : (
                    <span className={trade.profitAndLoss! > 0 ? 'text-(--color-buy)' : trade.profitAndLoss! < 0 ? 'text-(--color-sell)' : 'text-(--color-text-muted)'}>
                      {trade.profitAndLoss! > 0 ? '+' : ''}{trade.profitAndLoss!.toFixed(2)}
                    </span>
                  )}
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
              onClick={onGroupClick ? () => onGroupClick(exitIds) : undefined}
            >
              <div className={`grid ${COLS} items-center h-7 pl-4`} style={{ width: contentWidth }}>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {group.entry ? formatTime(group.entry.creationTimestamp, showDate) : formatTime(group.earliestTime, showDate)}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={group.isLong ? 'text-(--color-buy)' : 'text-(--color-sell)'}>
                    {group.isLong ? 'Long' : 'Short'}
                  </span>
                </div>
                <div className="px-3 text-center text-(--color-text) whitespace-nowrap">
                  {shortSymbol(group.exits[0].contractId)}
                </div>
                <div className="px-3 text-center text-(--color-text)">{group.totalQty}</div>
                <div className="px-3 text-center text-(--color-text) whitespace-nowrap">
                  {group.entry ? group.entry.price.toFixed(2) : '—'}
                </div>
                <div
                  className="px-3 text-center text-(--color-text-muted) whitespace-nowrap cursor-pointer select-none hover:text-(--color-text) transition-colors"
                  onClick={(e) => { e.stopPropagation(); toggleExpand(group.entryId); }}
                >
                  {group.exits.length} exits {isExpanded ? '▾' : '▸'}
                </div>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {group.entry ? formatDuration(tradingDurationMs(group.entry.creationTimestamp, group.latestTime)) : '—'}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  {onPnlModeToggle ? (
                    <span
                      onClick={(e) => { e.stopPropagation(); onPnlModeToggle(); }}
                      title={pnlMode === '$' ? 'Switch to points' : 'Switch to dollars'}
                      className="cursor-pointer rounded px-1 hover:bg-(--color-hover-row) transition-all"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <span className={group.totalPnl > 0 ? 'text-(--color-buy)' : group.totalPnl < 0 ? 'text-(--color-sell)' : 'text-(--color-text-muted)'}>
                        {group.totalPnl > 0 ? '+' : ''}{group.totalPnl.toFixed(2)}
                      </span>
                      <span className="font-normal text-(--color-text-muted)" style={{ opacity: 0.6 }}>
                        {pnlMode === '$' ? '$' : 'pt'}
                      </span>
                    </span>
                  ) : (
                    <span className={group.totalPnl > 0 ? 'text-(--color-buy)' : group.totalPnl < 0 ? 'text-(--color-sell)' : 'text-(--color-text-muted)'}>
                      {group.totalPnl > 0 ? '+' : ''}{group.totalPnl.toFixed(2)}
                    </span>
                  )}
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
              const tradeComm = trade.commissions;
              const net = (trade.profitAndLoss ?? 0) - tradeFees - tradeComm;
              const isVisible = selectedIds.includes(trade.id);
              const subStripe = rowIdx++ % 2 === 1 ? TABLE_ROW_STRIPE : '';
              const subSelected = isVisible ? 'bg-(--color-warning)/10 border border-(--color-warning)/60' : 'border border-transparent';

              return (
                <div
                  key={trade.id}
                  className={`${subStripe} ${subSelected} row-hover`}
                  onClick={onSingleClick ? (e) => { e.stopPropagation(); onSingleClick(trade.id); } : undefined}
                >
                  <div className={`grid ${COLS} items-center h-7`} style={{ width: contentWidth, paddingLeft: 'calc(1rem + 20px)' }}>
                    <div className="px-3 text-center text-(--color-text-muted)/60 whitespace-nowrap">
                      {formatTime(trade.creationTimestamp, showDate)}
                    </div>
                    <div className="px-3 text-center" />
                    <div className="px-3 text-center" />
                    <div className="px-3 text-center text-(--color-text-muted)">{trade.size}</div>
                    <div className="px-3 text-center" />
                    <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">{trade.price.toFixed(2)}</div>
                    <div className="px-3 text-center text-(--color-text-muted)/60 whitespace-nowrap">
                      {group.entry ? formatDuration(tradingDurationMs(group.entry.creationTimestamp, trade.creationTimestamp)) : '—'}
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
                      {tradeComm.toFixed(2)}
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
