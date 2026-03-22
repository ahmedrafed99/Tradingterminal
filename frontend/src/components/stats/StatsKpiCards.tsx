import { useEffect, useRef, useState } from 'react';
import type { TradeStats } from '../../utils/tradeStats';
import { formatTime } from '../../utils/formatters';

// ── Animated number hook ─────────────────────────────────────────────────────

function useAnimatedValue(target: number, duration = 1200): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const fromRef = useRef(0);

  useEffect(() => {
    fromRef.current = 0;
    startRef.current = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(fromRef.current + (target - fromRef.current) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

function AnimatedDollar({ value, fontSize = 28, color }: { value: number; fontSize?: number; color: string }) {
  const animated = useAnimatedValue(value);
  const sign = animated > 0.005 ? '+' : '';
  return (
    <span
      className="font-semibold"
      style={{ fontSize, color, fontFeatureSettings: '"tnum"', lineHeight: 1 }}
    >
      {sign}${Math.abs(animated).toFixed(2)}
    </span>
  );
}

function AnimatedPercent({ value, fontSize = 28, color }: { value: number; fontSize?: number; color: string }) {
  const animated = useAnimatedValue(value);
  return (
    <span
      className="font-semibold"
      style={{ fontSize, color, fontFeatureSettings: '"tnum"', lineHeight: 1 }}
    >
      {animated.toFixed(1)}%
    </span>
  );
}

function AnimatedInt({ value, fontSize = 16, color }: { value: number; fontSize?: number; color: string }) {
  const animated = useAnimatedValue(value);
  return (
    <span
      className="font-semibold"
      style={{ fontSize, color, fontFeatureSettings: '"tnum"' }}
    >
      {Math.round(animated)}
    </span>
  );
}

function AnimatedNumber({ value, fontSize = 28, color, prefix = '', suffix = '' }: {
  value: number; fontSize?: number; color: string; prefix?: string; suffix?: string;
}) {
  const animated = useAnimatedValue(value);
  return (
    <span
      className="font-semibold"
      style={{ fontSize, color, fontFeatureSettings: '"tnum"', lineHeight: 1 }}
    >
      {prefix}{animated.toFixed(2)}{suffix}
    </span>
  );
}

// ── SVG Donut for Win Rate ───────────────────────────────────────────────────

function WinRateDonut({ winRate, winners, losers }: { winRate: number; winners: number; losers: number }) {
  const size = 90;
  const radius = 36;
  const stroke = 7;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75; // 270° arc
  const winArc = arcLength * winRate;
  const lossArc = arcLength - winArc;

  // Animate: start with 0 dasharray, transition to target
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  return (
    <div className="relative" style={{ width: size + 20, height: size }}>
      <svg width={size} height={size} viewBox="0 0 90 90" style={{ position: 'absolute', left: 10, top: 0 }}>
        <circle
          cx="45" cy="45" r={radius}
          fill="none"
          stroke="var(--color-buy)"
          strokeWidth={stroke}
          strokeDasharray={`${mounted ? winArc : 0} ${circumference}`}
          strokeLinecap="round"
          opacity={0.85}
          style={{
            transform: 'rotate(135deg)',
            transformOrigin: '45px 45px',
            transition: 'stroke-dasharray 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
        <circle
          cx="45" cy="45" r={radius}
          fill="none"
          stroke="var(--color-sell)"
          strokeWidth={stroke}
          strokeDasharray={`${mounted ? lossArc : 0} ${circumference}`}
          strokeDashoffset={mounted ? -winArc : 0}
          strokeLinecap="round"
          opacity={0.85}
          style={{
            transform: 'rotate(135deg)',
            transformOrigin: '45px 45px',
            transition: 'stroke-dasharray 0.8s cubic-bezier(0.16, 1, 0.3, 1), stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </svg>
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

// ── Card shell ───────────────────────────────────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background: 'var(--color-table-stripe)',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  padding: '20px 24px',
};

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={CARD_STYLE}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10, letterSpacing: '0.02em' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

import { pnlColor } from './statsHelpers';

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
      {/* Row 1 */}
      <StatCard label="Total P&L">
        <div className="flex items-center" style={{ height: 90 }}>
          <AnimatedDollar value={stats.netPnl} color={pnlColor(stats.netPnl)} />
        </div>
      </StatCard>

      <StatCard label="Trade Win %">
        <div className="flex items-center justify-between">
          <AnimatedPercent value={stats.winRate * 100} color="var(--color-text-bright)" />
          <WinRateDonut winRate={stats.winRate} winners={stats.winners} losers={stats.losers} />
        </div>
      </StatCard>

      <StatCard label="Avg Win / Avg Loss">
        <div className="flex items-center" style={{ height: 90 }}>
          <div style={{ fontFeatureSettings: '"tnum"' }}>
            <AnimatedNumber value={stats.avgWinner} fontSize={28} color="var(--color-buy)" prefix="+$" />
            <span style={{ fontSize: 20, color: 'var(--color-text-dim)', margin: '0 8px' }}>/</span>
            <AnimatedNumber value={stats.avgLoser} fontSize={28} color="var(--color-sell)" prefix="-$" />
          </div>
        </div>
      </StatCard>

      {/* Row 2 */}
      <StatCard label="Profit Factor">
        <div className="flex items-center" style={{ height: 90 }}>
          {stats.profitFactor === Infinity ? (
            <span className="font-semibold" style={{ fontSize: 28, color: 'var(--color-buy)', fontFeatureSettings: '"tnum"', lineHeight: 1 }}>∞</span>
          ) : (
            <AnimatedNumber
              value={stats.profitFactor}
              fontSize={28}
              color={stats.profitFactor >= 1 ? 'var(--color-buy)' : 'var(--color-sell)'}
            />
          )}
        </div>
      </StatCard>

      <StatCard label="Best / Worst Trade">
        <div className="flex items-center" style={{ height: 90 }}>
          <div className="flex" style={{ gap: 20 }}>
            <div>
              {stats.bestTrade ? (
                <AnimatedDollar value={stats.bestTrade.totalNet} fontSize={20} color="var(--color-buy)" />
              ) : (
                <span className="font-semibold" style={{ fontSize: 20, color: 'var(--color-text-muted)' }}>—</span>
              )}
              {stats.bestTrade && (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {formatTime(stats.bestTrade.exitTime, true)}
                </div>
              )}
            </div>
            <div style={{ width: 1, background: 'var(--color-border)', alignSelf: 'stretch' }} />
            <div>
              {stats.worstTrade ? (
                <AnimatedDollar value={stats.worstTrade.totalNet} fontSize={20} color="var(--color-sell)" />
              ) : (
                <span className="font-semibold" style={{ fontSize: 20, color: 'var(--color-text-muted)' }}>—</span>
              )}
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
            <AnimatedInt value={stats.maxWinStreak} color="var(--color-buy)" />
          </div>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loss Streak</span>
            <AnimatedInt value={stats.maxLossStreak} color="var(--color-sell)" />
          </div>
          <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Max Drawdown</span>
            {stats.maxDrawdown > 0 ? (
              <AnimatedDollar value={-stats.maxDrawdown} fontSize={16} color="var(--color-sell)" />
            ) : (
              <span className="font-semibold" style={{ fontSize: 16, color: 'var(--color-sell)' }}>—</span>
            )}
          </div>
        </div>
      </StatCard>
    </div>
  );
}
