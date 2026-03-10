import { useEffect, useRef } from 'react';

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
}

/**
 * Shared modal shell: backdrop overlay + centered panel + Escape + backdrop click.
 * Caller provides panel styling via className/style and all content as children.
 */
export function Modal({ onClose, children, className = '', style, backdropClassName = '', backdropStyle }: ModalProps) {
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
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 ${backdropClassName}`}
      style={backdropStyle}
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className={className} style={style}>
        {children}
      </div>
    </div>
  );
}
