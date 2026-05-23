import { RADIUS } from '../../constants/layout';
import { ChevronDown } from '../icons/ChevronDown';

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
      className={`flex items-center justify-between gap-2 text-(--color-text) border border-(--color-border) hover:border-(--color-text-dim) transition-[border-color] cursor-pointer focus:outline-none focus:ring-0${className ? ` ${className}` : ''}`}
      style={{
        background: 'var(--color-surface)',
        borderRadius: RADIUS.XL,
        padding: '4px 10px',
        fontSize: 13,
        width,
        minWidth,
      }}
    >
      {children}
      <ChevronDown size={8} className={`opacity-50 shrink-0 transition-transform${open ? ' rotate-180' : ''}`} />
    </button>
  );
}
