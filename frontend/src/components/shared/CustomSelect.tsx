import { useCallback, useEffect, useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { RADIUS, SHADOW, Z } from '../../constants/layout';

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
  /** CSS variable for the dropdown list background (default: --color-panel) */
  dropdownBg?: string;
  /** Button padding (default: '6px 10px') */
  padding?: string;
  /** Font size in px (default: 12) */
  fontSize?: number;
  /** Force dropdown to at least this width (overrides matching the button width) */
  dropdownMinWidth?: number;
  /** Per-item trailing action (e.g. delete button). Return null to skip. */
  renderItemAction?: (option: SelectOption) => React.ReactNode | null;
  /** Full row override. When non-null, replaces the entire row content (label + action). */
  renderItem?: (option: SelectOption, ctx: { active: boolean; close: () => void }) => React.ReactNode | null;
  /** Element rendered below the option list, separated by a divider. */
  footer?: React.ReactNode;
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
  dropdownBg = 'var(--color-surface)',
  padding: btnPadding = '6px 10px',
  fontSize: btnFontSize = 12,
  dropdownMinWidth,
  renderItemAction,
  renderItem,
  footer,
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
          borderRadius: RADIUS.XL,
          padding: btnPadding,
          fontSize: btnFontSize,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          transition: 'border-color var(--transition-fast)',
          opacity: disabled ? 0.5 : 1,
          textAlign: 'left',
        }}
        title={title}
        onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
        onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.borderColor = 'var(--color-border)'; }}
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
          className="border border-(--color-border) rounded-lg shadow-lg animate-dropdown-in"
          style={{
            zIndex: Z.DROPDOWN,
            position: 'fixed',
            top: dropUp ? undefined : dropPos.top,
            bottom: dropUp ? `calc(100vh - ${dropPos.top}px)` : undefined,
            left: dropPos.left,
            width: Math.max(dropPos.width, dropdownMinWidth ?? 0),
            background: dropdownBg,
            boxShadow: SHADOW.LG,
            maxHeight: options.length > 8 ? 200 : undefined,
            overflowY: options.length > 8 ? 'auto' : undefined,
            padding: '2px 0',
          }}
        >
          {options.map((o) => {
            const active = o.value === value;
            const override = renderItem?.(o, { active, close });
            const rowStyle: React.CSSProperties = {
              background: active ? 'var(--color-text)' : 'transparent',
              color: active ? dropdownBg : 'var(--color-text)',
              fontWeight: active ? 600 : 400,
            };
            if (override != null) {
              return (
                <div key={o.value} style={rowStyle}>{override}</div>
              );
            }
            const action = renderItemAction?.(o);
            if (!action) {
              return (
                <button
                  key={o.value}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`w-full text-left text-xs transition-colors ${active ? '' : 'hover:bg-(--color-hover-row)'}`}
                  style={{ padding: '6px 10px', border: 'none', cursor: 'pointer', ...rowStyle }}
                >
                  {o.label}
                </button>
              );
            }
            return (
              <div
                key={o.value}
                className={`flex items-center text-xs transition-colors ${active ? '' : 'hover:bg-(--color-hover-row)'}`}
                style={rowStyle}
              >
                <button
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  style={{ flex: 1, textAlign: 'left', padding: '6px 10px', border: 'none', cursor: 'pointer', background: 'transparent', color: 'inherit', fontWeight: 'inherit' }}
                >
                  {o.label}
                </button>
                {action}
              </div>
            );
          })}
          {footer && (
            <>
              <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />
              {footer}
            </>
          )}
        </div>
      )}
    </div>
  );
}
