import { useEffect, useRef } from 'react';
import { Z } from '../../constants/layout';
import { XIcon } from '../icons/XIcon';

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  /** Extra classes on the panel div (bg, border, width, rounding, etc.) */
  className?: string;
  /** Inline style on the panel div */
  style?: React.CSSProperties;
  /** Extra classes on the backdrop div (e.g. animation) */
  backdropClassName?: string;
  /** Inline style on the backdrop div (e.g. backdropFilter) */
  backdropStyle?: React.CSSProperties;
  /**
   * When provided, Modal renders a standard header with this title, a
   * horizontal divider, and a close (X) button.
   * Accepts a ReactNode so callers can include badges or icons alongside the text.
   * Omit to keep the previous behaviour (caller owns all header markup).
   */
  title?: React.ReactNode;
  /**
   * Extra content rendered in the header row, between the title and the X button.
   * Use for action controls that belong in the header (e.g. a unit-mode toggle).
   */
  headerActions?: React.ReactNode;
  /** Override the default header padding/border style. */
  headerStyle?: React.CSSProperties;
}

/**
 * Shared modal shell: backdrop overlay + centered panel + Escape + backdrop click.
 *
 * Two modes:
 *  - Minimal (default): caller provides all content as children.
 *  - With header: pass `title` to get a standard title bar + X button for free.
 */
export function Modal({
  onClose,
  children,
  className = '',
  style,
  backdropClassName = '',
  backdropStyle,
  title,
  headerActions,
  headerStyle,
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={backdropRef}
      className={`fixed inset-0 flex items-center justify-center bg-black/60 ${backdropClassName}`}
      style={{ zIndex: Z.MODAL, ...backdropStyle }}
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className={className} style={style}>
        {title != null && (
          <div
            className="flex items-center gap-2 shrink-0 border-b border-(--color-border)/40"
            style={{ padding: '12px 16px 10px', ...headerStyle }}
          >
            <div className="flex-1 text-sm font-semibold text-(--color-text)">{title}</div>
            {headerActions}
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-md text-(--color-text-muted) hover:text-(--color-text) hover:bg-(--color-hover-row) transition-colors"
              style={{ width: 22, height: 22, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
            >
              <XIcon size={10} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
