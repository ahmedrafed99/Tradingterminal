import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

/**
 * Polls the backend for drawings pushed via the /drawings/add API
 * and adds them to the Zustand drawing store.
 * Supports _command: 'clearAll' to remove all drawings.
 */
export function useRemoteDrawings(): void {
  const addDrawing = useStore((s) => s.addDrawing);
  const clearAllDrawings = useStore((s) => s.clearAllDrawings);
  const addDrawingRef = useRef(addDrawing);
  const clearAllRef = useRef(clearAllDrawings);
  addDrawingRef.current = addDrawing;
  clearAllRef.current = clearAllDrawings;

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/drawings/pending');
        if (!res.ok) return;
        const data = await res.json();
        const drawings = data.drawings;
        if (!Array.isArray(drawings) || drawings.length === 0) return;
        for (const d of drawings) {
          if (d._command === 'clearAll') {
            clearAllRef.current();
          } else {
            addDrawingRef.current(d);
          }
        }
      } catch {
        // Backend may not be running — ignore
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);
}
