import { useState, useEffect, useMemo } from 'react';
import type { HourPnl, DirectionStats, DayOfWeekPnl, DurationComparison, GroupedTrade } from '../../utils/tradeStats';
import { buildHourlyData } from '../../utils/tradeStats';
import { formatDuration } from '../../utils/formatters';
import { pnlColor, hexToRgba } from './statsHelpers';
import { COLOR_BUY, COLOR_SELL, COLOR_TABLE_STRIPE } from '../../constants/colors';

const NY_DOW = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' });

const CARD: React.CSSProperties = {
  background: 'var(--color-table-stripe)',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  padding: '20px 24px',
};

const LABEL: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--color-text)',
  marginBottom: 16,
  letterSpacing: '0.02em',
};

// ── Shared tooltip ───────────────────────────────────────────────────────────

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  return (
    <div
      className="relative"
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setPos({ x: rect.width / 2, y: -4 });
        setShow(true);
      }}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div
          style={{
            position: 'absolute',
            left: pos.x,
            top: pos.y,
            transform: 'translate(-50%, -100%)',
            background: hexToRgba(COLOR_TABLE_STRIPE, 0.95),
            border: '1px solid var(--color-border)',
            borderRadius: 5,
            padding: '5px 10px',
            fontSize: 12,
            color: 'var(--color-text)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

// ── Time of Day ──────────────────────────────────────────────────────────────

function TimeOfDay({ data, filterDay }: { data: HourPnl[]; filterDay: string | null }) {
  if (data.length === 0) return null;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.net)), 1);

  return (
    <div style={CARD}>
      <div style={{ ...LABEL, display: 'flex', alignItems: 'center', gap: 8 }}>
        P&L by Hour
        {filterDay && (
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 7px' }}>
            {filterDay}
          </span>
        )}
      </div>
      <div className="flex flex-col" style={{ gap: 6 }}>
        {data.map((h) => {
          const pct = maxAbs > 0 ? Math.abs(h.net) / maxAbs : 0;
          const barW = Math.max(0, pct * 100);
          const isPos = h.net >= 0;
          const sign = h.net > 0 ? '+' : h.net < 0 ? '-' : '';
          const avg = h.count > 0 ? h.net / h.count : 0;
          const tooltipText = `${h.count} trades · Net: ${sign}$${Math.abs(h.net).toFixed(0)} · Avg: $${avg.toFixed(0)}`;

          const barColor = isPos ? COLOR_BUY : COLOR_SELL;

          return (
            <Tooltip key={h.hour} text={tooltipText}>
              <div
                className="flex items-center transition-colors hover:bg-(--color-hover-row)"
                style={{ gap: 10, cursor: 'default', padding: '3px 6px', borderRadius: 6 }}
              >
                <div style={{ width: 32, fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
                  {h.hour}:00
                </div>
                <div className="flex-1 group" style={{ height: 16, position: 'relative' }}>
                  <div
                    className="transition-all"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 1,
                      width: `${barW}%`,
                      height: 14,
                      background: hexToRgba(barColor, 0.5),
                      borderRadius: 4,
                      minWidth: h.count > 0 ? 6 : 0,
                      transition: 'width 0.3s ease, background 0.15s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = hexToRgba(barColor, 0.8); }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = hexToRgba(barColor, 0.5); }}
                  />
                </div>
                <div
                  style={{
                    width: 52,
                    textAlign: 'right',
                    fontSize: 12,
                    fontWeight: 500,
                    color: pnlColor(h.net),
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {h.count > 0 ? `$${h.net.toFixed(0)}` : '—'}
                </div>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ── Long vs Short ────────────────────────────────────────────────────────────

function MiniDonut({ rate, color, size = 40 }: { rate: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const arc = circ * rate;
  const [mounted, setMounted] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setMounted(true)); }, []);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={4} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${mounted ? arc : 0} ${circ}`}
        strokeLinecap="round"
        opacity={0.85}
        style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}
      />
    </svg>
  );
}

function LongVsShort({ long, short }: { long: DirectionStats; short: DirectionStats }) {
  const totalTrades = long.count + short.count;
  const longPct = totalTrades > 0 ? long.count / totalTrades : 0.5;
  const totalNet = Math.abs(long.totalNet) + Math.abs(short.totalNet);
  const longNetPct = totalNet > 0 ? Math.abs(long.totalNet) / totalNet * 100 : 50;

  const SEP = <div style={{ width: 1, background: 'var(--color-border)', alignSelf: 'stretch' }} />;

  return (
    <div style={CARD}>
      <div style={LABEL}>Long vs Short</div>

      {/* Trades — full-width horizontal bar */}
      <div style={{ marginBottom: 16 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--color-buy)', fontWeight: 500, fontFeatureSettings: '"tnum"' }}>{long.count} Long</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trades</span>
          <span style={{ fontSize: 12, color: 'var(--color-sell)', fontWeight: 500, fontFeatureSettings: '"tnum"' }}>{short.count} Short</span>
        </div>
        <div className="flex overflow-hidden" style={{ height: 8, borderRadius: 4, gap: 2 }}>
          <div style={{ width: `${longPct * 100}%`, background: 'var(--color-buy)', borderRadius: 4, opacity: 0.7, transition: 'width 0.3s ease' }} />
          <div style={{ width: `${(1 - longPct) * 100}%`, background: 'var(--color-sell)', borderRadius: 4, opacity: 0.7, transition: 'width 0.3s ease' }} />
        </div>
      </div>

      {/* Two-column layout with vertical separator */}
      <div className="flex" style={{ gap: 0, marginTop: 60 }}>
        {/* Long column */}
        <div className="flex-1 flex flex-col items-center" style={{ gap: 22 }}>
          {/* Win rate donut */}
          <div className="flex flex-col items-center" style={{ gap: 6 }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Win Rate</div>
            <MiniDonut rate={long.winRate} color="var(--color-text)" size={64} />
            <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', fontFeatureSettings: '"tnum"' }}>
              {(long.winRate * 100).toFixed(0)}%
            </span>
          </div>

          {/* Avg Win/Loss */}
          <div className="text-center">
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Win / Loss</div>
            <div style={{ fontFeatureSettings: '"tnum"' }}>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-buy)' }}>{long.avgWinner > 0 ? `+$${long.avgWinner.toFixed(2)}` : '—'}</span>
              <span style={{ fontSize: 13, color: 'var(--color-text-dim)', margin: '0 6px' }}>/</span>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-sell)' }}>{long.avgLoser > 0 ? `-$${long.avgLoser.toFixed(2)}` : '—'}</span>
            </div>
          </div>

          {/* Total net */}
          <div className="text-center">
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Net</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: pnlColor(long.totalNet), fontFeatureSettings: '"tnum"' }}>${long.totalNet.toFixed(2)}</div>
          </div>
        </div>

        {SEP}

        {/* Short column */}
        <div className="flex-1 flex flex-col items-center" style={{ gap: 22 }}>
          {/* Win rate donut */}
          <div className="flex flex-col items-center" style={{ gap: 6 }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Win Rate</div>
            <MiniDonut rate={short.winRate} color="var(--color-text)" size={64} />
            <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', fontFeatureSettings: '"tnum"' }}>
              {(short.winRate * 100).toFixed(0)}%
            </span>
          </div>

          {/* Avg Win/Loss */}
          <div className="text-center">
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Win / Loss</div>
            <div style={{ fontFeatureSettings: '"tnum"' }}>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-buy)' }}>{short.avgWinner > 0 ? `+$${short.avgWinner.toFixed(2)}` : '—'}</span>
              <span style={{ fontSize: 13, color: 'var(--color-text-dim)', margin: '0 6px' }}>/</span>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-sell)' }}>{short.avgLoser > 0 ? `-$${short.avgLoser.toFixed(2)}` : '—'}</span>
            </div>
          </div>

          {/* Total net */}
          <div className="text-center">
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Net</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: pnlColor(short.totalNet), fontFeatureSettings: '"tnum"' }}>${short.totalNet.toFixed(2)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Day of Week ──────────────────────────────────────────────────────────────

function DayOfWeek({ data, selectedDay, onDaySelect }: { data: DayOfWeekPnl[]; selectedDay: string | null; onDaySelect: (day: string | null) => void }) {
  if (data.length === 0) return null;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.avgNet)), 1);

  return (
    <div style={CARD}>
      <div style={{ ...LABEL, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Performance by Day
        {selectedDay && (
          <button
            onClick={() => onDaySelect(null)}
            style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-col" style={{ gap: 6 }}>
        {data.map((d) => {
          const pct = maxAbs > 0 ? Math.abs(d.avgNet) / maxAbs : 0;
          const barW = Math.max(0, pct * 100);
          const sign = d.totalNet > 0 ? '+' : d.totalNet < 0 ? '-' : '';
          const tooltipText = d.count > 0
            ? `${d.count} days · Total: ${sign}$${Math.abs(d.totalNet).toFixed(0)} · Avg: $${d.avgNet.toFixed(0)}`
            : 'No trades';
          const barColor = d.avgNet >= 0 ? COLOR_BUY : COLOR_SELL;
          const isSelected = selectedDay === d.day;
          const isClickable = d.count > 0;

          return (
            <Tooltip key={d.day} text={tooltipText}>
              <div
                className="flex items-center transition-colors"
                onClick={() => isClickable && onDaySelect(isSelected ? null : d.day)}
                style={{
                  gap: 10,
                  cursor: isClickable ? 'pointer' : 'default',
                  padding: '3px 6px',
                  borderRadius: 6,
                  background: isSelected ? hexToRgba(barColor, 0.12) : 'transparent',
                  outline: isSelected ? `1px solid ${hexToRgba(barColor, 0.35)}` : 'none',
                  transition: 'background 0.15s ease, outline 0.15s ease',
                }}
              >
                <div style={{ width: 30, fontSize: 12, color: isSelected ? 'var(--color-text)' : 'var(--color-text-muted)', fontWeight: isSelected ? 600 : 400, transition: 'color 0.15s ease' }}>{d.day}</div>
                <div className="flex-1" style={{ height: 18, position: 'relative' }}>
                  <div
                    className="transition-all"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 2,
                      width: `${barW}%`,
                      height: 14,
                      background: hexToRgba(barColor, isSelected ? 0.75 : 0.5),
                      borderRadius: 4,
                      minWidth: d.count > 0 ? 6 : 0,
                      transition: 'width 0.3s ease, background 0.15s ease',
                    }}
                  />
                </div>
                <div
                  style={{
                    width: 56,
                    textAlign: 'right',
                    fontSize: 12,
                    fontWeight: isSelected ? 600 : 500,
                    color: pnlColor(d.avgNet),
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {d.count > 0 ? `$${d.avgNet.toFixed(0)}` : '—'}
                </div>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ── Duration ─────────────────────────────────────────────────────────────────

function DurationBreakdown({ data }: { data: DurationComparison }) {
  const maxDur = Math.max(data.avgWinnerDuration, data.avgLoserDuration) || 1;
  const winPct = (data.avgWinnerDuration / maxDur) * 100;
  const lossPct = (data.avgLoserDuration / maxDur) * 100;

  return (
    <div style={CARD}>
      <div style={LABEL}>Avg Trade Duration</div>
      <div className="flex flex-col" style={{ gap: 12 }}>
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Winners</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-buy)', fontFeatureSettings: '"tnum"' }}>
              {data.avgWinnerDuration > 0 ? formatDuration(data.avgWinnerDuration) : '—'}
            </span>
          </div>
          <div style={{ height: 8, background: 'var(--color-surface)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                width: `${winPct}%`,
                height: '100%',
                background: 'var(--color-buy)',
                borderRadius: 4,
                opacity: 0.6,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Losers</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-sell)', fontFeatureSettings: '"tnum"' }}>
              {data.avgLoserDuration > 0 ? formatDuration(data.avgLoserDuration) : '—'}
            </span>
          </div>
          <div style={{ height: 8, background: 'var(--color-surface)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                width: `${lossPct}%`,
                height: '100%',
                background: 'var(--color-sell)',
                borderRadius: 4,
                opacity: 0.6,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Combined Export ──────────────────────────────────────────────────────────

export function StatsBreakdowns({
  hourlyData,
  grouped,
  directionStats,
  dayOfWeekData,
  durationData,
}: {
  hourlyData: HourPnl[];
  grouped: GroupedTrade[];
  directionStats: { long: DirectionStats; short: DirectionStats };
  dayOfWeekData: DayOfWeekPnl[];
  durationData: DurationComparison;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const displayHourlyData = useMemo(() => {
    if (!selectedDay) return hourlyData;
    const filtered = grouped.filter(
      (t) => NY_DOW.format(new Date(t.entryTime)) === selectedDay
    );
    return buildHourlyData(filtered);
  }, [selectedDay, grouped, hourlyData]);

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <TimeOfDay data={displayHourlyData} filterDay={selectedDay} />
      <LongVsShort long={directionStats.long} short={directionStats.short} />
      <DayOfWeek data={dayOfWeekData} selectedDay={selectedDay} onDaySelect={setSelectedDay} />
      <DurationBreakdown data={durationData} />
    </div>
  );
}
