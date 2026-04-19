import { useEffect, useRef, useState } from 'react';
import type { NodeMetrics, NodeState, HubConnectionState, ApiCategoryMetrics } from '../../services/monitor/types';
import { COLOR_BUY, COLOR_WARNING, COLOR_SELL, COLOR_BORDER } from '../../constants/colors';
import { FONT_SIZE, RADIUS } from '../../constants/layout';

interface Props {
  nodes: NodeMetrics[];
  marketOpen: boolean;
  apiCategories: ApiCategoryMetrics[];
  onHubClick?: (hubId: 'market-hub' | 'user-hub') => void;
}

const STATE_COLOR_CSS: Record<NodeState, string> = {
  normal:   'var(--color-buy)',
  degraded: 'var(--color-warning)',
  frozen:   'var(--color-sell)',
};

const STATE_COLOR_CANVAS: Record<NodeState, string> = {
  normal:   COLOR_BUY,
  degraded: COLOR_WARNING,
  frozen:   COLOR_SELL,
};

const HUB_STATE_LABEL: Record<HubConnectionState, string> = {
  connected:    'Connected',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
};

function formatLastSeen(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ParticleTrack({ state, marketOpen }: { state: NodeState; marketOpen: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const particlesRef = useRef<{ x: number }[]>([
    { x: 0 },
    { x: 0.38 },
    { x: 0.72 },
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const color = STATE_COLOR_CANVAS[state];
      const speed = !marketOpen ? 0 : state === 'normal' ? 0.8 : state === 'degraded' ? 0.25 : 0;

      ctx.strokeStyle = color;
      ctx.globalAlpha = state === 'frozen' ? 0.12 : 0.22;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (state === 'frozen') {
        ctx.strokeStyle = COLOR_BORDER;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      if (marketOpen) {
        for (const p of particlesRef.current) {
          p.x = (p.x + speed * 0.005) % 1;
          const px = p.x * w;
          ctx.beginPath();
          ctx.arc(px, h / 2, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.globalAlpha = state === 'frozen' ? 0.08 : 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current);
      } else {
        rafRef.current = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [state, marketOpen]);

  return (
    <canvas
      ref={canvasRef}
      width={100}
      height={20}
      style={{ display: 'block' }}
    />
  );
}

function NodeCard({ node, compact, onClick }: { node: NodeMetrics; compact?: boolean; onClick?: () => void }) {
  const stateColor = STATE_COLOR_CSS[node.state];
  const isHub = node.id === 'market-hub' || node.id === 'user-hub';
  const isChart = node.id === 'chart';
  const clickable = !!onClick;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderLeft: `3px solid ${stateColor}`,
        borderRadius: RADIUS.XL,
        padding: compact ? '10px 14px' : '12px 18px',
        minWidth: compact ? 148 : 170,
        cursor: clickable ? 'pointer' : 'default',
        transition: clickable ? 'background var(--transition-fast)' : undefined,
      }}
      className={clickable ? 'hover:bg-(--color-hover-row) active:opacity-75' : undefined}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: stateColor, fontSize: FONT_SIZE.XS, lineHeight: 1 }}>●</span>
        <span style={{ fontSize: FONT_SIZE.LG, fontWeight: 700, color: 'var(--color-text-bright)', flex: 1 }}>
          {node.label}
        </span>
      </div>

      {/* Hub nodes: connection state + sub-event rates */}
      {isHub && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <span style={{
              fontSize: FONT_SIZE.BASE,
              fontWeight: 600,
              color: node.hubState === 'connected'
                ? 'var(--color-buy)'
                : node.hubState === 'reconnecting'
                  ? 'var(--color-warning)'
                  : 'var(--color-sell)',
            }}>
              {node.hubState ? HUB_STATE_LABEL[node.hubState] : '—'}
            </span>
          </div>
          {node.tickRate > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-medium)' }}>events</span>
              <span style={{ fontSize: FONT_SIZE.BASE, fontWeight: 600, color: 'var(--color-text)' }}>
                {node.tickRate}/min
              </span>
            </div>
          )}
          {node.subRates && node.subRates.map((sr) => (
            sr.rate > 0 && (
              <div key={sr.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-medium)' }}>{sr.label.toLowerCase()}</span>
                <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-medium)' }}>{sr.rate}/min</span>
              </div>
            )
          ))}
          {node.lastTickAgo > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-medium)' }}>last</span>
              <span style={{ fontSize: FONT_SIZE.LG, fontWeight: 600, color: 'var(--color-text)' }}>{formatLastSeen(node.lastTickAgo)}</span>
            </div>
          )}
          {node.hubRttMs > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-medium)' }}>rtt</span>
              <span style={{ fontSize: FONT_SIZE.LG, fontWeight: 600, color: node.hubRttMs > 200 ? 'var(--color-warning)' : 'var(--color-text)' }}>
                {node.hubRttMs}ms
              </span>
            </div>
          )}
        </div>
      )}

      {/* Adapter node */}
      {node.id === 'adapter' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-medium)' }}>rate</span>
            <span style={{ fontSize: FONT_SIZE.LG, fontWeight: 600, color: 'var(--color-text)' }}>{node.tickRate} tck</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-medium)' }}>last</span>
            <span style={{ fontSize: FONT_SIZE.LG, fontWeight: 600, color: 'var(--color-text)' }}>{formatLastSeen(node.lastTickAgo)}</span>
          </div>
        </div>
      )}

      {/* Chart node */}
      {isChart && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-medium)' }}>RAF lag</span>
            <span style={{ fontSize: FONT_SIZE.LG, fontWeight: 600, color: 'var(--color-text)' }}>{node.rafLagMs}ms</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-medium)' }}>frm/min</span>
            <span style={{ fontSize: FONT_SIZE.LG, fontWeight: 600, color: 'var(--color-text)' }}>{node.tickRate}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function formatAgo(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 60_000) return `${ms < 1000 ? ms.toFixed(0) + 'ms' : (ms / 1000).toFixed(1) + 's'} ago`;
  return `${Math.floor(ms / 60_000)}m ago`;
}

const COL = { name: 260, calls: 50, last: 90, avg: 110, age: 80, status: 16 };

function latencyColor(ms: number): string {
  if (ms <= 0) return 'var(--color-text)';
  if (ms < 300) return 'var(--color-buy)';
  if (ms < 700) return 'var(--color-warning)';
  return 'var(--color-sell)';
}

function ApiSection({ categories }: { categories: ApiCategoryMetrics[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (name: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  if (categories.length === 0) {
    return <div style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-dim)' }}>No API calls yet</div>;
  }

  const colStyle = (w: number, align: 'left' | 'right' = 'right') => ({
    width: w, minWidth: w, maxWidth: w, textAlign: align, flexShrink: 0,
  });

  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: RADIUS.XL,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', background: 'var(--color-panel)' }}>
        <span style={{ ...colStyle(COL.name, 'left'), fontSize: FONT_SIZE.SM, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.08em' }}>ENDPOINT</span>
        <span style={{ ...colStyle(COL.calls), fontSize: FONT_SIZE.SM, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.08em' }}>CALLS</span>
        <span style={{ ...colStyle(COL.last), fontSize: FONT_SIZE.SM, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.08em' }}>LATENCY</span>
        <span style={{ ...colStyle(COL.avg), fontSize: FONT_SIZE.SM, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.08em' }}>AVG LATENCY</span>
        <span style={{ ...colStyle(COL.age), fontSize: FONT_SIZE.SM, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.08em' }}>CALLED</span>
        <span style={{ ...colStyle(COL.status) }}></span>
      </div>

      {categories.map((cat) => {
        const isOpen = expanded.has(cat.name);
        return (
          <div key={cat.name}>
            {/* Category row */}
            <button
              onClick={() => toggle(cat.name)}
              style={{ width: '100%', border: 'none', padding: '10px 16px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
              className="row-hover bg-(--color-surface) active:opacity-75"
            >
              <div style={{ ...colStyle(COL.name, 'left'), display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: FONT_SIZE.SM, color: 'var(--color-text-muted)', width: 10, flexShrink: 0 }}>{isOpen ? '▼' : '▶'}</span>
                <span style={{ fontSize: FONT_SIZE.BASE, fontWeight: 600, color: 'var(--color-text-bright)' }}>{cat.name}</span>
              </div>
              <span style={{ ...colStyle(COL.calls), fontSize: FONT_SIZE.BASE, color: 'var(--color-text)' }}>{cat.totalCalls}</span>
              <span style={{ ...colStyle(COL.last), fontSize: FONT_SIZE.BASE, color: 'var(--color-text)' }}>—</span>
              <span style={{ ...colStyle(COL.avg), fontSize: FONT_SIZE.BASE, color: latencyColor(cat.avgLatencyMs) }}>{cat.avgLatencyMs > 0 ? `${cat.avgLatencyMs}ms` : '—'}</span>
              <span style={{ ...colStyle(COL.age), fontSize: FONT_SIZE.BASE, color: 'var(--color-text-muted)' }}>—</span>
              <span style={{ ...colStyle(COL.status), fontSize: FONT_SIZE.SM, color: cat.lastOk ? 'var(--color-buy)' : 'var(--color-sell)' }}>●</span>
            </button>

            {/* Endpoint rows */}
            {isOpen && cat.endpoints.map((ep) => (
              <div key={`${ep.method}:${ep.path}`} className="bg-(--color-panel)" style={{ display: 'flex', alignItems: 'center', padding: '8px 16px' }}>
                <div style={{ ...colStyle(COL.name, 'left'), display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', paddingLeft: 16, borderLeft: '2px solid var(--color-border)' }}>
                  <span style={{ fontSize: FONT_SIZE.SM, fontWeight: 700, color: 'var(--color-text-muted)', width: 34, flexShrink: 0 }}>{ep.method}</span>
                  <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.path}</span>
                </div>
                <span style={{ ...colStyle(COL.calls), fontSize: FONT_SIZE.BASE, color: 'var(--color-text)' }}>{ep.callCount}</span>
                <span style={{ ...colStyle(COL.last), fontSize: FONT_SIZE.BASE, color: latencyColor(ep.lastLatencyMs) }}>
                  {ep.lastLatencyMs > 0 ? `${ep.lastLatencyMs}ms` : '—'}
                </span>
                <span style={{ ...colStyle(COL.avg), fontSize: FONT_SIZE.BASE, color: latencyColor(ep.avgLatencyMs) }}>
                  {ep.avgLatencyMs > 0 && ep.callCount > 1 ? `${ep.avgLatencyMs}ms` : '—'}
                </span>
                <span style={{ ...colStyle(COL.age), fontSize: FONT_SIZE.BASE, color: 'var(--color-text-muted)' }}>{formatAgo(ep.lastCallAgo)}</span>
                <span style={{ ...colStyle(COL.status), fontSize: FONT_SIZE.SM, color: ep.lastOk ? 'var(--color-buy)' : 'var(--color-sell)' }}>●</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function FlowDiagram({ nodes, marketOpen, apiCategories, onHubClick }: Props) {
  const marketHub = nodes.find((n) => n.id === 'market-hub');
  const userHub   = nodes.find((n) => n.id === 'user-hub');
  const adapter   = nodes.find((n) => n.id === 'adapter');
  const chart     = nodes.find((n) => n.id === 'chart');

  // Pipeline: Market Hub → Adapter → Chart
  const pipeline = [marketHub, adapter, chart].filter(Boolean) as NodeMetrics[];

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* LIVE DATA row label */}
      <div style={{ fontSize: FONT_SIZE.LG, fontWeight: 600, color: 'var(--color-text-bright)', letterSpacing: '0.06em' }}>
        LIVE DATA
      </div>

      {/* Market data pipeline */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0 }}>
        {pipeline.map((node, i) => (
          <div key={node.id} style={{ display: 'flex', alignItems: 'center' }}>
            <NodeCard
              node={node}
              onClick={node.id === 'market-hub' ? () => onHubClick?.('market-hub') : undefined}
            />
            {i < pipeline.length - 1 && (
              <div style={{ padding: '0 10px' }}>
                <ParticleTrack state={node.state} marketOpen={marketOpen} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* User Hub — standalone (not part of market data pipeline) */}
      {userHub && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <NodeCard node={userHub} compact onClick={() => onHubClick?.('user-hub')} />
          <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-muted)', marginLeft: 4 }}>
            orders · positions · trades
          </span>
        </div>
      )}

      {/* REST API */}
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 20 }}>
        <div style={{ fontSize: FONT_SIZE.LG, fontWeight: 600, color: 'var(--color-text-bright)', letterSpacing: '0.06em', marginBottom: 16 }}>
          REST API
        </div>
        <ApiSection categories={apiCategories} />
      </div>
    </div>
  );
}
