import { useState } from 'react';
import type { Incident } from '../../services/monitor/types';
import { FONT_SIZE, RADIUS } from '../../constants/layout';

interface Props {
  incidents: Incident[];
  sessionStartTime: number;
}

function timeStr(wallMs: number): string {
  return new Date(wallMs).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function duration(inc: Incident): string {
  if (!inc.endTime) return 'ongoing';
  return ((inc.endTime - inc.startTime) / 1000).toFixed(1) + 's';
}

export function IncidentLog({ incidents, sessionStartTime }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Convert performance.now() offsets to wall clock
  const perfNow = performance.now();
  const wallOffset = Date.now() - perfNow;

  if (incidents.length === 0) {
    return (
      <div style={{ padding: '20px 0', borderTop: '1px solid var(--color-border)', marginTop: 8 }}>
        <div style={{ fontSize: FONT_SIZE.SM, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.08em', marginBottom: 10 }}>
          INCIDENTS
        </div>
        <div style={{ fontSize: FONT_SIZE.MD, color: 'var(--color-text-muted)' }}>No incidents this session</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 0', borderTop: '1px solid var(--color-border)', marginTop: 8 }}>
      <div style={{ fontSize: FONT_SIZE.SM, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.08em', marginBottom: 10 }}>
        INCIDENTS ({incidents.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {incidents.map((inc) => {
          const isOpen = expanded.has(inc.id);
          const color = inc.type === 'freeze' ? 'var(--color-sell)' : 'var(--color-warning)';
          const icon = inc.type === 'freeze' ? '✗' : '⚠';
          const startWall = wallOffset + inc.startTime;
          const dur = duration(inc);

          return (
            <div key={inc.id} style={{
              borderRadius: RADIUS.XL,
              overflow: 'hidden',
              border: '1px solid var(--color-border)',
            }}>
              <button
                onClick={() => toggle(inc.id)}
                style={{
                  width: '100%',
                  background: 'var(--color-surface)',
                  border: 'none',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background var(--transition-fast)',
                }}
                className="hover:bg-(--color-hover-row) active:opacity-75"
              >
                <span style={{ color: 'var(--color-text-muted)', fontSize: FONT_SIZE.SM }}>
                  {isOpen ? '▼' : '▶'}
                </span>
                <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-muted)' }}>
                  {timeStr(startWall)}
                </span>
                <span style={{ color, fontSize: FONT_SIZE.BASE, fontWeight: 600 }}>
                  {icon} {inc.type === 'freeze' ? 'FREEZE' : 'LAG'}
                </span>
                <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text)' }}>
                  {dur}
                </span>
                <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                  [{inc.nodeId}]
                </span>
              </button>
              <div style={{
                maxHeight: isOpen ? 200 : 0,
                overflow: 'hidden',
                transition: 'max-height var(--transition-slow)',
              }}>
                <div style={{
                  padding: '10px 14px',
                  background: 'var(--color-panel)',
                  fontSize: FONT_SIZE.BASE,
                  color: 'var(--color-text-muted)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  fontFamily: 'var(--font-family)',
                }}>
                  <div><span style={{ color: 'var(--color-text-dim)' }}>trigger</span>  {inc.trigger}</div>
                  {inc.worstLagMs > 0 && (
                    <div><span style={{ color: 'var(--color-text-dim)' }}>worst  </span>  RAF lag {inc.worstLagMs.toFixed(0)}ms</div>
                  )}
                  <div><span style={{ color: 'var(--color-text-dim)' }}>prices </span>  prices_{new Date(sessionStartTime).toISOString().slice(0, 10)}.bin@offset={inc.priceOffset}</div>
                  {!inc.endTime && (
                    <div style={{ color }}> still active</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
