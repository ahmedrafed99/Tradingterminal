import { useState, useRef, useCallback } from 'react';

interface UseDraggableOptions {
  initialPos?: { x: number; y: number };
  onDragEnd?: (pos: { x: number; y: number }) => void;
}

export function useDraggable<T extends HTMLElement = HTMLDivElement>(options?: UseDraggableOptions) {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(options?.initialPos ?? null);
  const [isDragging, setIsDragging] = useState(false);
  const latestPosRef = useRef<{ x: number; y: number } | null>(null);
  const onDragEndRef = useRef(options?.onDragEnd);
  onDragEndRef.current = options?.onDragEnd;

  const onDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't start drag if clicking an interactive element inside the header
    if ((e.target as HTMLElement).closest('button, input, select, textarea')) return;
    e.preventDefault();

    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const startMouse = { x: e.clientX, y: e.clientY };
    const startPos = { x: rect.left, y: rect.top };

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    setIsDragging(true);

    const onMove = (ev: MouseEvent) => {
      const newPos = {
        x: startPos.x + ev.clientX - startMouse.x,
        y: startPos.y + ev.clientY - startMouse.y,
      };
      latestPosRef.current = newPos;
      setPos(newPos);
    };

    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (latestPosRef.current) onDragEndRef.current?.(latestPosRef.current);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const dragStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, transform: 'none' }
    : {};

  return { ref, onDragMouseDown, dragStyle, isDragging };
}
