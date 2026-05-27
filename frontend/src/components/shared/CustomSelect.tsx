import { useCallback, useEffect, useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { RADIUS, SHADOW, Z } from '../../constants/layout';
import { ChevronDown } from '../icons/ChevronDown';

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
  renderItemAction?: (option: SelectOption, isActive: boolean) => React.ReactNode | null;
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
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
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

  // Compute fixed position when opening; auto-flip upward when near bottom edge
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const estimatedHeight = Math.min(options.length, 8) * 32 + 8;
    const up = dropUp || (window.innerHeight - rect.bottom < estimatedHeight + 4);
    if (up) {
      setDropPos({ top: rect.top - 4, left: rect.left, width: rect.width, up: true });
    } else {
      setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width, up: false });
    }
  }, [open, dropUp, options.length]);

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
        <ChevronDown size={8} className={`opacity-50 shrink-0 transition-transform${open ? ' rotate-180' : ''}`} />
      </button>
      {open && dropPos && (
        <div
          className="border border-(--color-border) shadow-lg animate-dropdown-in scrollbar-thin"
          style={{
            zIndex: Z.DROPDOWN,
            position: 'fixed',
            top: dropPos.up ? undefined : dropPos.top,
            bottom: dropPos.up ? `calc(100vh - ${dropPos.top}px)` : undefined,
            left: dropPos.left,
            width: Math.max(dropPos.width, dropdownMinWidth ?? 0),
            background: dropdownBg,
            boxShadow: SHADOW.LG,
            borderRadius: RADIUS.XL,
            overflow: 'hidden',
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
            const action = renderItemAction?.(o, active);
            if (!action) {
              return (
                <button
                  key={o.value}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`w-full text-left transition-colors ${active ? '' : 'hover:bg-(--color-hover-row)'}`}
                  style={{ padding: '6px 10px', border: 'none', cursor: 'pointer', fontSize: btnFontSize, ...rowStyle }}
                >
                  {o.label}
                </button>
              );
            }
            return (
              <div
                key={o.value}
                className={`flex items-center transition-colors ${active ? '' : 'hover:bg-(--color-hover-row)'}`}
                style={{ fontSize: btnFontSize, ...rowStyle }}
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
