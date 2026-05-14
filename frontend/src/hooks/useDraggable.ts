import { useState, useRef, useCallback } from 'react';

export function useDraggable<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

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

    const onMove = (ev: MouseEvent) => {
      setPos({
        x: startPos.x + ev.clientX - startMouse.x,
        y: startPos.y + ev.clientY - startMouse.y,
      });
    };

    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const dragStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, transform: 'none' }
    : {};

  return { ref, onDragMouseDown, dragStyle };
}
