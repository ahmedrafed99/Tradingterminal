import { useMemo } from 'react';
import type { GroupedTrade } from '../../utils/tradeStats';
import { computeStats } from '../../utils/tradeStats';
import { formatDuration } from '../../utils/formatters';
import { tradingDurationMs } from '../../utils/marketHours';
import { COLOR_TABLE_STRIPE } from '../../constants/colors';
import { pnlColor, fmtDollar, hexToRgba } from './statsHelpers';
import { EquityCurveCanvas } from './EquityCurveCanvas';
import type { EquityCurveConfig } from './EquityCurveCanvas';

const DAY_CURVE_CONFIG: EquityCurveConfig = {
  height: 160,
  pad: { top: 16, right: 20, bottom: 28, left: 56 },
  dotThreshold: 0, // always show dots
  dotRadius: 3.5,
  gridTargetLines: 3,
};

export function StatsDayDetail({ date, trades, onBack }: {
  date: string; // YYYY-MM-DD
  trades: GroupedTrade[];
  onBack: () => void;
}) {
  const stats = useMemo(() => computeStats(trades), [trades]);

  // Format date for display
  const displayDate = useMemo(() => {
    const d = new Date(date + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }, [date]);

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* Header with back button */}
      <div className="flex items-center" style={{ gap: 12 }}>
        <button
          onClick={onBack}
          className="cursor-pointer transition-colors text-(--color-text-muted) hover:text-(--color-text-bright)"
          style={{
            fontSize: 14,
            background: 'none',
            border: 'none',
            padding: '4px 8px',
            borderRadius: 4,
          }}
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
      <EquityCurveCanvas
        curve={stats.equityCurve}
        exitTimes={trades.map(t => t.exitTime)}
        title="Day Equity Curve"
        config={DAY_CURVE_CONFIG}
      />

      {/* Trade list */}
      <div
        style={{
          background: 'var(--color-table-stripe)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {/* Table header */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: '1fr 0.6fr 0.8fr 0.8fr 0.8fr 0.8fr 0.8fr',
            padding: '12px 20px',
            borderBottom: '1px solid var(--color-border)',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          {['Time', 'Side', 'Qty', 'Entry', 'Exit', 'Duration', 'Net P&L'].map((h) => (
            <div
              key={h}
              className="text-center"
              style={{ fontSize: 12, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              {h}
            </div>
          ))}
        </div>

        {/* Trade rows */}
        {trades.map((t, idx) => {
          const isLast = idx === trades.length - 1;
          const dur = t.entry
            ? tradingDurationMs(t.entryTime, t.exitTime)
            : 0;
          const exitTime = new Date(t.exitTime).toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/New_York',
          });

          return (
            <div
              key={t.entryId}
              className="grid transition-colors"
              style={{
                gridTemplateColumns: '1fr 0.6fr 0.8fr 0.8fr 0.8fr 0.8fr 0.8fr',
                padding: '10px 20px',
                borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
                background: idx % 2 === 1 ? hexToRgba(COLOR_TABLE_STRIPE, 0.5) : 'transparent',
              }}
            >
              <div className="text-center" style={{ fontSize: 13, color: 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}>
                {exitTime}
              </div>
              <div className="text-center" style={{ fontSize: 13, color: t.isLong ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                {t.isLong ? 'Long' : 'Short'}
              </div>
              <div className="text-center" style={{ fontSize: 13, color: 'var(--color-text)', fontFeatureSettings: '"tnum"' }}>
                {t.totalQty}
              </div>
              <div className="text-center" style={{ fontSize: 13, color: 'var(--color-text)', fontFeatureSettings: '"tnum"' }}>
                {t.entryPrice != null ? t.entryPrice.toFixed(2) : '—'}
              </div>
              <div className="text-center" style={{ fontSize: 13, color: 'var(--color-text)', fontFeatureSettings: '"tnum"' }}>
                {t.exitPrice.toFixed(2)}
              </div>
              <div className="text-center" style={{ fontSize: 13, color: 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}>
                {dur > 0 ? formatDuration(dur) : '—'}
              </div>
              <div className="text-center" style={{ fontSize: 13, fontWeight: 600, color: pnlColor(t.totalNet), fontFeatureSettings: '"tnum"' }}>
                {fmtDollar(t.totalNet)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

