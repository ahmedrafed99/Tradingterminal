import { RADIUS } from '../../constants/layout';

interface DropdownButtonProps {
  open: boolean;
  onClick: () => void;
  children: React.ReactNode;
  width?: number;
  minWidth?: number;
  title?: string;
  className?: string;
}

export function DropdownButton({ open, onClick, children, width, minWidth, title, className }: DropdownButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`focus:outline-none focus:ring-0${className ? ` ${className}` : ''}`}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        background: 'var(--color-surface)', color: 'var(--color-text)',
        border: '1px solid var(--color-border)', borderRadius: RADIUS.XL,
        padding: '4px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        transition: 'border-color var(--transition-fast)',
        width, minWidth,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
    >
      {children}
      <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}>
        <path d="M0 0l4 5 4-5z" />
      </svg>
    </button>
  );
}
