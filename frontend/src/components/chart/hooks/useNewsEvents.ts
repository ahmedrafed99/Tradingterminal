import { useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { fetchEconomicEvents } from '../../../services/newsService';
import type { ChartRefs } from './types';

export function useNewsEvents(refs: ChartRefs): void {
  // Fetch events on mount
  useEffect(() => {
    let cancelled = false;
    fetchEconomicEvents()
      .then((events) => {
        if (!cancelled) useStore.getState().setNewsEvents(events);
      })
      .catch(() => {
        // Non-critical — silently ignore
      });
    return () => { cancelled = true; };
  }, []);

  // Sync events + visibility to the primitive
  useEffect(() => {
    const primitive = refs.newsEventsPrimitive.current;
    if (!primitive) return;

    function sync() {
      const { newsEvents, newsVisible } = useStore.getState();
      primitive!.setEnabled(newsVisible);
      primitive!.setEvents(newsEvents.filter(e => e.impact !== 'medium'));
    }

    sync();

    const unsub = useStore.subscribe((s, prev) => {
      if (s.newsEvents !== prev.newsEvents || s.newsVisible !== prev.newsVisible) {
        sync();
      }
    });

    return () => {
      unsub();
      primitive.setEnabled(false);
    };
  }, []);

  // Mouse move / leave for tooltip hit-testing
  useEffect(() => {
    const container = refs.container.current;
    const primitive = refs.newsEventsPrimitive.current;
    if (!container || !primitive) return;

    const getPos = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    let newsRafId = 0;
    const onMove = (e: MouseEvent) => {
      if (newsRafId) return;
      const mx = e.clientX;
      const my = e.clientY;
      newsRafId = requestAnimationFrame(() => {
        newsRafId = 0;
        const rect = container.getBoundingClientRect();
        primitive.handleMouseMove(mx - rect.left, my - rect.top);
      });
    };

    const onClick = (e: MouseEvent) => {
      const { x, y } = getPos(e);
      primitive.handleClick(x, y);
    };

    const onLeave = () => {
      primitive.handleMouseLeave();
    };

    container.addEventListener('mousemove', onMove);
    container.addEventListener('click', onClick);
    container.addEventListener('mouseleave', onLeave);

    return () => {
      if (newsRafId) cancelAnimationFrame(newsRafId);
      container.removeEventListener('mousemove', onMove);
      container.removeEventListener('click', onClick);
      container.removeEventListener('mouseleave', onLeave);
    };
  }, []);
}
