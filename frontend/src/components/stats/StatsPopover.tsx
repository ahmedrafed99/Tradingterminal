import { useEffect, useMemo, useRef, useState } from 'react';
import { Z } from '../../constants/layout';
import { useStore } from '../../store/useStore';
import { DatePresetSelector } from '../bottom-panel/DatePresetSelector';
import { StatsKpiCards } from './StatsKpiCards';
import { StatsPnlChart } from './StatsPnlChart';
import { StatsCalendarGrid } from './StatsCalendarGrid';
import { StatsBreakdowns } from './StatsBreakdowns';
import { StatsDayDetail } from './StatsDayDetail';
import { AnimateIn } from './AnimateIn';
import {
  groupTrades,
  computeStats,
  buildCalendarData,
  buildHourlyData,
  buildDirectionStats,
  buildDayOfWeekData,
  buildDurationComparison,
} from '../../utils/tradeStats';
import type { GroupedTrade } from '../../utils/tradeStats';
import type { DatePreset } from '../../utils/cmeSession';
import { getDateRange } from '../../utils/cmeSession';
import { tradeService } from '../../services/tradeService';

export function StatsPopover({ onClose }: { onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  const connected = useStore((s) => s.connected);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const displayTrades = useStore((s) => s.displayTrades);
  const setDisplayTrades = useStore((s) => s.setDisplayTrades);
  const tradesDatePreset = useStore((s) => s.tradesDatePreset);

  const ALL_PRESETS: DatePreset[] = ['today', 'week', 'month'];
  const [presetCounts, setPresetCounts] = useState<Partial<Record<DatePreset, number>>>({});

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Ensure trades are fetched
  useEffect(() => {
    if (!connected || activeAccountId == null) return;
    if (displayTrades.length > 0) return;

    const { startTimestamp, endTimestamp } = getDateRange(tradesDatePreset);
    tradeService
      .searchTrades(activeAccountId, startTimestamp, endTimestamp)
      .then((trades) => setDisplayTrades(trades))
      .catch(() => {});
  }, [connected, activeAccountId, tradesDatePreset]);

  // Preset counts
  useEffect(() => {
    if (!connected || activeAccountId == null) return;
    let cancelled = false;

    Promise.all(
      ALL_PRESETS.map(async (p) => {
        const { startTimestamp, endTimestamp } = getDateRange(p);
        const trades = await tradeService.searchTrades(activeAccountId, startTimestamp, endTimestamp);
        const count = trades.filter((t) => t.profitAndLoss != null && !t.voided).length;
        return [p, count] as const;
      }),
    ).then((results) => {
      if (!cancelled) setPresetCounts(Object.fromEntries(results));
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [connected, activeAccountId, displayTrades]);

  // Stats computation
  const grouped = useMemo(() => groupTrades(displayTrades), [displayTrades]);
  const stats = useMemo(() => computeStats(grouped), [grouped]);
  const calendarData = useMemo(() => buildCalendarData(grouped), [grouped]);
  const hourlyData = useMemo(() => buildHourlyData(grouped), [grouped]);
  const directionStats = useMemo(() => buildDirectionStats(grouped), [grouped]);
  const dayOfWeekData = useMemo(() => buildDayOfWeekData(calendarData), [calendarData]);
  const durationData = useMemo(() => buildDurationComparison(grouped), [grouped]);

  // Day drill-down
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const dayTrades = useMemo(() => {
    if (!selectedDay) return [];
    return grouped.filter((t) => {
      const d = new Date(t.exitTime);
      const ny = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      return ny === selectedDay;
    });
  }, [grouped, selectedDay]);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 200);
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0"
      style={{
        zIndex: Z.DROPDOWN,
        background: visible ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0)',
        transition: 'background 0.25s ease',
      }}
      onClick={(e) => {
        if (e.target === backdropRef.current) handleClose();
      }}
    >
      <div
        className="absolute left-0 right-0 bottom-0 overflow-y-auto"
        style={{
          top: visible ? '4%' : '100%',
          opacity: visible ? 1 : 0,
          background: '#0a0a0f',
          borderTop: '1px solid var(--color-border)',
          borderRadius: '14px 14px 0 0',
          transition: 'top 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease',
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 flex items-center justify-between"
          style={{
            padding: '16px 28px 14px',
            background: '#0a0a0f',
            borderBottom: '1px solid var(--color-border)',
            zIndex: 1,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-bright)' }}>
            Stats Dashboard
          </div>
          <div className="flex items-center" style={{ gap: 14 }}>
            <DatePresetSelector counts={presetCounts} />
            <button
              onClick={handleClose}
              className="transition-colors cursor-pointer"
              style={{
                color: 'var(--color-text-dim)',
                fontSize: 18,
                lineHeight: 1,
                padding: '2px 6px',
                borderRadius: 4,
                border: 'none',
                background: 'transparent',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-bright)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-dim)')}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '24px 28px 48px', maxWidth: 1200, margin: '0 auto' }}>
          {stats.totalTrades === 0 ? (
            <div
              className="flex items-center justify-center"
              style={{ padding: '80px 0', fontSize: 13, color: 'var(--color-text-dim)' }}
            >
              No trades for this period
            </div>
          ) : selectedDay ? (
            <StatsDayDetail
              date={selectedDay}
              trades={dayTrades}
              onBack={() => setSelectedDay(null)}
            />
          ) : (
            <div className="flex flex-col" style={{ gap: 16 }}>
              <AnimateIn>
                <StatsKpiCards stats={stats} />
              </AnimateIn>
              <AnimateIn>
                <StatsPnlChart stats={stats} dailyData={calendarData} />
              </AnimateIn>
              <AnimateIn>
                <StatsCalendarGrid dailyData={calendarData} onDayClick={setSelectedDay} />
              </AnimateIn>
              <AnimateIn>
                <StatsBreakdowns
                  hourlyData={hourlyData}
                  directionStats={directionStats}
                  dayOfWeekData={dayOfWeekData}
                  durationData={durationData}
                />
              </AnimateIn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
