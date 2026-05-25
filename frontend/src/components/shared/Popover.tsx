import { useCallback, useEffect } from 'react';
import { RADIUS, Z } from '../../constants/layout';
import { XIcon } from '../icons/XIcon';
import { useDraggable } from '../../hooks/useDraggable';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useStore } from '../../store/useStore';

export interface PopoverProps {
  title: string;
  onClose: () => void;
  onCancel?: () => void;
  width?: number;
  minHeight?: number;
  persistKey?: string;
  /** Content rendered on the left side of the footer (e.g. a Reset button). */
  footerLeft?: React.ReactNode;
  children: React.ReactNode;
}

export function Popover({ title, onClose, onCancel, width = 440, minHeight, persistKey, footerLeft, children }: PopoverProps) {
  const rawSavedPos = useStore((s) => persistKey ? s.popoverPositions[persistKey] : undefined);
  const setPopoverPosition = useStore((s) => s.setPopoverPosition);

  const savedPos = rawSavedPos
    ? {
        x: Math.min(rawSavedPos.x, window.innerWidth - width - 8),
        y: Math.min(Math.max(0, rawSavedPos.y), window.innerHeight - 40),
      }
    : undefined;

  const onDragEnd = useCallback((pos: { x: number; y: number }) => {
    if (persistKey) setPopoverPosition(persistKey, pos);
  }, [persistKey, setPopoverPosition]);

  const { ref, onDragMouseDown, dragStyle, isDragging } = useDraggable<HTMLDivElement>({
    initialPos: savedPos,
    onDragEnd: persistKey ? onDragEnd : undefined,
  });
  useClickOutside(ref, true, onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') (onCancel ?? onClose)(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onClose]);

  return (
    <div
      ref={ref}
      data-ignore-click-outside=""
      className="fixed bg-(--color-surface) border border-(--color-border) rounded-xl shadow-lg"
      style={{ zIndex: Z.DROPDOWN, width, minHeight, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', fontSize: 13, ...dragStyle }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 10px', cursor: isDragging ? 'grabbing' : 'grab' }} onMouseDown={onDragMouseDown}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>{title}</span>
        <button
          onClick={onClose}
          className="focus:outline-none focus:ring-0 hover:bg-(--color-hover-row) hover:text-(--color-text) transition-colors"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: RADIUS.MD,
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--color-text-muted)',
            flexShrink: 0,
          }}
        >
          <XIcon size={10} />
        </button>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />

      {children}

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />

      {/* Footer */}
      <div style={{ padding: '8px 16px', display: 'flex', justifyContent: footerLeft ? 'space-between' : 'flex-end', alignItems: 'center', gap: 6 }}>
        {footerLeft}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onCancel ?? onClose}
            className="text-(--color-text) rounded"
            style={{ fontSize: 13, padding: '5px 16px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', cursor: 'pointer', transition: 'background var(--transition-fast)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-hover-toolbar)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-surface)')}
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="rounded"
            style={{ fontSize: 13, padding: '5px 16px', background: 'var(--color-label-close)', color: 'var(--color-label-text)', border: 'none', cursor: 'pointer', transition: 'background var(--transition-fast)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-label-close-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-label-close)')}
          >
            Ok
          </button>
        </div>
      </div>
    </div>
  );
}
