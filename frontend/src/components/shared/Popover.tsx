import { RADIUS, SHADOW, Z } from '../../constants/layout';
import { useDraggable } from '../../hooks/useDraggable';
import { useClickOutside } from '../../hooks/useClickOutside';

export interface PopoverProps {
  title: string;
  onClose: () => void;
  onCancel?: () => void;
  width?: number;
  minHeight?: number;
  children: React.ReactNode;
}

export function Popover({ title, onClose, onCancel, width = 440, minHeight, children }: PopoverProps) {
  const { ref, onDragMouseDown, dragStyle } = useDraggable<HTMLDivElement>();
  useClickOutside(ref, true, onClose);

  return (
    <div
      ref={ref}
      className="fixed bg-(--color-surface) border border-(--color-border) rounded-xl shadow-lg"
      style={{ zIndex: Z.DROPDOWN, width, minHeight, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', ...dragStyle }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 10px', cursor: 'grab' }} onMouseDown={onDragMouseDown}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>{title}</span>
        <button
          onClick={onClose}
          className="focus:outline-none focus:ring-0"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: RADIUS.MD,
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--color-text-muted)',
            transition: 'background var(--transition-fast), color var(--transition-fast)',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover-row)'; e.currentTarget.style.color = 'var(--color-text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />

      {children}

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />

      {/* Footer */}
      <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
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
  );
}
