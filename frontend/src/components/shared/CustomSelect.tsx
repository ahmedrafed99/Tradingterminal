import { useCallback, useEffect, useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';

export interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  /** Dropdown opens upward instead of downward */
  dropUp?: boolean;
  /** CSS variable for the button background (default: --color-input) */
  bg?: string;
  /** Button padding (default: '6px 10px') */
  padding?: string;
  /** Font size in px (default: 12) */
  fontSize?: number;
}

export function CustomSelect({
  value,
  options,
  onChange,
  disabled = false,
  className,
  style,
  title,
  dropUp = false,
  bg = 'var(--color-input)',
  padding: btnPadding = '6px 10px',
  fontSize: btnFontSize = 12,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Compute fixed position when opening
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    if (dropUp) {
      setDropPos({ top: rect.top - 4, left: rect.left, width: rect.width });
    } else {
      setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [open, dropUp]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: 'relative', ...style }} className={className}>
      <button
        ref={btnRef}
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
        disabled={disabled}
        style={{
          width: '100%',
          background: bg,
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: btnPadding,
          fontSize: btnFontSize,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          transition: 'border-color 0.15s',
          opacity: disabled ? 0.5 : 1,
          textAlign: 'left',
        }}
        title={title}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {selected?.label ?? value}
        </span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
          <path d={dropUp && open ? 'M0 5l4-5 4 5z' : 'M0 0l4 5 4-5z'} />
        </svg>
      </button>
      {open && dropPos && (
        <div
          className="border border-(--color-border) rounded-lg shadow-lg z-50 animate-dropdown-in"
          style={{
            position: 'fixed',
            top: dropUp ? undefined : dropPos.top,
            bottom: dropUp ? `calc(100vh - ${dropPos.top}px)` : undefined,
            left: dropPos.left,
            width: dropPos.width,
            background: 'var(--color-panel)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            maxHeight: options.length > 8 ? 200 : undefined,
            overflowY: options.length > 8 ? 'auto' : undefined,
            padding: '2px 0',
          }}
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className="w-full text-left text-xs transition-colors bg-transparent hover:bg-(--color-hover-row)"
                style={{
                  padding: '6px 10px',
                  border: 'none',
                  cursor: 'pointer',
                  color: active ? 'var(--color-warning)' : 'var(--color-text)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
