import { useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { fetchEconomicEvents } from '../../../services/newsService';
import { fetchHolidays } from '../../../services/holidayService';
import { setHolidays } from '../../../utils/marketHours';
import type { ChartRefs } from './types';
import { COLOR_NEWS_EVENT } from '../../../constants/colors';
import type { VLineDrawing } from '../../../types/drawing';
import { NEWS_MARKER_RADIUS, NEWS_BOTTOM_OFFSET } from '../primitives/NewsEventsPrimitive';

export function useNewsEvents(refs: ChartRefs): void {
  // Fetch news events + holidays on mount
  useEffect(() => {
    let cancelled = false;
    fetchEconomicEvents()
      .then((events) => {
        if (!cancelled) useStore.getState().setNewsEvents(events);
      })
      .catch(() => {});
    fetchHolidays()
      .then((holidays) => {
        if (!cancelled) setHolidays(holidays);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Sync events + visibility to the primitive
  useEffect(() => {
    const primitive = refs.newsEventsPrimitive.current;
    if (!primitive) return;

    function sync() {
      const { newsEvents, newsImpactFilter } = useStore.getState();
      const anyActive = newsImpactFilter.high || newsImpactFilter.medium || newsImpactFilter.low;
      primitive!.setEnabled(anyActive);
      primitive!.setEvents(newsEvents.filter(e => newsImpactFilter[e.impact]));
    }

    sync();

    const unsub = useStore.subscribe((s, prev) => {
      if (s.newsEvents !== prev.newsEvents || s.newsImpactFilter !== prev.newsImpactFilter) {
        sync();
      }
    });

    return () => {
      unsub();
      primitive.setEnabled(false);
    };
  }, []);

  // Wire news marker click → toggle vline
  useEffect(() => {
    const primitive = refs.newsEventsPrimitive.current;
    if (!primitive) return;

    primitive.setOnMarkerClick((timeUnixSec: number | null) => {
      const { contract, drawings, addDrawing, removeDrawing } = useStore.getState();
      if (!contract) return;
      const contractId = String(contract.id);

      if (timeUnixSec === null) {
        drawings
          .filter(d => d.type === 'vline' && d.contractId === contractId && d.color === COLOR_NEWS_EVENT)
          .forEach(d => removeDrawing(d.id));
        return;
      }

      const existing = drawings.find(
        (d): d is VLineDrawing =>
          d.type === 'vline' &&
          d.contractId === contractId &&
          d.color === COLOR_NEWS_EVENT &&
          (d as VLineDrawing).time === timeUnixSec,
      );
      if (existing) {
        removeDrawing(existing.id);
      } else {
        addDrawing({
          id: crypto.randomUUID(),
          type: 'vline',
          time: timeUnixSec,
          color: COLOR_NEWS_EVENT,
          strokeWidth: 1,
          lineStyle: 'dashed',
          text: null,
          contractId,
          bottomPad: NEWS_BOTTOM_OFFSET + NEWS_MARKER_RADIUS * 2,
        });
      }
    });

    return () => {
      primitive.setOnMarkerClick(null);
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
