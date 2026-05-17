import type { BacktestTrade } from '../../services/backtestService';
import { useStore } from '../../store/useStore';
import { SortableTable, type SortableColumn } from '../shared/SortableTable';

interface Props {
  trades: BacktestTrade[];
}

const cols = 'grid-cols-[1.4fr_0.6fr_1fr_1fr_0.8fr_0.9fr]';

const COLUMNS: SortableColumn<BacktestTrade>[] = [
  {
    key:       'entryTime',
    label:     'Entry Time',
    sortValue: (t) => t.entryTime,
    render:    (t) => (
      <span className="text-(--color-text-muted)">
        {new Date(t.entryTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </span>
    ),
  },
  {
    key:       'side',
    label:     'Side',
    sortValue: (t) => t.side,
    render:    (t) => (
      <span className={t.side === 'long' ? 'text-(--color-buy)' : 'text-(--color-sell)'}>
        {t.side === 'long' ? 'Long' : 'Short'}
      </span>
    ),
  },
  {
    key:       'entry',
    label:     'Entry',
    sortValue: (t) => t.entryPrice,
    render:    (t) => <span className="text-(--color-text)">{t.entryPrice.toFixed(2)}</span>,
  },
  {
    key:       'exit',
    label:     'Exit',
    sortValue: (t) => t.exitPrice,
    render:    (t) => <span className="text-(--color-text)">{t.exitPrice.toFixed(2)}</span>,
  },
  {
    key:       'fees',
    label:     'Fees',
    sortValue: (t) => t.fees,
    render:    (t) => <span className="text-(--color-text-muted)">{t.fees.toFixed(2)}</span>,
  },
  {
    key:       'pnl',
    label:     'P&L',
    sortValue: (t) => t.pnl,
    render:    (t) => {
      const cls = t.pnl > 0 ? 'text-(--color-buy)' : t.pnl < 0 ? 'text-(--color-sell)' : 'text-(--color-text-muted)';
      return <span className={`font-medium ${cls}`}>{t.pnl > 0 ? '+' : ''}{t.pnl.toFixed(2)}</span>;
    },
  },
];

export function BacktestTradesTable({ trades }: Props) {
  const selectedIndex    = useStore((s) => s.backtestSelectedTradeIndex);
  const setSelectedIndex = useStore((s) => s.setBacktestSelectedTradeIndex);

  return (
    <SortableTable
      rows={trades}
      columns={COLUMNS}
      gridCols={cols}
      getRowKey={(_t, i) => i}
      selectedKey={selectedIndex}
      onRowClick={(_t, i) => setSelectedIndex(selectedIndex === i ? null : i)}
      defaultSort={{ key: 'entryTime', dir: 'asc' }}
      maxHeight={280}
    />
  );
}
