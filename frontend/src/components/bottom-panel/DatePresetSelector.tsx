import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { DATE_PRESET_LABELS, type DatePreset } from '../../utils/cmeSession';
import { useClickOutside } from '../../hooks/useClickOutside';

const PRESETS: DatePreset[] = ['today', 'week', 'month'];

interface DatePresetSelectorProps {
  counts?: Partial<Record<DatePreset, number>>;
}

export function DatePresetSelector({ counts }: DatePresetSelectorProps) {
  const preset = useStore((s) => s.tradesDatePreset);
  const setPreset = useStore((s) => s.setTradesDatePreset);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeDropdown = useCallback(() => {
    setVisible(false);
    setTimeout(() => setOpen(false), 150);
  }, []);
  useClickOutside(ref, open, closeDropdown);

  // Animate in after mount
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setVisible(true));
    }
  }, [open]);

  const handleSelect = (p: DatePreset) => {
    setPreset(p);
    setVisible(false);
    setTimeout(() => setOpen(false), 150);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          if (open) { closeDropdown(); } else { setOpen(true); }
        }}
        className="flex items-center gap-1.5 text-xs text-(--color-text-muted) hover:text-(--color-text) transition-colors cursor-pointer select-none"
        style={{ padding: '4px 8px' }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 6.5h12" />
          <path d="M5.5 1.5v3M10.5 1.5v3" />
        </svg>
        {DATE_PRESET_LABELS[preset]}
        {counts?.[preset] != null && (
          <span style={{ color: 'var(--color-text-dim)' }}>({counts[preset]})</span>
        )}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ opacity: 0.6 }}>
          <path d="M1.5 3L4 5.5L6.5 3" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 border border-(--color-border) rounded-lg shadow-lg z-50 overflow-hidden"
          style={{
            background: 'var(--color-bg)',
            minWidth: 140,
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(-4px)',
            transition: 'opacity 0.15s ease, transform 0.15s ease',
          }}
        >
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => handleSelect(p)}
              className={`flex w-full items-center text-xs cursor-pointer ${
                p === preset ? 'text-(--color-warning)' : 'text-(--color-text) hover:bg-(--color-hover-row)'
              }`}
              style={{
                padding: '6px 12px',
                gap: 10,
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              <span>{DATE_PRESET_LABELS[p]}</span>
              {counts?.[p] != null && (
                <span
                  className="ml-auto"
                  style={{
                    fontSize: 12,
                    color: p === preset ? 'rgba(240, 168, 48, 0.6)' : 'var(--color-text-dim)',
                    transition: 'color 0.15s',
                  }}
                >
                  ({counts[p]})
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
