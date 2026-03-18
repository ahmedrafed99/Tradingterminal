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
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: 'relative', ...style }} className={className}>
      <button
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
        disabled={disabled}
        style={{
          width: '100%',
          background: 'var(--color-input)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          padding: '6px 10px',
          fontSize: 12,
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
      {open && (
        <div
          className="border border-(--color-border) rounded-lg shadow-lg z-50 animate-dropdown-in"
          style={{
            position: 'absolute',
            [dropUp ? 'bottom' : 'top']: '100%',
            left: 0,
            right: 0,
            [dropUp ? 'marginBottom' : 'marginTop']: 4,
            background: 'var(--color-panel)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            maxHeight: 200,
            overflowY: 'auto',
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
