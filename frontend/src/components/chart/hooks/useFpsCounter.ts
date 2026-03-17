import { useEffect, useRef, useState } from 'react';

/**
 * Measures rendering FPS using requestAnimationFrame.
 * Returns the current FPS value (updated ~once per second).
 */
export function useFpsCounter(enabled: boolean): number {
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setFps(0);
      return;
    }

    frameCountRef.current = 0;
    lastTimeRef.current = performance.now();

    const tick = (now: number) => {
      frameCountRef.current++;
      const elapsed = now - lastTimeRef.current;
      if (elapsed >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled]);

  return fps;
}
