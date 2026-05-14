interface MenuItemProps {
  onClick?: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  /** Show right-chevron indicator for submenus */
  hasSubmenu?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * Standard menu row: inset rounded, 8px 12px padding, icon + label layout.
 * Must be placed inside a Popover (or any container with py-1 vertical padding).
 */
export function MenuItem({ onClick, icon, children, disabled, danger, hasSubmenu, onMouseEnter, onMouseLeave }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`flex items-center gap-2.5 text-left font-medium transition-colors cursor-default rounded-md
        ${danger
          ? 'text-(--color-error) hover:bg-red-500/10'
          : 'text-(--color-text-muted) hover:text-(--color-text) hover:bg-(--color-hover-row)'}
        ${disabled ? 'opacity-40 pointer-events-none' : ''}
      `}
      style={{ padding: '8px 12px', width: 'calc(100% - 8px)', margin: '0 4px', display: 'flex', fontSize: 'var(--font-size-overlay)' }}
    >
      {icon && (
        <span className="shrink-0 text-(--color-text-muted)" style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </span>
      )}
      <span className="flex-1">{children}</span>
      {hasSubmenu && (
        <svg className="text-(--color-text-muted) shrink-0 ml-2" width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}