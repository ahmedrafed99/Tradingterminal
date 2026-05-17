import { useState, useEffect } from 'react';
import { FONT_SIZE, RADIUS, SHADOW, Z } from '../../constants/layout';

const DAYS   = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getDaysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate(); }
function getFirstDayOfWeek(year: number, month: number) { return (new Date(year, month - 1, 1).getDay() + 6) % 7; }
function parseDate(str: string) {
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d || isNaN(y) || isNaN(m) || isNaN(d)) return null;
  return { year: y, month: m, day: d };
}
function pad(n: number) { return String(n).padStart(2, '0'); }
function toDateStr(year: number, month: number, day: number) { return `${year}-${pad(month)}-${pad(day)}`; }
function cmp(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

function utcToday() {
  const n = new Date();
  return { year: n.getUTCFullYear(), month: n.getUTCMonth() + 1, day: n.getUTCDate() };
}

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const ChevronLeft = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CalendarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
    <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M5 2v2M11 2v2M2 7h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
const ClockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M7 4v3.5l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface SingleProps {
  mode: 'single';
  title: string;
  date: string;
  time?: string;
  confirmLabel?: string;
  /** Pass a timezone-aware "today" for correct day highlighting (defaults to UTC today) */
  today?: { year: number; month: number; day: number };
  onDateChange: (date: string) => void;
  onTimeChange?: (time: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

interface RangeProps {
  mode: 'range';
  title: string;
  from: string;
  to: string;
  minDate?: string;
  maxDate?: string;
  onChange: (from: string, to: string) => void;
  onClose: () => void;
}

type Props = SingleProps | RangeProps;

export function DatePickerModal(props: Props) {
  const { mode, title, onClose } = props;

  const initDate = parseDate(mode === 'single' ? props.date : props.from);
  const [calYear,  setCalYear ] = useState(initDate?.year  ?? utcToday().year);
  const [calMonth, setCalMonth] = useState(initDate?.month ?? utcToday().month);

  // range-only state
  const [selecting, setSelecting] = useState<'from' | 'to'>('from');

  // Sync calendar when the anchor date changes
  const anchorDate = mode === 'single' ? props.date : props.from;
  useEffect(() => {
    const d = parseDate(anchorDate);
    if (d) { setCalYear(d.year); setCalMonth(d.month); }
  }, [anchorDate]);

  function prevMonth() {
    if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1); }
    else setCalMonth(m => m + 1);
  }

  function handleDayClick(year: number, month: number, day: number) {
    const d = toDateStr(year, month, day);
    if (mode === 'single') {
      props.onDateChange(d);
    } else {
      if (selecting === 'from') {
        const newTo = cmp(d, props.to) > 0 ? d : props.to;
        props.onChange(d, newTo);
        setSelecting('to');
      } else {
        const newFrom = cmp(d, props.from) < 0 ? d : props.from;
        props.onChange(newFrom, d);
        setSelecting('from');
      }
    }
  }

  const firstDow    = getFirstDayOfWeek(calYear, calMonth);
  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayDate  = mode === 'single' ? (props.today ?? utcToday()) : utcToday();
  const selectedSingle = mode === 'single' ? parseDate(props.date) : null;

  const navTopPad = mode === 'single' ? '14px' : '0';

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
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>{title}</span>
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
            <XIcon />
          </button>
        </div>

        {/* Tab bar — single mode only (structural, reserved for future tabs) */}
        {mode === 'single' && (
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
        )}

        {/* Inputs */}
        {mode === 'single' ? (
          <div style={{ padding: '14px 20px 0', display: 'flex', gap: 8 }}>
            <div
              className="flex-1 flex items-center gap-2 bg-(--color-input) border border-(--color-border) focus-within:border-(--color-text-dim) transition-colors"
              style={{ padding: '8px 12px', borderRadius: RADIUS.XL }}
            >
              <input
                type="text"
                value={props.date}
                onChange={(e) => props.onDateChange(e.target.value)}
                style={{ flex: 1, fontSize: FONT_SIZE.OVERLAY, color: 'var(--color-text)', background: 'transparent', border: 'none', outline: 'none' }}
                placeholder="YYYY-MM-DD"
              />
              <CalendarIcon />
            </div>
            {props.time !== undefined && props.onTimeChange && (
              <div
                className="flex items-center gap-2 bg-(--color-input) border border-(--color-border) focus-within:border-(--color-text-dim) transition-colors"
                style={{ padding: '8px 12px', borderRadius: RADIUS.XL, width: 94 }}
              >
                <input
                  type="text"
                  value={props.time}
                  onChange={(e) => props.onTimeChange!(e.target.value)}
                  style={{ width: '100%', fontSize: FONT_SIZE.OVERLAY, color: 'var(--color-text)', background: 'transparent', border: 'none', outline: 'none' }}
                  placeholder="HH:MM"
                />
                <ClockIcon />
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, padding: '0 20px 12px' }}>
            {(['from', 'to'] as const).map((side) => (
              <button
                key={side}
                onClick={() => setSelecting(side)}
                style={{
                  flex: 1, padding: '7px 12px', borderRadius: RADIUS.XL,
                  border: `1.5px solid ${selecting === side ? 'var(--color-text-dim)' : 'var(--color-border)'}`,
                  background: 'var(--color-input)', color: 'var(--color-text)',
                  fontSize: FONT_SIZE.OVERLAY, cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ color: 'var(--color-text-muted)', marginRight: 6 }}>{side === 'from' ? 'From' : 'To'}</span>
                {side === 'from' ? props.from : props.to}
              </button>
            ))}
          </div>
        )}

        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${navTopPad} 20px 8px` }}>
          <button
            onClick={prevMonth}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', borderRadius: RADIUS.MD, transition: 'color var(--transition-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <ChevronLeft />
          </button>
          <span style={{ fontSize: FONT_SIZE.OVERLAY, fontWeight: 500, color: 'var(--color-text)' }}>{MONTHS[calMonth - 1]} {calYear}</span>
          <button
            onClick={nextMonth}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', borderRadius: RADIUS.MD, transition: 'color var(--transition-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <ChevronRight />
          </button>
        </div>

        {/* Calendar grid */}
        <div style={{ padding: '0 20px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: FONT_SIZE.OVERLAY, fontWeight: 500, color: 'var(--color-text-muted)', padding: '4px 0' }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((day, i) => {
              if (day === null) return <div key={i} />;
              const d    = toDateStr(calYear, calMonth, day);
              const isWeekend = (i % 7) >= 5;

              if (mode === 'single') {
                const isSelected = selectedSingle?.year === calYear && selectedSingle?.month === calMonth && selectedSingle?.day === day;
                const isToday    = todayDate.year === calYear && todayDate.month === calMonth && todayDate.day === day;
                return (
                  <button
                    key={i}
                    onClick={() => handleDayClick(calYear, calMonth, day)}
                    style={{
                      fontSize: FONT_SIZE.OVERLAY, textAlign: 'center', padding: '6px 0',
                      borderRadius: RADIUS.MD,
                      border: isSelected ? '1px solid rgba(255,255,255,0.55)' : '1px solid transparent',
                      background: 'transparent', cursor: 'pointer',
                      color: isToday && !isSelected ? 'var(--color-accent)' : isWeekend ? 'var(--color-text-muted)' : 'var(--color-text)',
                      fontWeight: isToday ? 600 : 400,
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover-row)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {day}
                  </button>
                );
              } else {
                const isFrom = d === props.from;
                const isTo   = d === props.to;
                const isDisabled = (props.minDate != null && cmp(d, props.minDate) < 0) ||
                                   (props.maxDate != null && cmp(d, props.maxDate) > 0);
                const isEdge = (isFrom || isTo) && !isDisabled;
                return (
                  <button
                    key={i}
                    onClick={() => { if (!isDisabled) handleDayClick(calYear, calMonth, day); }}
                    onMouseEnter={(e) => { if (!isDisabled) e.currentTarget.style.background = 'var(--color-hover-row)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    disabled={isDisabled}
                    style={{
                      fontSize: FONT_SIZE.OVERLAY, textAlign: 'center', padding: '6px 0',
                      borderRadius: RADIUS.MD,
                      border: isEdge ? '1px solid rgba(255,255,255,0.55)' : '1px solid transparent',
                      background: 'transparent',
                      cursor: isDisabled ? 'default' : 'pointer',
                      color: isDisabled
                        ? 'var(--color-text-muted)'
                        : isWeekend
                          ? 'var(--color-text-muted)'
                          : 'var(--color-text)',
                      opacity: isDisabled ? 0.35 : 1,
                      fontWeight: isEdge ? 600 : 400,
                      transition: 'background var(--transition-fast)',
                    }}
                  >
                    {day}
                  </button>
                );
              }
            })}
          </div>
        </div>

        {/* Footer */}
        {mode === 'single' ? (
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
              onClick={props.onConfirm}
              style={{
                fontSize: FONT_SIZE.OVERLAY, fontWeight: 500, padding: '7px 16px', borderRadius: RADIUS.XL,
                border: 'none', background: 'var(--color-text)',
                color: 'var(--color-bg)', cursor: 'pointer',
                transition: 'opacity var(--transition-fast)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              {props.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--color-border)', padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: FONT_SIZE.OVERLAY, color: 'var(--color-text-muted)' }}>
              {selecting === 'from' ? 'Click to set start date' : 'Click to set end date'}
            </span>
            <button
              onClick={onClose}
              style={{
                fontSize: FONT_SIZE.OVERLAY, fontWeight: 500, padding: '7px 16px', borderRadius: RADIUS.XL,
                border: 'none', background: 'var(--color-text)',
                color: 'var(--color-bg)', cursor: 'pointer',
                transition: 'opacity var(--transition-fast)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
