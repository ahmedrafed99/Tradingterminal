import { useState, useEffect, useRef, useCallback } from 'react';
import type { IChartApi } from 'lightweight-charts';
import { ChartSettingsModal } from './ChartSettingsModal';

interface Props {
  chartRef: React.RefObject<IChartApi | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Gear button that fills the bottom-right dead zone of the chart
 * (the empty rectangle where the time scale meets the price scale).
 * We find the actual dead-zone <td> that lightweight-charts renders
 * and position/size the button to cover it exactly.
 */
export function ChartSettingsButton({ chartRef, containerRef }: Props) {
  const [open, setOpen] = useState(false);
  const [inverted, setInverted] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [rect, setRect] = useState<{ w: number; h: number; r: number; b: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Find the dead-zone cell and match its size/position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      // LWC renders the bottom-right corner as the last <td> in the last <tr>
      // of its internal table layout. Find it by querying the actual element.
      const parent = container.parentElement;
      if (!parent) return;
      const tables = container.querySelectorAll('table');
      if (!tables.length) return;
      const table = tables[tables.length - 1];
      const rows = table.querySelectorAll('tr');
      if (!rows.length) return;
      const lastRow = rows[rows.length - 1];
      const cells = lastRow.querySelectorAll('td');
      if (!cells.length) return;
      const deadZone = cells[cells.length - 1] as HTMLElement;

      const parentRect = parent.getBoundingClientRect();
      const dzRect = deadZone.getBoundingClientRect();

      setRect({
        w: dzRect.width,
        h: dzRect.height,
        r: parentRect.right - dzRect.right,
        b: parentRect.bottom - dzRect.bottom,
      });
    };

    // Measure after chart is ready + on resize.
    // We observe both the container AND the dead-zone <td> itself, because
    // the price scale can change width (e.g. when bar data loads and price
    // labels get wider) without the outer container resizing.
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(container);

    // Find and observe the dead-zone cell directly so we catch price-scale
    // width changes that happen after initial data load.
    let deadZoneCell: HTMLElement | null = null;
    requestAnimationFrame(() => {
      const tables = container.querySelectorAll('table');
      if (!tables.length) return;
      const table = tables[tables.length - 1];
      const rows = table.querySelectorAll('tr');
      if (!rows.length) return;
      const lastRow = rows[rows.length - 1];
      const cells = lastRow.querySelectorAll('td');
      if (!cells.length) return;
      deadZoneCell = cells[cells.length - 1] as HTMLElement;
      ro.observe(deadZoneCell);
    });

    const chart = chartRef.current;
    if (chart) {
      chart.timeScale().subscribeVisibleLogicalRangeChange(measure);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (chart) {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(measure);
      }
    };
  }, [chartRef, containerRef]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggleInvert = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const next = !inverted;
    setInverted(next);
    chart.applyOptions({ rightPriceScale: { invertScale: next } });
  }, [chartRef, inverted]);

  // Read the initial invert state from the chart once it's available
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const chart = chartRef.current;
      if (!chart) return;
      const opts = chart.options();
      if ((opts as any).rightPriceScale?.invertScale) {
        setInverted(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [chartRef]);

  if (!rect) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-(--color-surface) transition-colors cursor-pointer"
        style={{
          position: 'absolute',
          bottom: rect.b,
          right: rect.r,
          zIndex: 30,
          width: rect.w,
          height: rect.h,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          padding: 0,
        }}
        title="Chart settings"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <polygon
            points="8,1 13.66,4.25 13.66,11.75 8,15 2.34,11.75 2.34,4.25"
            stroke="var(--color-text-muted)"
            strokeWidth="1.3"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="8" cy="8" r="2.5" stroke="var(--color-text-muted)" strokeWidth="1.3" fill="none" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          style={{
            position: 'absolute',
            bottom: rect.b + rect.h + 1,
            right: rect.r,
            zIndex: 40,
            minWidth: 160,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            padding: '4px 0',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            animation: 'chartSettingsFadeIn 0.18s ease-out',
            transformOrigin: 'bottom right',
          }}
        >
          <button
            onClick={toggleInvert}
            className="hover:bg-(--color-border) transition-colors cursor-pointer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              color: 'var(--color-text)',
              fontSize: 12,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
              textAlign: 'left',
              whiteSpace: 'nowrap',
            }}
          >
            {/* Checkmark — fades + scales in/out */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              style={{
                opacity: inverted ? 1 : 0,
                transform: inverted ? 'scale(1)' : 'scale(0.5)',
                transition: 'opacity 0.15s, transform 0.15s',
                flexShrink: 0,
              }}
            >
              <path d="M2 6.5l2.5 2.5L10 3" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Invert scale</span>
          </button>
          {/* Divider */}
          <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
          {/* More settings */}
          <button
            onClick={() => { setOpen(false); setModalOpen(true); }}
            className="hover:bg-(--color-border) transition-colors cursor-pointer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              color: 'var(--color-text)',
              fontSize: 12,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
              textAlign: 'left',
              whiteSpace: 'nowrap',
            }}
          >
            {/* Gear icon */}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <polygon
                points="8,1 13.66,4.25 13.66,11.75 8,15 2.34,11.75 2.34,4.25"
                stroke="var(--color-text-muted)"
                strokeWidth="1.3"
                strokeLinejoin="round"
                fill="none"
              />
              <circle cx="8" cy="8" r="2.5" stroke="var(--color-text-muted)" strokeWidth="1.3" fill="none" />
            </svg>
            <span>Settings...</span>
          </button>
        </div>
      )}

      {modalOpen && <ChartSettingsModal onClose={() => setModalOpen(false)} />}

      <style>{`
        @keyframes chartSettingsFadeIn {
          from { opacity: 0; transform: translateY(6px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}
