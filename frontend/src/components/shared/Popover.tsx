import { useEffect } from 'react';
import { SHADOW } from '../../constants/layout';

interface PopoverProps {
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
  style?: React.CSSProperties;
  /** Add animate-dropdown-in entrance animation */
  animate?: boolean;
}

/**
 * Shared popover shell: bg, border, shadow, radius + optional Escape handler.
 * Caller is responsible for positioning (fixed/absolute) and click-outside logic.
 */
export function Popover({ children, onClose, className = '', style, animate = false }: PopoverProps) {
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className={`bg-(--color-panel) border border-(--color-border) rounded-lg${animate ? ' animate-dropdown-in' : ''}${className ? ` ${className}` : ''}`}
      style={{ boxShadow: SHADOW.XL, ...style }}
    >
      {children}
    </div>
  );
}