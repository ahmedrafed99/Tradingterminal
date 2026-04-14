import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesType,
  Time,
  ISeriesApi,
  IChartApi,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { NewsEvent } from '../../../types/news';

import { FONT_FAMILY } from '../../../constants/layout';

const MARKER_RADIUS = 10;
const BOTTOM_OFFSET = 14;

import { COLOR_SELL, COLOR_BUY, COLOR_WARNING, COLOR_TEXT_MUTED, COLOR_BORDER, COLOR_NEWS_EVENT, COLOR_NEWS_EVENT_HOVER } from '../../../constants/colors';

const MARKER_FILL = COLOR_NEWS_EVENT + '2e'; // 18% opacity
import { SHADOW, RADIUS } from '../../../constants/layout';

const IMPACT_COLORS: Record<string, string> = {
  high: COLOR_SELL,
  medium: COLOR_WARNING,
  low: COLOR_TEXT_MUTED,
};

interface MarkerData {
  x: number;
  events: NewsEvent[];
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
class NewsMarkersRenderer implements IPrimitivePaneRenderer {
  private _markers: MarkerData[];
  private _paneHeight: number;
  private _hoveredIdx: number;

  constructor(markers: MarkerData[], paneHeight: number, hoveredIdx: number) {
    this._markers = markers;
    this._paneHeight = paneHeight;
    this._hoveredIdx = hoveredIdx;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const y = this._paneHeight - BOTTOM_OFFSET;

      for (let i = 0; i < this._markers.length; i++) {
        const m = this._markers[i];
        const isHovered = i === this._hoveredIdx;

        // Circle
        ctx.beginPath();
        ctx.arc(m.x, y, MARKER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = isHovered ? COLOR_NEWS_EVENT + '4d' : MARKER_FILL; // 30% / 18% opacity
        ctx.fill();
        ctx.strokeStyle = isHovered ? COLOR_NEWS_EVENT_HOVER : COLOR_NEWS_EVENT;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Lightning bolt — simple ⚡ shape, always purple
        ctx.save();
        ctx.translate(m.x, y);
        ctx.beginPath();
        ctx.moveTo(1, -7);
        ctx.lineTo(-3, 1);
        ctx.lineTo(0, 1);
        ctx.lineTo(-1, 7);
        ctx.lineTo(3, -1);
        ctx.lineTo(0, -1);
        ctx.closePath();
        ctx.fillStyle = isHovered ? COLOR_NEWS_EVENT_HOVER : COLOR_NEWS_EVENT;
        ctx.fill();

        if (isHovered) {
          ctx.shadowColor = COLOR_NEWS_EVENT;
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      }
    });
  }

}

// ---------------------------------------------------------------------------
// PaneView
// ---------------------------------------------------------------------------
class NewsMarkersPaneView implements IPrimitivePaneView {
  _markers: MarkerData[] = [];
  _paneHeight = 0;
  _hoveredIdx = -1;

  update(markers: MarkerData[], paneHeight: number, hoveredIdx: number): void {
    this._markers = markers;
    this._paneHeight = paneHeight;
    this._hoveredIdx = hoveredIdx;
  }

  renderer(): IPrimitivePaneRenderer {
    return new NewsMarkersRenderer(this._markers, this._paneHeight, this._hoveredIdx);
  }

  zOrder(): string {
    return 'normal';
  }
}

// ---------------------------------------------------------------------------
// NewsEventsPrimitive
// ---------------------------------------------------------------------------
export class NewsEventsPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: IChartApi | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _chartEl: HTMLElement | null = null;

  private _events: NewsEvent[] = [];
  private _enabled = true;
  private _hoveredIdx = -1;
  private _pinnedIdx = -1; // click-pinned tooltip

  private _paneView = new NewsMarkersPaneView();
  private _paneViewsArr: readonly IPrimitivePaneView[] = [this._paneView];
  private _emptyViews: readonly IPrimitivePaneView[] = [];

  // Tooltip DOM
  private _tooltipEl: HTMLDivElement | null = null;
  private _overlayEl: HTMLDivElement | null = null;

  // Injected cursor style
  private _cursorStyle: HTMLStyleElement | null = null;

  // Cached markers for hit-testing
  private _cachedMarkers: MarkerData[] = [];

  // Scroll listener (to hide tooltip on scroll + invalidate marker positions)
  private _rangeUnsub: (() => void) | null = null;

  // Dirty flag — skip _buildMarkers() when markers haven't changed
  private _markersDirty = true;
  private _cachedBuildResult: MarkerData[] = [];

  // Cached pane height (updated by ResizeObserver, avoids clientHeight reflow per frame)
  private _cachedPaneHeight = 400;
  private _resizeObserver: ResizeObserver | null = null;

  // -- Lifecycle --

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this._chart = (param as unknown as { chart: IChartApi }).chart ?? null;
  }

  detached(): void {
    this._series = null;
    this._requestUpdate = null;
    this._chart = null;
    this._destroyTooltip();
    this._removeCursorOverride();
    this._rangeUnsub?.();
    this._rangeUnsub = null;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  // Called after attaching, to provide the overlay element and chart element
  setOverlay(overlay: HTMLDivElement, chartEl: HTMLElement, chart: IChartApi): void {
    this._overlayEl = overlay;
    this._chartEl = chartEl;
    this._chart = chart;

    // Cache initial pane height
    this._cachedPaneHeight = chartEl.clientHeight - chart.timeScale().height();

    // Track resize to update cached pane height without per-frame clientHeight reads
    this._resizeObserver?.disconnect();
    this._resizeObserver = new ResizeObserver(() => {
      this._cachedPaneHeight = chartEl.clientHeight - (chart.timeScale().height() ?? 0);
      this._requestUpdate?.();
    });
    this._resizeObserver.observe(chartEl);

    // Dismiss tooltip on scroll + invalidate marker x-coords (timeToCoordinate changes)
    this._rangeUnsub?.();
    this._rangeUnsub = (() => {
      const cb = () => {
        this._pinnedIdx = -1;
        this._hideTooltip();
        this._markersDirty = true;
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(cb);
      return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(cb);
    })();
  }

  // -- Public API --

  setEvents(events: NewsEvent[]): void {
    this._events = events;
    this._markersDirty = true;
    this._requestUpdate?.();
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) { this._pinnedIdx = -1; this._hideTooltip(); }
    this._markersDirty = true;
    this._requestUpdate?.();
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  /** Call from mousemove — hover highlight + cursor only, no tooltip */
  handleMouseMove(x: number, y: number): void {
    if (!this._enabled || !this._chartEl) return;

    const hitIdx = this._hitTest(x, y);

    if (hitIdx !== this._hoveredIdx) {
      this._hoveredIdx = hitIdx;
      if (hitIdx >= 0) {
        this._applyCursorOverride();
      } else {
        this._removeCursorOverride();
      }
      this._requestUpdate?.();
    }
  }

  /** Call from click — toggle tooltip on/off */
  handleClick(x: number, y: number): void {
    if (!this._enabled || !this._chartEl) return;

    const hitIdx = this._hitTest(x, y);

    if (hitIdx >= 0) {
      if (this._pinnedIdx === hitIdx) {
        // Click same marker again — dismiss
        this._pinnedIdx = -1;
        this._hideTooltip();
      } else {
        // Pin new marker
        this._pinnedIdx = hitIdx;
        this._showTooltip(this._cachedMarkers[hitIdx], x);
      }
    } else {
      // Click outside any marker — dismiss
      if (this._pinnedIdx !== -1) {
        this._pinnedIdx = -1;
        this._hideTooltip();
      }
    }
    this._requestUpdate?.();
  }

  handleMouseLeave(): void {
    if (this._hoveredIdx !== -1) {
      this._hoveredIdx = -1;
      this._removeCursorOverride();
      this._requestUpdate?.();
    }
  }

  // -- ISeriesPrimitive rendering --

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this._enabled || !this._series || !this._chart || this._events.length === 0) {
      return this._emptyViews;
    }

    if (this._markersDirty) {
      this._cachedBuildResult = this._buildMarkers();
      this._cachedMarkers = this._cachedBuildResult;
      this._markersDirty = false;
    }

    this._paneView.update(this._cachedBuildResult, this._cachedPaneHeight, this._hoveredIdx);
    return this._paneViewsArr;
  }

  updateAllViews(): void {
    // no-op — coordinates recalculated in paneViews
  }

  // -- Internals --

  private _hitTest(x: number, y: number): number {
    const paneHeight = this._cachedPaneHeight;
    const markerY = paneHeight - BOTTOM_OFFSET;
    const markers = this._cachedMarkers;
    const threshold = (MARKER_RADIUS + 3) * (MARKER_RADIUS + 3);

    for (let i = 0; i < markers.length; i++) {
      const dx = x - markers[i].x;
      const dy = y - markerY;
      if (dx * dx + dy * dy <= threshold) return i;
    }
    return -1;
  }

  private _buildMarkers(): MarkerData[] {
    const ts = this._chart?.timeScale();
    if (!ts || !this._series) return [];

    // Get last candle time + pixel for future-event extrapolation
    let lastCandleTime = 0;
    let lastCandleX: number | null = null;
    let pxPerSec = 0;
    try {
      const data = (this._series as any).data() as { time: number }[];
      if (data && data.length >= 2) {
        const d1 = data[data.length - 2];
        const d2 = data[data.length - 1];
        lastCandleTime = Number(d2.time);
        const x1 = ts.timeToCoordinate(d1.time as unknown as Time);
        lastCandleX = ts.timeToCoordinate(d2.time as unknown as Time);
        if (x1 !== null && lastCandleX !== null) {
          pxPerSec = (lastCandleX - x1) / (Number(d2.time) - Number(d1.time));
        }
      }
    } catch { /* ignore */ }

    // Group events by their time-axis coordinate (rounded to nearest px)
    const byX = new Map<number, NewsEvent[]>();

    for (const event of this._events) {
      const eventSec = Math.floor(new Date(event.date).getTime() / 1000);

      // Use timeToCoordinate for events within data range (accurate)
      let x = ts.timeToCoordinate(eventSec as unknown as Time);

      // Fall back to linear extrapolation for future events beyond last candle
      if (x === null && lastCandleX !== null && eventSec > lastCandleTime && pxPerSec !== 0) {
        x = (lastCandleX + (eventSec - lastCandleTime) * pxPerSec) as typeof lastCandleX;
      }

      if (x === null) continue;

      const rx = Math.round(x);
      const group = byX.get(rx);
      if (group) {
        group.push(event);
      } else {
        byX.set(rx, [event]);
      }
    }

    // Merge nearby markers (within 2*MARKER_RADIUS px)
    const sorted = [...byX.entries()].sort((a, b) => a[0] - b[0]);
    const merged: MarkerData[] = [];

    for (const [x, events] of sorted) {
      if (merged.length > 0) {
        const last = merged[merged.length - 1];
        if (Math.abs(x - last.x) < MARKER_RADIUS * 2) {
          last.events.push(...events);
          last.x = Math.round((last.x + x) / 2);
          continue;
        }
      }
      merged.push({ x, events });
    }

    return merged;
  }

  // -- Tooltip --

  private _showTooltip(marker: MarkerData, _mouseX: number): void {
    if (!this._overlayEl) return;

    if (!this._tooltipEl) {
      this._tooltipEl = document.createElement('div');
      this._tooltipEl.style.cssText = `
        position: absolute;
        pointer-events: auto;
        z-index: 40;
        background: var(--color-surface);
        border: 1px solid ${COLOR_BORDER};
        border-radius: ${RADIUS.MD}px;
        padding: 0;
        font-family: ${FONT_FAMILY};
        width: 260px;
        max-height: 320px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(155,89,182,0.3) transparent;
        box-shadow: ${SHADOW.LG};
      `;
      // Inject webkit scrollbar styles once
      if (!document.getElementById('news-tooltip-style')) {
        const s = document.createElement('style');
        s.id = 'news-tooltip-style';
        s.textContent = `.news-tooltip::-webkit-scrollbar{width:3px}.news-tooltip::-webkit-scrollbar-track{background:transparent}.news-tooltip::-webkit-scrollbar-thumb{background:rgba(155,89,182,0.3);border-radius:2px}.news-tooltip::-webkit-scrollbar-thumb:hover{background:rgba(155,89,182,0.5)}`;
        document.head.appendChild(s);
      }
      this._tooltipEl.className = 'news-tooltip';
      this._tooltipEl.addEventListener('click', (e) => e.stopPropagation());
      this._tooltipEl.addEventListener('mousedown', (e) => e.stopPropagation());
      this._overlayEl.appendChild(this._tooltipEl);
    }

    const paneHeight = this._cachedPaneHeight;
    const markerY = paneHeight - BOTTOM_OFFSET;

    // Build tooltip content
    let html = '';
    for (let i = 0; i < marker.events.length; i++) {
      const ev = marker.events[i];
      if (i > 0) html += `<div style="border-top:1px solid ${COLOR_BORDER}"></div>`;

      const impactColor = IMPACT_COLORS[ev.impact] || COLOR_TEXT_MUTED;
      const timeStr = this._formatTime(ev.date);

      html += `<div style="padding:10px 12px">`;

      // Header: impact dot + label + time
      html += `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px">`;
      html += `<div style="display:flex; align-items:center; gap:5px">`;
      html += `<span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:${impactColor}; flex-shrink:0"></span>`;
      html += `<span style="font-size:var(--font-size-sm); color:${impactColor}; font-weight:600; text-transform:uppercase; letter-spacing:0.3px">${ev.impact} impact</span>`;
      html += `</div>`;
      html += `<span style="font-size:var(--font-size-sm); color:var(--color-text-medium)">${timeStr}</span>`;
      html += `</div>`;

      // Title
      html += `<div style="font-size:var(--font-size-sm); color:var(--color-text, #d1d4dc); font-weight:600; line-height:1.3; margin-bottom:8px">${this._escapeHtml(ev.title)}</div>`;

      // Data grid (actual / consensus / previous)
      const hasActual = ev.actual !== null;
      const hasConsensus = ev.consensus !== null;
      const hasPrevious = ev.previous !== null;
      const hasData = hasActual || hasConsensus || hasPrevious;

      if (hasData) {
        const cols = [hasActual, hasConsensus, hasPrevious].filter(Boolean).length;
        const actualColor = 'var(--color-text)';

        html += `<div style="display:grid; grid-template-columns:repeat(${cols}, 1fr); gap:2px 12px; margin-bottom:6px">`;
        // Column headers
        if (hasActual) html += `<div style="font-size:var(--font-size-sm); color:var(--color-text-muted); font-weight:500">Actual</div>`;
        if (hasConsensus) html += `<div style="font-size:var(--font-size-sm); color:var(--color-text-muted); font-weight:500">Cons.</div>`;
        if (hasPrevious) html += `<div style="font-size:var(--font-size-sm); color:var(--color-text-muted); font-weight:500">Prev.</div>`;
        // Values
        if (hasActual) html += `<div style="font-size:var(--font-size-sm); color:${actualColor}; font-weight:600">${ev.actual}</div>`;
        if (hasConsensus) html += `<div style="font-size:var(--font-size-sm); color:var(--color-text); font-weight:400">${ev.consensus}</div>`;
        if (hasPrevious) html += `<div style="font-size:var(--font-size-sm); color:var(--color-text-muted); font-weight:400">${ev.previous}</div>`;
        html += `</div>`;

        // Beat/miss indicator
        if (hasActual && hasConsensus && ev.isBetterThanExpected !== null) {
          const beatLabel = ev.isBetterThanExpected ? 'Better than expected' : 'Worse than expected';
          html += `<div style="display:flex; align-items:center; gap:4px">`;
          html += `<span style="display:inline-block; width:5px; height:5px; border-radius:50%; background:var(--color-text-muted)"></span>`;
          html += `<span style="font-size:var(--font-size-sm); color:var(--color-text-muted); font-weight:500">${beatLabel}</span>`;
          html += `</div>`;
        }
      }

      html += `</div>`; // close event block
    }

    // Footer for grouped events
    if (marker.events.length > 1) {
      html += `<div style="border-top:1px solid ${COLOR_BORDER}; padding:6px 12px; font-size:10px; color:var(--color-text-muted)">`;
      html += `${marker.events.length} events at this time`;
      html += `</div>`;
    }

    this._tooltipEl.innerHTML = html;
    this._tooltipEl.style.display = 'block';

    // Position: above the marker, centered on it
    const tooltipWidth = this._tooltipEl.offsetWidth;
    const containerWidth = this._overlayEl.clientWidth;
    let left = marker.x - tooltipWidth / 2;
    left = Math.max(4, Math.min(left, containerWidth - tooltipWidth - 4));

    const top = markerY - MARKER_RADIUS - 8 - this._tooltipEl.offsetHeight;
    this._tooltipEl.style.left = `${left}px`;
    this._tooltipEl.style.top = `${Math.max(4, top)}px`;
  }

  private _hideTooltip(): void {
    if (this._tooltipEl) {
      this._tooltipEl.style.display = 'none';
    }
  }

  private _destroyTooltip(): void {
    if (this._tooltipEl) {
      this._tooltipEl.remove();
      this._tooltipEl = null;
    }
  }

  private _applyCursorOverride(): void {
    if (this._cursorStyle) return;
    this._cursorStyle = document.createElement('style');
    this._cursorStyle.textContent = `.tv-lightweight-charts * { cursor: pointer !important; }`;
    document.head.appendChild(this._cursorStyle);
  }

  private _removeCursorOverride(): void {
    if (this._cursorStyle) {
      this._cursorStyle.remove();
      this._cursorStyle = null;
    }
  }

  private _formatTime(iso: string): string {
    const d = new Date(iso);
    const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
    return `${etStr} ET`;
  }

  private _escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
