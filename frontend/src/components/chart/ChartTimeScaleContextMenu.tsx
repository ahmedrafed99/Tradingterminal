import { useRef, useEffect } from 'react';
import { FONT_FAMILY, FONT_SIZE, RADIUS, SHADOW, Z } from '../../constants/layout';

interface Props {
  x: number;
  y: number; // top of the time scale row (viewport-relative)
  onGoTo: () => void;
  onClose: () => void;
}

export function ChartTimeScaleContextMenu({ x, y, onGoTo, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Menu always anchors its bottom to the top of the time scale row.
  // Clamp X so it stays in viewport.
  const menuWidth = 168;
  const left = Math.min(x, window.innerWidth - menuWidth - 4);
  const bottom = window.innerHeight - y;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        bottom,
        zIndex: Z.DROPDOWN + 10,
        minWidth: menuWidth,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: RADIUS.LG,
        padding: '4px 0',
        boxShadow: SHADOW.MD,
      }}
    >
      <button
        onClick={() => { onGoTo(); onClose(); }}
        className="hover:bg-(--color-border) transition-colors cursor-pointer"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '6px 12px',
          border: 'none',
          color: 'var(--color-text)',
          fontSize: FONT_SIZE.OVERLAY,
          fontFamily: FONT_FAMILY,
          textAlign: 'left',
          whiteSpace: 'nowrap',
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" style={{ flexShrink: 0 }}>
          <path fill="currentColor" fillRule="evenodd" d="M11 4h-1v2H7.5A2.5 2.5 0 0 0 5 8.5V13h1v-2h16v8.5c0 .83-.67 1.5-1.5 1.5H14v1h6.5a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 20.5 6H18V4h-1v2h-6V4Zm6 4V7h-6v1h-1V7H7.5C6.67 7 6 7.67 6 8.5V10h16V8.5c0-.83-.67-1.5-1.5-1.5H18v1h-1Zm-5.15 10.15-3.5-3.5-.7.7L10.29 18H4v1h6.3l-2.65 2.65.7.7 3.5-3.5.36-.35-.36-.35Z" />
        </svg>
        Go to...
      </button>
    </div>
  );
}
