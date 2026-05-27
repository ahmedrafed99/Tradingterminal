import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from '../icons/ChevronDown';
import { ChevronUp } from '../icons/ChevronUp';

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDrag: (ratio: number) => void;
  collapsed?: boolean;
  onToggle?: () => void;
  highlighted?: boolean;
}

export function VerticalSeparator({ containerRef, onDrag, collapsed, onToggle, highlighted }: Props) {
  const [dragging, setDragging] = useState(false);
  const rectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    if (!dragging) return;
    function onMouseMove(e: MouseEvent) {
      const rect = rectRef.current;
      if (!rect) return;
      const ratio = (e.clientY - rect.top) / rect.height;
      onDrag(ratio);
    }
    function onMouseUp() { setDragging(false); }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, onDrag]);

  return (
    <div
      className="group/sep relative h-1 cursor-row-resize flex-shrink-0 bg-(--color-panel)"
      onMouseDown={(e) => { e.preventDefault(); rectRef.current = containerRef.current?.getBoundingClientRect() ?? null; setDragging(true); }}
    >
      <div className={`absolute top-0 left-0 right-0 h-px pointer-events-none transition-colors group-hover/sep:bg-(--color-text-dim) ${
        dragging ? 'bg-(--color-accent)' : highlighted ? 'bg-(--color-text-dim)' : 'bg-(--color-border)'
      }`} />
      {onToggle && (
        <button
          className={`absolute left-1/2 -translate-x-1/2 -top-2 z-10
            flex items-center justify-center rounded-sm
            bg-(--color-surface) text-(--color-text-dim) border border-(--color-border)
            hover:bg-(--color-hover-toolbar) hover:text-(--color-text)
            transition-all cursor-pointer
            ${collapsed ? 'opacity-100' : 'opacity-0 group-hover/sep:opacity-100'}`}
          style={{ width: 24, height: 16 }}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </button>
      )}
    </div>
  );
}
