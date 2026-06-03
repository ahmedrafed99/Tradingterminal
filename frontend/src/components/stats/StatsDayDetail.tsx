import { useMemo } from 'react';
import type { GroupedTrade } from '../../utils/tradeStats';
import { computeStats } from '../../utils/tradeStats';
import { pnlColor, fmtDollar } from './statsHelpers';
import { EquityCurveChart } from '../backtest/EquityCurveChart';
import { TradesTable } from '../shared/TradesTable';

export function StatsDayDetail({ date, trades, onBack }: {
  date: string; // YYYY-MM-DD
  trades: GroupedTrade[];
  onBack: () => void;
}) {
  const stats = useMemo(() => computeStats(trades), [trades]);

  const displayDate = useMemo(() => {
    const midDayDate = new Date(date + 'T12:00:00');
    return midDayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }, [date]);

  // Prepend a zero-equity anchor at the first trade's entry so the chart has a
  // proper horizontal range and fitContent() centers the data instead of
  // parking a single point off to the right.
  const chartPoints = useMemo(() => {
    if (trades.length === 0) return [];
    const anchor = { t: trades[0].entryTime, equity: 0 };
    return [anchor, ...trades.map((tr, i) => ({ t: tr.exitTime, equity: stats.equityCurve[i] }))];
  }, [trades, stats.equityCurve]);

  // Map GroupedTrade → TradeRowInput for TradesTable
  const tradeInputs = useMemo(
    () => trades.map((t) => ({ entryId: t.entryId, entry: t.entry, exits: t.exits, isLong: t.isLong })),
    [trades],
  );

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* Header */}
      <div className="flex items-center" style={{ gap: 12 }}>
        <button
          onClick={onBack}
          className="cursor-pointer transition-colors text-(--color-text-muted) hover:text-(--color-text-bright)"
          style={{ fontSize: 14, background: 'none', border: 'none', padding: '4px 8px', borderRadius: 4 }}
        >
          ← Back
        </button>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-bright)' }}>
          {displayDate}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: pnlColor(stats.netPnl), fontFeatureSettings: '"tnum"', marginLeft: 8 }}>
          {fmtDollar(stats.netPnl)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}>
          {stats.totalTrades} {stats.totalTrades === 1 ? 'trade' : 'trades'} · {stats.winners}W / {stats.losers}L
        </div>
      </div>

      {/* Day equity curve */}
      <div style={{ background: 'var(--color-popover)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.02em', marginBottom: 12 }}>
          Day Equity Curve
        </div>
        <EquityCurveChart
          points={chartPoints}
          initialEquity={0}
          height="clamp(220px, 40vh, 480px)"
          showMarkers
          background='var(--color-popover)'
        />
      </div>

      {/* Trade list */}
      <div style={{ background: 'var(--color-popover)', border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
        <TradesTable
          groups={tradeInputs}
          showDate={false}
          contentWidth="100%"
          stickyBg="var(--color-popover)"
          stickyHeader={false}
        />
      </div>
    </div>
  );
}

