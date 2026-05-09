import { useState, useEffect } from 'react';
import { FONT_SIZE, RADIUS, SHADOW, Z } from '../../constants/layout';

const NY_TZ = 'America/New_York';

function nyNow() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return { year: parseInt(parts.year), month: parseInt(parts.month), day: parseInt(parts.day) };
}

function nyLocalToUtcSeconds(dateStr: string, timeStr: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, m);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(asUtc)).map(p => [p.type, p.value]));
  const nyUtc = Date.UTC(parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day), parseInt(parts.hour) % 24, parseInt(parts.minute));
  return Math.floor((asUtc + (asUtc - nyUtc)) / 1000);
}

function getDaysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate(); }
function getFirstDayOfWeek(year: number, month: number) { return (new Date(year, month - 1, 1).getDay() + 6) % 7; }
function parseDate(str: string) {
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d || isNaN(y) || isNaN(m) || isNaN(d)) return null;
  return { year: y, month: m, day: d };
}
function pad(n: number) { return String(n).padStart(2, '0'); }

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

interface Props {
  onClose: () => void;
  onGoTo: (utcSeconds: number) => void;
}

export function GoToModal({ onClose, onGoTo }: Props) {
  const today = nyNow();
  const [dateStr, setDateStr] = useState(`${today.year}-${pad(today.month)}-${pad(today.day)}`);
  const [timeStr, setTimeStr] = useState('09:30');
  const [calYear, setCalYear] = useState(today.year);
  const [calMonth, setCalMonth] = useState(today.month);

  useEffect(() => {
    const d = parseDate(dateStr);
    if (d) { setCalYear(d.year); setCalMonth(d.month); }
  }, [dateStr]);

  function selectDay(year: number, month: number, day: number) {
    setDateStr(`${year}-${pad(month)}-${pad(day)}`);
  }
  function prevMonth() {
    if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1); }
    else setCalMonth(m => m + 1);
  }
  function handleGoTo() {
    onGoTo(nyLocalToUtcSeconds(dateStr, timeStr));
    onClose();
  }

  const firstDow = getFirstDayOfWeek(calYear, calMonth);
  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const cells: (number | null)[] = [...Array<null>(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const selected = parseDate(dateStr);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: Z.MODAL, background: 'rgba(0,0,0,0.6)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-(--color-surface) border border-(--color-border) rounded-xl"
        style={{ width: 380, boxShadow: SHADOW.XL }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 14px', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>Go to</span>
          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: RADIUS.MD,
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--color-text-muted)',
              transition: 'background var(--transition-fast), color var(--transition-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover-row)'; e.currentTarget.style.color = 'var(--color-text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ padding: '0 20px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <span style={{
              fontSize: FONT_SIZE.OVERLAY, fontWeight: 500, color: 'var(--color-text)',
              paddingBottom: 10, paddingTop: 4,
              borderBottom: '2px solid var(--color-accent)',
              cursor: 'default',
            }}>
              Date
            </span>
          </div>
        </div>

        {/* Inputs */}
        <div style={{ padding: '14px 20px 0', display: 'flex', gap: 8 }}>
          <div
            className="flex-1 flex items-center gap-2 bg-(--color-input) border border-(--color-border) focus-within:border-(--color-text-dim) transition-colors"
            style={{ padding: '8px 12px', borderRadius: RADIUS.XL }}
          >
            <input
              type="text"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              style={{ flex: 1, fontSize: FONT_SIZE.OVERLAY, color: 'var(--color-text)', background: 'transparent', border: 'none', outline: 'none' }}
              placeholder="YYYY-MM-DD"
            />
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
              <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M5 2v2M11 2v2M2 7h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
          <div
            className="flex items-center gap-2 bg-(--color-input) border border-(--color-border) focus-within:border-(--color-text-dim) transition-colors"
            style={{ padding: '8px 12px', borderRadius: RADIUS.XL, width: 94 }}
          >
            <input
              type="text"
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              style={{ width: '100%', fontSize: FONT_SIZE.OVERLAY, color: 'var(--color-text)', background: 'transparent', border: 'none', outline: 'none' }}
              placeholder="HH:MM"
            />
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 4v3.5l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 8px' }}>
          <button
            onClick={prevMonth}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', borderRadius: RADIUS.MD, transition: 'color var(--transition-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span style={{ fontSize: FONT_SIZE.OVERLAY, fontWeight: 500, color: 'var(--color-text)' }}>{MONTHS[calMonth - 1]} {calYear}</span>
          <button
            onClick={nextMonth}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', borderRadius: RADIUS.MD, transition: 'color var(--transition-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Calendar grid */}
        <div style={{ padding: '0 20px 16px' }}>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: FONT_SIZE.OVERLAY, fontWeight: 500, color: 'var(--color-text-muted)', padding: '4px 0' }}>{d}</div>
            ))}
          </div>
          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((day, i) => {
              if (day === null) return <div key={i} />;
              const isSelected = selected?.year === calYear && selected?.month === calMonth && selected?.day === day;
              const isToday = today.year === calYear && today.month === calMonth && today.day === day;
              const isWeekend = (i % 7) >= 5;
              return (
                <button
                  key={i}
                  onClick={() => selectDay(calYear, calMonth, day)}
                  style={{
                    fontSize: FONT_SIZE.OVERLAY,
                    textAlign: 'center',
                    padding: '6px 0',
                    borderRadius: RADIUS.MD,
                    border: isSelected ? '1px solid rgba(255,255,255,0.55)' : '1px solid transparent',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: isToday && !isSelected
                      ? 'var(--color-accent)'
                      : isWeekend
                        ? 'var(--color-text-muted)'
                        : 'var(--color-text)',
                    fontWeight: isToday ? 600 : 400,
                    transition: 'background var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover-row)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px' }}>
          <button
            onClick={onClose}
            style={{
              fontSize: FONT_SIZE.OVERLAY, fontWeight: 500, padding: '7px 16px', borderRadius: RADIUS.XL,
              border: '1px solid var(--color-border)', background: 'transparent',
              color: 'var(--color-text)', cursor: 'pointer',
              transition: 'background var(--transition-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover-row)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            Cancel
          </button>
          <button
            onClick={handleGoTo}
            style={{
              fontSize: FONT_SIZE.OVERLAY, fontWeight: 500, padding: '7px 16px', borderRadius: RADIUS.XL,
              border: 'none', background: 'var(--color-text)',
              color: 'var(--color-bg)', cursor: 'pointer',
              transition: 'opacity var(--transition-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            Go to
          </button>
        </div>
      </div>
    </div>
  );
}
