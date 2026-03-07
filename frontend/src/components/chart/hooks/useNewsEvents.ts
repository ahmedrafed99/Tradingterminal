import { useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { fetchEconomicEvents } from '../../../services/newsService';
import type { ChartRefs } from './types';

export function useNewsEvents(refs: ChartRefs): void {
  // Fetch events on mount
  useEffect(() => {
    fetchEconomicEvents()
      .then((events) => useStore.getState().setNewsEvents(events))
      .catch(() => {
        // Non-critical — silently ignore
      });
  }, []);

  // Sync events + visibility to the primitive
  useEffect(() => {
    const primitive = refs.newsEventsPrimitive.current;
    if (!primitive) return;

    function sync() {
      const { newsEvents, newsVisible } = useStore.getState();
      primitive!.setEnabled(newsVisible);
      primitive!.setEvents(newsEvents);
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

    const onMove = (e: MouseEvent) => {
      const { x, y } = getPos(e);
      primitive.handleMouseMove(x, y);
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
      container.removeEventListener('mousemove', onMove);
      container.removeEventListener('click', onClick);
      container.removeEventListener('mouseleave', onLeave);
    };
  }, []);
}
