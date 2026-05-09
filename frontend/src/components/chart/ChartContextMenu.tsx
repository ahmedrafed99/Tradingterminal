import { useRef, useEffect, useState } from 'react';
import type { Timeframe } from '../../store/useStore';
import { TimeframePicker } from './TimeframePicker';
import { SHADOW, Z, RADIUS } from '../../constants/layout';

interface Props {
  x: number;
  y: number;
  candleSeconds: number;
  onSelectTimeframe: (tf: Timeframe) => void;
  onClose: () => void;
}

export function ChartContextMenu({ x, y, candleSeconds, onSelectTimeframe, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [submenuOpen, setSubmenuOpen] = useState(false);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  // Adjust position so menu doesn't overflow viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 60);

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left: adjustedX, top: adjustedY, zIndex: Z.DROPDOWN + 10, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: RADIUS.LG, padding: '4px 0', boxShadow: SHADOW.MD, minWidth: 168 }}
    >
      <div
        className="relative"
        onMouseEnter={() => setSubmenuOpen(true)}
        onMouseLeave={() => setSubmenuOpen(false)}
      >
        <div
          className="flex items-center justify-between hover:bg-(--color-border) transition-colors cursor-default w-full"
          style={{ padding: '6px 12px', borderRadius: RADIUS.LG }}
        >
          <span className="flex items-center text-xs font-medium text-(--color-text)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="24" height="24" style={{ flexShrink: 0, color: 'white' }}>
              <path fill="currentColor" d="M11 4h-1v3H8.5a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5H10v3h1v-3h1.5a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5H11V4ZM9 8v12h3V8H9Zm10-1h-1v3h-1.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5H18v3h1v-3h1.5a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5H19V7Zm-2 10v-6h3v6h-3Z" />
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="24" height="24" style={{ flexShrink: 0, marginLeft: -2, color: 'white' }}>
              <path fill="currentColor" fillRule="evenodd" d="M11 4h-1v2H7.5A2.5 2.5 0 0 0 5 8.5V13h1v-2h16v8.5c0 .83-.67 1.5-1.5 1.5H14v1h6.5a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 20.5 6H18V4h-1v2h-6V4Zm6 4V7h-6v1h-1V7H7.5C6.67 7 6 7.67 6 8.5V10h16V8.5c0-.83-.67-1.5-1.5-1.5H18v1h-1Zm-5.15 10.15-3.5-3.5-.7.7L10.29 18H4v1h6.3l-2.65 2.65.7.7 3.5-3.5.36-.35-.36-.35Z" />
            </svg>
            <span style={{ marginLeft: 14 }}>Open bar in timeframe</span>
          </span>
          <svg className="text-(--color-text-muted) ml-4 shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {submenuOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 2,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: RADIUS.LG,
              boxShadow: SHADOW.MD,
              minWidth: '100%',
              zIndex: Z.DROPDOWN + 11,
            }}
          >
            <TimeframePicker
              maxSeconds={candleSeconds}
              onSelect={(tf) => { onSelectTimeframe(tf); onClose(); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
