import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { metricCollector } from '../../services/monitor/metricCollector';
import { useMarketStatus } from '../../utils/marketHours';
import { FlowDiagram } from './FlowDiagram';
import { IncidentLog } from './IncidentLog';
import { ReportView } from './ReportView';
import { ConsolePanel } from './ConsolePanel';
import { Z, FONT_SIZE, RADIUS } from '../../constants/layout';

interface Props {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

function useMonitorSnapshot() {
  return useSyncExternalStore(
    (cb) => metricCollector.subscribe(cb),
    () => metricCollector.getSnapshot(),
  );
}

export function MonitorPanel({ anchorRef: _anchorRef, onClose }: Props) {
  const snapshot = useMonitorSnapshot();
  const backdropRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const { open: marketOpen, reopenLabel } = useMarketStatus('futures');

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 220);
  }

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const sessionDurationMin = Math.floor((Date.now() - snapshot.sessionStartTime) / 60_000);

  return (
    <>
      {/* Backdrop */}
      <div
        ref={backdropRef}
        className="fixed inset-0"
        style={{
          zIndex: Z.MODAL,
          background: visible ? 'var(--color-backdrop)' : 'transparent',
          transition: `background var(--transition-slow)`,
        }}
        onClick={(e) => { if (e.target === backdropRef.current) handleClose(); }}
      >
        {/* Panel — slides up from bottom like Stats */}
        <div
          className="absolute left-0 right-0 bottom-0 overflow-y-auto"
          style={{
            top: visible ? '4%' : '100%',
            opacity: visible ? 1 : 0,
            background: 'var(--color-popover)',
            borderTop: '1px solid var(--color-border)',
            borderRadius: '14px 14px 0 0',
            transition: `top 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity var(--transition-normal)`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Sticky Header */}
          <div
            className="sticky top-0 flex items-center justify-between"
            style={{
              padding: '16px 28px 14px',
              background: 'var(--color-popover)',
              borderBottom: '1px solid var(--color-border)',
              zIndex: 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: FONT_SIZE.LG, fontWeight: 600, color: 'var(--color-text-bright)' }}>
                System Monitor
              </span>
              <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-muted)' }}>
                {sessionDurationMin}min session
              </span>
              {/* Market status badge */}
              <span style={{
                fontSize: FONT_SIZE.SM,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: RADIUS.PILL,
                background: marketOpen ? 'var(--color-buy-tint)' : 'var(--color-sell-tint)',
                color: marketOpen ? 'var(--color-buy)' : 'var(--color-sell)',
                border: `1px solid ${marketOpen ? 'var(--color-buy)' : 'var(--color-sell)'}`,
              }}>
                {marketOpen ? 'Market open' : 'Market closed'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => setShowConsole(v => !v)}
                style={{
                  background: showConsole ? 'var(--color-surface)' : 'none',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  color: showConsole ? 'var(--color-text-bright)' : 'var(--color-text-muted)',
                  fontSize: FONT_SIZE.BASE,
                  padding: '5px 12px',
                  cursor: 'pointer',
                  transition: 'border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast)',
                }}
                className="hover:text-(--color-text) hover:bg-(--color-hover-row) active:opacity-75"
              >
                Console
              </button>
              <button
                onClick={() => setShowReport(true)}
                style={{
                  background: 'none',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  color: 'var(--color-text-muted)',
                  fontSize: FONT_SIZE.BASE,
                  padding: '5px 12px',
                  cursor: 'pointer',
                  transition: 'border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast)',
                }}
                className="hover:text-(--color-text) hover:bg-(--color-hover-row) active:opacity-75"
              >
                Reports
              </button>
              <button
                onClick={handleClose}
                className="transition-colors cursor-pointer text-(--color-text-dim) hover:text-(--color-text-bright) active:opacity-75"
                style={{
                  fontSize: FONT_SIZE.XXL,
                  lineHeight: 1,
                  padding: '2px 6px',
                  borderRadius: RADIUS.LG,
                  border: 'none',
                  background: 'transparent',
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Market-closed notice */}
          {!marketOpen && (
            <div style={{
              padding: '10px 28px',
              background: 'var(--color-sell-subtle)',
              borderBottom: '1px solid var(--color-border)',
              fontSize: FONT_SIZE.MD,
              color: 'var(--color-text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{ color: 'var(--color-sell)' }}>○</span>
              No ticks expected — market is closed. Incidents suppressed until market reopens.
              {reopenLabel && (
                <span style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}>
                  Opens {reopenLabel}.
                </span>
              )}
            </div>
          )}

          {/* Content */}
          <div style={{ padding: '24px 28px 48px', maxWidth: 1280, margin: '0 auto' }}>
            <FlowDiagram nodes={snapshot.nodes} marketOpen={marketOpen} apiCategories={snapshot.apiCategories} />

            {/* Console */}
            {showConsole && (
              <div style={{ marginTop: 20 }}>
                <ConsolePanel onClose={() => setShowConsole(false)} />
              </div>
            )}

            {/* Incident log */}
            <IncidentLog
              incidents={snapshot.incidents}
              sessionStartTime={snapshot.sessionStartTime}
            />

            {/* Diagnosis hint (market open + degraded/frozen only) */}
            {marketOpen && snapshot.worstState !== 'normal' && (
              <div style={{
                marginTop: 16,
                padding: '10px 14px',
                background: 'var(--color-surface)',
                borderRadius: RADIUS.XL,
                fontSize: FONT_SIZE.BASE,
                color: 'var(--color-text-muted)',
                borderLeft: '2px solid var(--color-warning)',
              }}>
                {diagnosisHint(snapshot.nodes)}
              </div>
            )}
          </div>
        </div>
      </div>

      {showReport && <ReportView onClose={() => setShowReport(false)} />}
    </>
  );
}

function diagnosisHint(nodes: ReturnType<typeof metricCollector.getSnapshot>['nodes']): string {
  const marketHub = nodes.find((n) => n.id === 'market-hub');
  const userHub   = nodes.find((n) => n.id === 'user-hub');
  const adapter   = nodes.find((n) => n.id === 'adapter');
  const chart     = nodes.find((n) => n.id === 'chart');

  if (marketHub?.state === 'frozen') return 'Market Hub disconnected → no market data. Check connectivity or server.';
  if (userHub?.state === 'frozen')   return 'User Hub disconnected → orders and positions not updating.';
  if (marketHub?.state === 'degraded') return 'Market Hub reconnecting → market data may be delayed.';
  if (userHub?.state === 'degraded')   return 'User Hub reconnecting → order/position updates may be delayed.';
  if (adapter?.state === 'frozen') return 'Adapter frozen → frontend dropped ticks. Check main thread load.';
  if (chart?.state === 'degraded' && adapter?.state === 'normal') {
    return `RAF lag elevated (${chart.rafLagMs}ms) → main thread blocked. Chart rendering may stutter.`;
  }
  if (adapter?.state === 'degraded') return 'Tick rate dropped at adapter → frontend processing falling behind.';
  return 'Degraded state detected. Watch for recovery.';
}
