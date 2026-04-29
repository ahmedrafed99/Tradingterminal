import { useRef, useEffect, useState } from 'react';
import type { Timeframe } from '../../store/useStore';
import { TimeframePicker } from './TimeframePicker';
import { SHADOW, Z } from '../../constants/layout';

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
      className="fixed bg-(--color-panel) border border-(--color-border) rounded-lg py-1"
      style={{ left: adjustedX, top: adjustedY, zIndex: Z.DROPDOWN + 10, boxShadow: SHADOW.XL, minWidth: 168 }}
    >
      <div
        className="relative"
        onMouseEnter={() => setSubmenuOpen(true)}
        onMouseLeave={() => setSubmenuOpen(false)}
      >
        <div
          className="flex items-center justify-between px-3 py-2 hover:bg-(--color-surface) cursor-default rounded-md mx-1"
          style={{ padding: '8px 12px' }}
        >
          <span className="text-xs font-medium text-(--color-text)">Open candle in timeframe...</span>
          <svg className="text-(--color-text-muted) ml-4 shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {submenuOpen && (
          <div
            className="absolute top-0 bg-(--color-panel) border border-(--color-border) rounded-lg"
            style={{
              left: '100%',
              marginLeft: -1,
              boxShadow: SHADOW.XL,
              minWidth: 140,
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
