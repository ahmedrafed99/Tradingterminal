import { useRef } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { Dropdown } from '../../shared/Dropdown';
import type { LineStyle } from '../../../types/drawing';
import { STROKE_WIDTH_OPTIONS } from '../../../types/drawing';
import { LINE_STYLE_DEFS } from './lineStyleDefs';

export function StrokePopover({
  currentWidth,
  currentStyle,
  onChange,
  onClose,
}: {
  currentWidth: number;
  currentStyle: LineStyle;
  onChange: (patch: { strokeWidth?: number; lineStyle?: LineStyle }) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, true, onClose);

  return (
    <Dropdown
      ref={ref}
      style={{ left: '50%', transform: 'translateX(-50%)', padding: '4px 5px', width: 140 }}
      onClick={(e) => e.stopPropagation()}
    >
      {STROKE_WIDTH_OPTIONS.map((w) => {
        const active = w === currentWidth;
        return (
          <button
            key={w}
            onClick={() => { onChange({ strokeWidth: w }); onClose(); }}
            className={`flex items-center w-full rounded-lg transition-colors text-left ${active ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
            style={{ padding: '7px 10px', gap: 10, border: 'none', cursor: 'pointer', ...(active ? { background: 'var(--color-text)', color: 'var(--color-surface)' } : {}) }}
          >
            <svg width="50" height="10" viewBox="0 0 50 10" preserveAspectRatio="none" shapeRendering="crispEdges" style={{ flex: 1 }}>
              <line x1="0" y1="5" x2="50" y2="5" stroke="currentColor" strokeWidth={w} />
            </svg>
            <span style={{ flexShrink: 0, width: 42, textAlign: 'center' }}>{w}px</span>
          </button>
        );
      })}

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '3px 0' }} />

      {LINE_STYLE_DEFS.map(({ style, label, dasharray, linecap }) => {
        const active = style === currentStyle;
        return (
          <button
            key={style}
            onClick={() => { onChange({ lineStyle: style }); onClose(); }}
            className={`flex items-center w-full rounded-lg transition-colors text-left ${active ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
            style={{ padding: '7px 10px', gap: 10, border: 'none', cursor: 'pointer', ...(active ? { background: 'var(--color-text)', color: 'var(--color-surface)' } : {}) }}
          >
            <svg width="50" height="10" viewBox="0 0 50 10" preserveAspectRatio="none" shapeRendering="crispEdges" style={{ flex: 1 }}>
              <line
                x1="0" y1="5" x2="50" y2="5"
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray={dasharray}
                strokeLinecap={linecap as React.SVGAttributes<SVGLineElement>['strokeLinecap'] ?? 'butt'}
              />
            </svg>
            <span style={{ flexShrink: 0, width: 42, textAlign: 'center' }}>{label}</span>
          </button>
        );
      })}
    </Dropdown>
  );
}