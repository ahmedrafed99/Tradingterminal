import type { DayPnl } from '../../utils/tradeStats';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function cellBg(net: number, maxAbs: number): string {
  if (net === 0 || maxAbs === 0) return 'transparent';
  const intensity = Math.min(Math.abs(net) / maxAbs, 1) * 0.40 + 0.08;
  return net > 0
    ? `rgba(38, 166, 154, ${intensity})`
    : `rgba(239, 83, 80, ${intensity})`;
}

function pnlColor(v: number): string {
  if (v > 0) return 'var(--color-buy)';
  if (v < 0) return 'var(--color-sell)';
  return 'var(--color-text-dim)';
}

export function StatsCalendarGrid({ dailyData, onDayClick }: { dailyData: DayPnl[]; onDayClick?: (date: string) => void }) {
  if (dailyData.length === 0) {
    return (
      <div
        style={{
          background: '#0d1117',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: '24px 28px',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 14, letterSpacing: '0.02em' }}>
          Daily P&L Calendar
        </div>
        <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--color-text-dim)' }}>
          No trading days in this period
        </div>
      </div>
    );
  }

  const byWeekDay = new Map<string, Map<number, DayPnl>>();
  const maxAbs = Math.max(...dailyData.map((d) => Math.abs(d.net)), 1);

  for (const d of dailyData) {
    const dt = new Date(d.date + 'T12:00:00');
    const day = dt.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(dt);
    monday.setDate(monday.getDate() + mondayOffset);
    const weekKey = monday.toISOString().slice(0, 10);

    if (!byWeekDay.has(weekKey)) byWeekDay.set(weekKey, new Map());
    byWeekDay.get(weekKey)!.set(d.dayOfWeek, d);
  }

  const weeks = [...byWeekDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const gridCols = `80px repeat(5, 1fr) 100px`;

  return (
    <div
      style={{
        background: '#0d1117',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: '24px 28px',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 14, letterSpacing: '0.02em' }}>
        Daily P&L Calendar
      </div>

      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
        {/* Header */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: gridCols,
            borderBottom: '1px solid var(--color-border)',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Week
          </div>
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="text-center"
              style={{ padding: '12px 0', fontSize: 13, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', borderLeft: '1px solid var(--color-border)' }}
            >
              {d}
            </div>
          ))}
          <div
            className="text-center"
            style={{ padding: '12px 0', fontSize: 13, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', borderLeft: '1px solid var(--color-border)' }}
          >
            Total
          </div>
        </div>

        {/* Rows */}
        {weeks.map(([weekKey, days], idx) => {
          const weekTotal = [...days.values()].reduce((s, d) => s + d.net, 0);
          const weekLabel = weekKey.slice(5);
          const isLast = idx === weeks.length - 1;

          return (
            <div
              key={weekKey}
              className="grid"
              style={{
                gridTemplateColumns: gridCols,
                borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
              }}
            >
              <div
                className="flex items-center"
                style={{ padding: '0 14px', fontSize: 13, color: 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}
              >
                {weekLabel}
              </div>

              {[1, 2, 3, 4, 5].map((dow) => {
                const d = days.get(dow);
                return (
                  <div
                    key={dow}
                    className="text-center transition-colors"
                    title={d ? `${d.date} · ${d.tradeCount} ${d.tradeCount === 1 ? 'trade' : 'trades'} · Net: ${d.net > 0 ? '+' : ''}$${Math.abs(d.net).toFixed(2)}` : undefined}
                    onClick={d && onDayClick ? () => onDayClick(d.date) : undefined}
                    style={{
                      padding: '22px 10px',
                      background: d ? cellBg(d.net, maxAbs) : 'transparent',
                      borderLeft: '1px solid var(--color-border)',
                      cursor: d && onDayClick ? 'pointer' : undefined,
                    }}
                  >
                    {d ? (
                      <>
                        <div
                          className="font-semibold"
                          style={{ fontSize: 20, color: pnlColor(d.net), fontFeatureSettings: '"tnum"', lineHeight: 1.2 }}
                        >
                          {d.net > 0 ? '+' : ''}{d.net.toFixed(0)}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                          {d.tradeCount} {d.tradeCount === 1 ? 'trade' : 'trades'}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: 'var(--color-text-dim)' }}>—</div>
                    )}
                  </div>
                );
              })}

              <div
                className="flex flex-col items-center justify-center"
                style={{
                  padding: '22px 10px',
                  borderLeft: '1px solid var(--color-border)',
                }}
              >
                <div
                  className="font-semibold"
                  style={{ fontSize: 20, color: pnlColor(weekTotal), fontFeatureSettings: '"tnum"' }}
                >
                  {weekTotal > 0 ? '+' : ''}{weekTotal.toFixed(0)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
