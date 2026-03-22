import type { TradeStats } from '../../utils/tradeStats';
import { formatTime } from '../../utils/formatters';

// ── SVG Donut for Win Rate ───────────────────────────────────────────────────

function WinRateDonut({ winRate, winners, losers }: { winRate: number; winners: number; losers: number }) {
  const size = 90;
  const radius = 36;
  const stroke = 7;
  const circumference = 2 * Math.PI * radius;
  // Semi-circle (bottom open) — rotate so gap is at bottom
  const arcLength = circumference * 0.75; // 270° arc
  const winArc = arcLength * winRate;
  const lossArc = arcLength - winArc;

  return (
    <div className="relative" style={{ width: size + 20, height: size }}>
      <svg width={size} height={size} viewBox="0 0 90 90" style={{ position: 'absolute', left: 10, top: 0 }}>
        {/* Win arc — starts from top-left, sweeps clockwise */}
        <circle
          cx="45" cy="45" r={radius}
          fill="none"
          stroke="var(--color-buy)"
          strokeWidth={stroke}
          strokeDasharray={`${winArc} ${circumference}`}
          strokeLinecap="round"
          opacity={0.85}
          style={{ transform: 'rotate(135deg)', transformOrigin: '45px 45px' }}
        />
        {/* Loss arc — continues after win arc */}
        <circle
          cx="45" cy="45" r={radius}
          fill="none"
          stroke="var(--color-sell)"
          strokeWidth={stroke}
          strokeDasharray={`${lossArc} ${circumference}`}
          strokeDashoffset={-winArc}
          strokeLinecap="round"
          opacity={0.85}
          style={{ transform: 'rotate(135deg)', transformOrigin: '45px 45px' }}
        />
      </svg>
      {/* Win count — top left of arc */}
      <div
        className="font-semibold"
        style={{
          position: 'absolute',
          top: -2,
          left: 0,
          fontSize: 12,
          color: 'var(--color-buy)',
          fontFeatureSettings: '"tnum"',
        }}
      >
        {winners}
      </div>
      {/* Loss count — bottom right of arc */}
      <div
        className="font-semibold"
        style={{
          position: 'absolute',
          bottom: 4,
          right: -4,
          fontSize: 12,
          color: 'var(--color-sell)',
          fontFeatureSettings: '"tnum"',
        }}
      >
        {losers}
      </div>
    </div>
  );
}

// ── Avg Win / Avg Loss proportional bar ──────────────────────────────────────

function WinLossBar({ avgWinner, avgLoser }: { avgWinner: number; avgLoser: number }) {
  const total = avgWinner + avgLoser;
  const winPct = total > 0 ? (avgWinner / total) * 100 : 50;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--color-buy)', fontFeatureSettings: '"tnum"' }}>
          ${avgWinner.toFixed(2)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-sell)', fontFeatureSettings: '"tnum"' }}>
          -${avgLoser.toFixed(2)}
        </span>
      </div>
      <div className="flex overflow-hidden" style={{ height: 6, borderRadius: 3, gap: 2 }}>
        <div
          style={{
            width: `${winPct}%`,
            background: 'var(--color-buy)',
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }}
        />
        <div
          style={{
            width: `${100 - winPct}%`,
            background: 'var(--color-sell)',
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

// ── Card shell ───────────────────────────────────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  padding: '20px 24px',
};

function StatCard({ label, children, span }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={{ ...CARD_STYLE, gridColumn: span ? `span ${span}` : undefined }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10, letterSpacing: '0.02em' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pnlColor(v: number): string {
  if (v > 0) return 'var(--color-buy)';
  if (v < 0) return 'var(--color-sell)';
  return 'var(--color-text-muted)';
}

function fmtDollar(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

// ── Main Export ──────────────────────────────────────────────────────────────

export function StatsKpiCards({ stats }: { stats: TradeStats }) {
  const pf = stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2);

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
      }}
    >
      {/* Row 1: Total P&L — Win Rate (with donut) — Avg Win / Avg Loss (with bar) */}
      <StatCard label="Total P&L">
        <div className="flex items-center" style={{ height: 90 }}>
          <div
            className="font-semibold"
            style={{ fontSize: 28, color: pnlColor(stats.netPnl), fontFeatureSettings: '"tnum"', lineHeight: 1 }}
          >
            {fmtDollar(stats.netPnl)}
          </div>
        </div>
      </StatCard>

      <StatCard label="Trade Win %">
        <div className="flex items-center justify-between">
          <div
            className="font-semibold"
            style={{ fontSize: 28, color: 'var(--color-text-bright)', fontFeatureSettings: '"tnum"', lineHeight: 1 }}
          >
            {(stats.winRate * 100).toFixed(1)}%
          </div>
          <WinRateDonut winRate={stats.winRate} winners={stats.winners} losers={stats.losers} />
        </div>
      </StatCard>

      <StatCard label="Avg Win / Avg Loss">
        <div className="flex items-center" style={{ height: 90 }}>
          <div style={{ fontFeatureSettings: '"tnum"' }}>
            <span className="font-semibold" style={{ fontSize: 28, color: 'var(--color-buy)' }}>
              +${stats.avgWinner.toFixed(2)}
            </span>
            <span style={{ fontSize: 20, color: 'var(--color-text-dim)', margin: '0 8px' }}>/</span>
            <span className="font-semibold" style={{ fontSize: 28, color: 'var(--color-sell)' }}>
              -${stats.avgLoser.toFixed(2)}
            </span>
          </div>
        </div>
      </StatCard>

      {/* Row 2: Profit Factor — Best / Worst Trade — Streaks & Drawdown */}
      <StatCard label="Profit Factor">
        <div className="flex items-center" style={{ height: 90 }}>
          <div
            className="font-semibold"
            style={{
              fontSize: 28,
              color: stats.profitFactor >= 1 ? 'var(--color-buy)' : 'var(--color-sell)',
              fontFeatureSettings: '"tnum"',
              lineHeight: 1,
            }}
          >
            {pf}
          </div>
        </div>
      </StatCard>

      <StatCard label="Best / Worst Trade">
        <div className="flex items-center" style={{ height: 90 }}>
          <div className="flex" style={{ gap: 20 }}>
            <div>
              <div
                className="font-semibold"
                style={{ fontSize: 20, color: 'var(--color-buy)', fontFeatureSettings: '"tnum"', lineHeight: 1 }}
              >
                {stats.bestTrade ? fmtDollar(stats.bestTrade.totalNet) : '—'}
              </div>
              {stats.bestTrade && (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {formatTime(stats.bestTrade.exitTime, true)}
                </div>
              )}
            </div>
            <div style={{ width: 1, background: 'var(--color-border)', alignSelf: 'stretch' }} />
            <div>
              <div
                className="font-semibold"
                style={{ fontSize: 20, color: 'var(--color-sell)', fontFeatureSettings: '"tnum"', lineHeight: 1 }}
              >
                {stats.worstTrade ? fmtDollar(stats.worstTrade.totalNet) : '—'}
              </div>
              {stats.worstTrade && (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {formatTime(stats.worstTrade.exitTime, true)}
                </div>
              )}
            </div>
          </div>
        </div>
      </StatCard>

      <StatCard label="Streaks & Drawdown">
        <div className="flex flex-col" style={{ gap: 8 }}>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Win Streak</span>
            <span className="font-semibold" style={{ fontSize: 16, color: 'var(--color-buy)', fontFeatureSettings: '"tnum"' }}>
              {stats.maxWinStreak}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loss Streak</span>
            <span className="font-semibold" style={{ fontSize: 16, color: 'var(--color-sell)', fontFeatureSettings: '"tnum"' }}>
              {stats.maxLossStreak}
            </span>
          </div>
          <div
            style={{
              height: 1,
              background: 'var(--color-border)',
              margin: '2px 0',
            }}
          />
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Max Drawdown</span>
            <span className="font-semibold" style={{ fontSize: 16, color: 'var(--color-sell)', fontFeatureSettings: '"tnum"' }}>
              {stats.maxDrawdown > 0 ? fmtDollar(-stats.maxDrawdown) : '—'}
            </span>
          </div>
        </div>
      </StatCard>
    </div>
  );
}
