import { useCallback, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { DATE_PRESET_LABELS, type DatePreset } from '../../utils/cmeSession';
import { useClickOutside } from '../../hooks/useClickOutside';

const PRESETS: DatePreset[] = ['today', 'week', 'month'];

export function DatePresetSelector() {
  const preset = useStore((s) => s.tradesDatePreset);
  const setPreset = useStore((s) => s.setTradesDatePreset);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeDropdown = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, closeDropdown);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-[#787b86] hover:text-[#d1d4dc] transition-colors cursor-pointer select-none"
        style={{ padding: '4px 8px' }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 6.5h12" />
          <path d="M5.5 1.5v3M10.5 1.5v3" />
        </svg>
        {DATE_PRESET_LABELS[preset]}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ opacity: 0.6 }}>
          <path d="M1.5 3L4 5.5L6.5 3" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 border border-[#2a2e39] rounded-lg shadow-lg z-50"
          style={{ background: '#000', minWidth: 120 }}
        >
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => { setPreset(p); setOpen(false); }}
              className={`block w-full text-left text-xs hover:bg-[#2a2e39] transition-colors cursor-pointer ${
                p === preset ? 'text-[#f0a830]' : 'text-[#d1d4dc]'
              }`}
              style={{ padding: '6px 12px' }}
            >
              {DATE_PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
