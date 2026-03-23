import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

/**
 * Connects to the backend SSE stream at /drawings/events.
 * Drawings pushed via POST /drawings/add appear on the chart instantly.
 * Supports _command: 'clearAll' to remove all drawings.
 */
export function useRemoteDrawings(): void {
  const addDrawing = useStore((s) => s.addDrawing);
  const removeDrawing = useStore((s) => s.removeDrawing);
  const clearAllDrawings = useStore((s) => s.clearAllDrawings);
  const addDrawingRef = useRef(addDrawing);
  const removeRef = useRef(removeDrawing);
  const clearAllRef = useRef(clearAllDrawings);
  addDrawingRef.current = addDrawing;
  removeRef.current = removeDrawing;
  clearAllRef.current = clearAllDrawings;

  useEffect(() => {
    const es = new EventSource('/drawings/events');

    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d._command === 'clearAll') {
          clearAllRef.current();
        } else if (d._command === 'remove' && d.id) {
          removeRef.current(d.id);
        } else {
          addDrawingRef.current(d);
        }
      } catch {
        // Malformed message — ignore
      }
    };

    return () => es.close();
  }, []);
}
