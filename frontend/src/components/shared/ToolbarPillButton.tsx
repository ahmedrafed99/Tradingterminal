import { forwardRef } from 'react';

interface ToolbarPillButtonProps {
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export const ToolbarPillButton = forwardRef<HTMLButtonElement, ToolbarPillButtonProps>(
  function ToolbarPillButton({ onClick, title, children, className }, ref) {
    return (
      <button
        ref={ref}
        onClick={onClick}
        title={title}
        className={`flex items-center gap-1.5 text-xs hover:bg-(--color-border) transition-colors rounded-md ${className ?? ''}`}
        style={{ padding: '5px 10px', background: 'var(--color-input)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
      >
        {children}
      </button>
    );
  }
);
