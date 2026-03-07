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

const MARKER_RADIUS = 10;
const BOTTOM_OFFSET = 14;
const MARKER_COLOR = '#9b59b6';
const MARKER_FILL = 'rgba(155, 89, 182, 0.18)';
const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

const IMPACT_COLORS: Record<string, string> = {
  high: '#ef5350',
  medium: '#f0a830',
  low: '#787b86',
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
        const highestImpact = this._getHighestImpact(m.events);

        // Circle
        ctx.beginPath();
        ctx.arc(m.x, y, MARKER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = isHovered ? 'rgba(155, 89, 182, 0.30)' : MARKER_FILL;
        ctx.fill();
        ctx.strokeStyle = isHovered ? '#b07cc6' : MARKER_COLOR;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Lightning bolt
        ctx.save();
        ctx.translate(m.x, y);
        ctx.beginPath();
        ctx.moveTo(-3, -6);
        ctx.lineTo(1, -1);
        ctx.lineTo(-1, 0);
        ctx.lineTo(3, 6);
        ctx.lineTo(-1, 1);
        ctx.lineTo(1, 0);
        ctx.closePath();
        ctx.fillStyle = IMPACT_COLORS[highestImpact] || MARKER_COLOR;
        ctx.fill();

        if (isHovered) {
          ctx.shadowColor = IMPACT_COLORS[highestImpact] || MARKER_COLOR;
          ctx.shadowBlur = 6;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      }
    });
  }

  private _getHighestImpact(events: NewsEvent[]): string {
    if (events.some((e) => e.impact === 'high')) return 'high';
    if (events.some((e) => e.impact === 'medium')) return 'medium';
    return 'low';
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

  // Scroll listener (to hide tooltip on scroll)
  private _rangeUnsub: (() => void) | null = null;

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
  }

  // Called after attaching, to provide the overlay element and chart element
  setOverlay(overlay: HTMLDivElement, chartEl: HTMLElement, chart: IChartApi): void {
    this._overlayEl = overlay;
    this._chartEl = chartEl;
    this._chart = chart;

    // Dismiss tooltip on scroll
    this._rangeUnsub = (() => {
      const cb = () => { this._pinnedIdx = -1; this._hideTooltip(); };
      chart.timeScale().subscribeVisibleLogicalRangeChange(cb);
      return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(cb);
    })();
  }

  // -- Public API --

  setEvents(events: NewsEvent[]): void {
    this._events = events;
    this._requestUpdate?.();
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) { this._pinnedIdx = -1; this._hideTooltip(); }
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

    const markers = this._buildMarkers();
    this._cachedMarkers = markers;
    const paneHeight = this._getPaneHeight();
    this._paneView.update(markers, paneHeight, this._hoveredIdx);
    return this._paneViewsArr;
  }

  updateAllViews(): void {
    // no-op — coordinates recalculated in paneViews
  }

  // -- Internals --

  private _hitTest(x: number, y: number): number {
    const paneHeight = this._getPaneHeight();
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

  private _getPaneHeight(): number {
    if (!this._chartEl || !this._chart) return 400;
    return this._chartEl.clientHeight - this._chart.timeScale().height();
  }

  private _buildMarkers(): MarkerData[] {
    const chart = this._chart;
    const ts = chart?.timeScale();
    if (!ts) return [];

    // Group events by their time-axis coordinate (rounded to nearest px)
    const byX = new Map<number, NewsEvent[]>();

    for (const event of this._events) {
      const eventTime = Math.floor(new Date(event.date).getTime() / 1000) as unknown as Time;
      const x = ts.timeToCoordinate(eventTime);
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
        pointer-events: none;
        z-index: 40;
        background: #000;
        border: 1px solid #2a2e39;
        border-radius: 6px;
        padding: 8px 10px;
        font-family: ${FONT_FAMILY};
        max-width: 280px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      `;
      this._overlayEl.appendChild(this._tooltipEl);
    }

    const paneHeight = this._getPaneHeight();
    const markerY = paneHeight - BOTTOM_OFFSET;

    // Build tooltip content
    let html = '';
    const eventsToShow = marker.events.slice(0, 5); // cap at 5

    for (let i = 0; i < eventsToShow.length; i++) {
      const ev = eventsToShow[i];
      if (i > 0) html += '<div style="border-top:1px solid #2a2e39; margin:5px 0"></div>';

      const impactColor = IMPACT_COLORS[ev.impact] || '#787b86';
      const dateStr = this._formatDate(ev.date);

      html += `<div style="font-size:11px; color:#d1d4dc; font-weight:600; line-height:1.3">${this._escapeHtml(ev.title)}</div>`;
      html += `<div style="display:flex; align-items:center; gap:6px; margin-top:3px">`;
      html += `<span style="font-size:10px; color:${impactColor}; font-weight:600; text-transform:uppercase">${ev.impact}</span>`;
      html += `<span style="font-size:10px; color:#787b86">${dateStr}</span>`;
      html += `</div>`;

      // Consensus / Previous / Actual
      const parts: string[] = [];
      if (ev.consensus !== null) parts.push(`Est: ${ev.consensus}`);
      if (ev.previous !== null) parts.push(`Prev: ${ev.previous}`);
      if (ev.actual !== null) {
        const beatColor = ev.isBetterThanExpected === true ? '#26a69a' : ev.isBetterThanExpected === false ? '#ef5350' : '#d1d4dc';
        parts.push(`<span style="color:${beatColor}">Act: ${ev.actual}</span>`);
      }
      if (parts.length > 0) {
        html += `<div style="font-size:10px; color:#787b86; margin-top:2px">${parts.join(' · ')}</div>`;
      }
    }

    if (marker.events.length > 5) {
      html += `<div style="font-size:10px; color:#787b86; margin-top:4px">+${marker.events.length - 5} more</div>`;
    }

    this._tooltipEl.innerHTML = html;
    this._tooltipEl.style.display = 'block';

    // Position: above the marker, centered on it
    const tooltipWidth = this._tooltipEl.offsetWidth;
    const containerWidth = this._overlayEl.clientWidth;
    let left = marker.x - tooltipWidth / 2;
    left = Math.max(4, Math.min(left, containerWidth - tooltipWidth - 4));

    this._tooltipEl.style.left = `${left}px`;
    this._tooltipEl.style.top = `${markerY - MARKER_RADIUS - 8 - this._tooltipEl.offsetHeight}px`;
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

  private _formatDate(iso: string): string {
    const d = new Date(iso);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;

    // Convert to ET display
    const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
    return `${month}/${day}/${year} @ ${etStr} ET`;
  }

  private _escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
