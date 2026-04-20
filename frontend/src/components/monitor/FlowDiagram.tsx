import { useEffect, useRef, useState } from 'react';
import type { NodeMetrics, NodeState, HubConnectionState, ApiCategoryMetrics } from '../../services/monitor/types';
import { metricCollector } from '../../services/monitor/metricCollector';
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

// ---------------------------------------------------------------------------
// ParticleTrack — animated dots flowing along a line
// ---------------------------------------------------------------------------

interface LeafBurst {
  t: number;        // progress 0→1
  arrived: boolean;
  price: string;
}

function ParticleTrack({
  state,
  marketOpen,
  triggerPulse = 0,
  pulsePrice = '',
  onPulseArrival,
}: {
  state: NodeState;
  marketOpen: boolean;
  triggerPulse?: number;
  pulsePrice?: string;
  onPulseArrival?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const particlesRef = useRef<{ x: number }[]>([{ x: 0 }, { x: 0.38 }, { x: 0.72 }]);
  const burstsRef = useRef<LeafBurst[]>([]);
  const lastPulseRef = useRef(triggerPulse);
  const onArrivalRef = useRef(onPulseArrival);

  useEffect(() => { onArrivalRef.current = onPulseArrival; }, [onPulseArrival]);

  useEffect(() => {
    if (triggerPulse !== lastPulseRef.current && pulsePrice) {
      lastPulseRef.current = triggerPulse;
      burstsRef.current.push({ t: 0, arrived: false, price: pulsePrice });
    }
  }, [triggerPulse, pulsePrice]);

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

      // Track line
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

      // Ambient dots
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

      // Thrown price text: ease-out x, parabolic arc y, decaying tilt
      const T_STEP = 0.022;
      const easeOut = (t: number) => t * (2 - t);
      const alive: LeafBurst[] = [];
      for (const b of burstsRef.current) {
        b.t += T_STEP;

        const progress = Math.min(b.t, 1);
        const xPos     = easeOut(progress);

        if (!b.arrived && xPos >= 0.85) {
          b.arrived = true;
          onArrivalRef.current?.();
        }

        if (b.t < 1.0) {
          alive.push(b);

          const arc      = -Math.sin(progress * Math.PI) * 7;        // gentle upward arc
          const rotation = 0.25 * (1 - progress) * (1 - progress);   // initial tilt, decays to 0
          const alpha    = progress < 0.07 ? progress / 0.07 : progress > 0.86 ? Math.max(0, (1 - progress) / 0.14) : 1;

          ctx.save();
          ctx.translate(xPos * w, h / 2 + arc);
          ctx.rotate(rotation);
          ctx.font = '600 10px monospace';
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 7;
          ctx.globalAlpha = alpha;
          const tw = ctx.measureText(b.price).width;
          ctx.fillText(b.price, -tw / 2, 3.5);
          ctx.restore();
          ctx.globalAlpha = 1;
        }
      }
      burstsRef.current = alive;

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(rafRef.current);
      else rafRef.current = requestAnimationFrame(draw);
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
      height={28}
      style={{ display: 'block' }}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared card shell — top accent + tint + glow
// ---------------------------------------------------------------------------

function cardShell(stateColor: string, minWidth: number, clickable: boolean) {
  return {
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    background: `linear-gradient(160deg, color-mix(in srgb, ${stateColor} 8%, var(--color-surface)) 0%, var(--color-surface) 60%)`,
    border: '1px solid var(--color-border)',
    borderTop: `2px solid ${stateColor}`,
    borderRadius: RADIUS.XL,
    boxShadow: `0 4px 20px color-mix(in srgb, ${stateColor} 12%, transparent)`,
    minWidth,
    cursor: clickable ? 'pointer' : 'default',
    transition: 'box-shadow var(--transition-fast), background var(--transition-fast)',
    overflow: 'hidden',
  };
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 14 }}>
      <span style={{ fontSize: FONT_SIZE.XS, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.08em' }}>
        {label}
      </span>
      <span style={{ fontSize: FONT_SIZE.MD, fontWeight: 700, color: valueColor ?? 'var(--color-text-bright)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HubSourceCard
// ---------------------------------------------------------------------------

function HubSourceCard({ node, onClick }: { node: NodeMetrics; onClick?: () => void }) {
  const stateColor = STATE_COLOR_CSS[node.state];
  const clickable = !!onClick;
  const hubColor = node.hubState === 'connected'
    ? 'var(--color-buy)'
    : node.hubState === 'reconnecting'
      ? 'var(--color-warning)'
      : 'var(--color-sell)';

  return (
    <div
      onClick={onClick}
      style={cardShell(stateColor, 156, clickable)}
      className={clickable ? 'hover:brightness-110 active:opacity-75' : undefined}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 8px' }}>
        <span style={{ color: stateColor, fontSize: 8, lineHeight: 1 }}>◆</span>
        <span style={{ fontSize: FONT_SIZE.SM, fontWeight: 700, color: 'var(--color-text-bright)', letterSpacing: '0.1em' }}>
          {node.label.toUpperCase()}
        </span>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--color-border)', margin: '0 14px' }} />

      {/* Metrics */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 14px 12px' }}>
        <span style={{ fontSize: FONT_SIZE.MD, fontWeight: 700, color: hubColor }}>
          {node.hubState ? HUB_STATE_LABEL[node.hubState] : '—'}
        </span>
        <Row label="RTT" value={node.hubRttMs > 0 ? `${node.hubRttMs}ms` : '—'} valueColor={node.hubRttMs > 200 ? 'var(--color-warning)' : 'var(--color-text-bright)'} />
        <Row label="LAST" value={formatLastSeen(node.lastTickAgo)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeCard — Adapter / Chart
// ---------------------------------------------------------------------------

function NodeCard({ node }: { node: NodeMetrics }) {
  const stateColor = STATE_COLOR_CSS[node.state];
  const isChart = node.id === 'chart';

  return (
    <div style={cardShell(stateColor, 148, false)}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 8px' }}>
        <span style={{ color: stateColor, fontSize: 8, lineHeight: 1 }}>◆</span>
        <span style={{ fontSize: FONT_SIZE.SM, fontWeight: 700, color: 'var(--color-text-bright)', letterSpacing: '0.1em' }}>
          {node.label.toUpperCase()}
        </span>
      </div>

      <div style={{ height: 1, background: 'var(--color-border)', margin: '0 14px' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 14px 12px' }}>
        {node.id === 'adapter' && (
          <>
            <Row label="RATE" value={node.tickRate > 0 ? `${node.tickRate}/m` : node.lastTickAgo > 0 && node.lastTickAgo < 2000 ? '<1/m' : '0/m'} />
            <Row label="LAST" value={formatLastSeen(node.lastTickAgo)} />
          </>
        )}
        {isChart && (
          <>
            <Row label="RAF LAG" value={`${node.rafLagMs}ms`} valueColor={node.rafLagMs > 50 ? 'var(--color-warning)' : 'var(--color-text-bright)'} />
            <Row label="FRM/MIN" value={`${node.tickRate}`} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubLane — one subscription channel row (label + rate + track/line + destination)
// ---------------------------------------------------------------------------

const LANE_LABEL_W = 136;

function SubLane({
  label,
  rate,
  state,
  marketOpen,
  noTrack = false,
  triggerPulse,
  pulsePrice,
  onPulseArrival,
  children,
}: {
  label: string;
  rate: number;
  state: NodeState;
  marketOpen: boolean;
  noTrack?: boolean;
  triggerPulse?: number;
  pulsePrice?: string;
  onPulseArrival?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {/* Fixed-width label + rate so all lanes align */}
      <div style={{ width: LANE_LABEL_W, display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 10 }}>
        <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text)' }}>
          {label}
        </span>
        <span style={{
          fontSize: FONT_SIZE.BASE,
          fontWeight: 600,
          color: 'var(--color-text-bright)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {rate > 0 ? `${rate}/s` : '—'}
        </span>
      </div>

      {/* Track: animated particles or static dashed line */}
      {noTrack ? (
        <div style={{ width: 100, height: 20, display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, borderTop: '1px dashed var(--color-border)' }} />
        </div>
      ) : (
        <ParticleTrack
          state={state}
          marketOpen={marketOpen}
          triggerPulse={triggerPulse}
          pulsePrice={pulsePrice}
          onPulseArrival={onPulseArrival}
        />
      )}

      {/* Arrow */}
      <span style={{ fontSize: 11, color: 'var(--color-text)', padding: '0 6px', lineHeight: 1 }}>→</span>

      {/* Destination */}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DestLabel — simple pill for lanes without a full node card
// ---------------------------------------------------------------------------

function DestLabel({ text }: { text: string }) {
  return (
    <div style={{
      padding: '4px 10px',
      border: '1px solid var(--color-border)',
      borderRadius: RADIUS.LG,
      fontSize: FONT_SIZE.BASE,
      color: 'var(--color-text)',
    }}>
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DestCard — destination card with icon (for Book / FRVP)
// ---------------------------------------------------------------------------

function BookIcon() {
  return (
    <svg viewBox="0 0 28 28" width="16" height="16" fill="currentColor">
      <rect x="4"  y="7"  width="9"  height="2" rx="0.5" />
      <rect x="4"  y="12" width="13" height="2" rx="0.5" />
      <rect x="4"  y="17" width="6"  height="2" rx="0.5" />
      <rect x="15" y="7"  width="9"  height="2" rx="0.5" />
      <rect x="15" y="12" width="5"  height="2" rx="0.5" />
      <rect x="15" y="17" width="8"  height="2" rx="0.5" />
      <rect x="13.5" y="5" width="1" height="16" opacity="0.25" />
    </svg>
  );
}

function FRVPIconSmall() {
  return (
    <svg viewBox="0 0 28 28" width="16" height="16" fill="none">
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M5 21.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM3.5 24a2.5 2.5 0 0 0 .5-4.95V3H3v16.05A2.5 2.5 0 0 0 3.5 24zM25 5.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0zM23.5 3a2.5 2.5 0 0 1 .5 4.95V24h-1V7.95A2.5 2.5 0 0 1 23.5 3z" />
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M9 7H4v2h5V7zM3 6v4h7V6H3z" />
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M12 10H4v2h8v-2zM3 9v4h10V9H3z" />
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M7 13H4v2h3v-2zm-4-1v4h5v-4H3z" />
    </svg>
  );
}

function DestCard({ label, icon, state }: { label: string; icon: React.ReactNode; state: NodeState }) {
  const stateColor = STATE_COLOR_CSS[state];
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderLeft: `3px solid ${stateColor}`,
      borderRadius: RADIUS.XL,
      minWidth: 88,
    }}>
      {icon}
      <span style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text-bright)', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HubSection — hub source card + fan-out lanes
// ---------------------------------------------------------------------------

function HubSection({
  hub,
  onClick,
  children,
}: {
  hub: NodeMetrics;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <HubSourceCard node={hub} onClick={onClick} />
      {/* horizontal connector to branch bar */}
      <div style={{ width: 12, height: 1, background: 'var(--color-border)', flexShrink: 0 }} />
      {/* vertical bar + lanes */}
      <div style={{
        borderLeft: '1px solid var(--color-border)',
        paddingLeft: 18,
        paddingTop: 6,
        paddingBottom: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApiSection — REST endpoint table
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// FlowDiagram — main export
// ---------------------------------------------------------------------------

function getSubRate(node: NodeMetrics | undefined, label: string): number {
  return node?.subRates?.find((r) => r.label === label)?.rate ?? 0;
}

export function FlowDiagram({ nodes, marketOpen, apiCategories, onHubClick }: Props) {
  const marketHub = nodes.find((n) => n.id === 'market-hub');
  const userHub   = nodes.find((n) => n.id === 'user-hub');
  const adapter   = nodes.find((n) => n.id === 'adapter');
  const chart     = nodes.find((n) => n.id === 'chart');

  // Leaf burst: real quote ticks throttled to ~1 per 350ms
  const [seg1Pulse, setSeg1Pulse] = useState(0);
  const [seg2Pulse, setSeg2Pulse] = useState(0);
  const [pulsePrice, setPulsePrice] = useState('');

  useEffect(() => {
    const handler = (price: number) => {
      setPulsePrice(price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      setSeg1Pulse((p) => p + 1);
    };
    metricCollector.onTickPulse(handler);
    return () => metricCollector.offTickPulse(handler);
  }, []);

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div style={{ fontSize: FONT_SIZE.LG, fontWeight: 600, color: 'var(--color-text-bright)', letterSpacing: '0.06em' }}>
        LIVE DATA
      </div>

      {/* Market Hub — 3 subscription lanes fanning out to their consumers */}
      {marketHub && (
        <HubSection hub={marketHub} onClick={() => onHubClick?.('market-hub')}>
          {/* quotes → Adapter → Chart (full pipeline with particle tracks) */}
          <SubLane
            label="quotes"
            rate={getSubRate(marketHub, 'Quotes')}
            state={marketHub.state}
            marketOpen={marketOpen}
            triggerPulse={seg1Pulse}
            pulsePrice={pulsePrice}
            onPulseArrival={() => setSeg2Pulse((p) => p + 1)}
          >
            {adapter && (
              <>
                <NodeCard node={adapter} />
                <div style={{ padding: '0 4px' }}>
                  <ParticleTrack
                    state={adapter.state}
                    marketOpen={marketOpen}
                    triggerPulse={seg2Pulse}
                    pulsePrice={pulsePrice}
                  />
                </div>
                <span style={{ fontSize: 11, color: 'var(--color-text)', padding: '0 6px', lineHeight: 1 }}>→</span>
              </>
            )}
            {chart && <NodeCard node={chart} />}
          </SubLane>

          {/* depth → Book (dim — not piped through adapter) */}
          <SubLane
            label="depth"
            rate={getSubRate(marketHub, 'Depth')}
            state={marketHub.state}
            marketOpen={marketOpen}

          >
            <DestCard label="Book" icon={<BookIcon />} state={marketHub.state} />
          </SubLane>

          {/* trades → FRVP (dim — not piped through adapter) */}
          <SubLane
            label="trades"
            rate={getSubRate(marketHub, 'Trades')}
            state={marketHub.state}
            marketOpen={marketOpen}

          >
            <DestCard label="FRVP" icon={<FRVPIconSmall />} state={marketHub.state} />
          </SubLane>
        </HubSection>
      )}

      {/* User Hub — event-driven lanes (no particle track, dashed line) */}
      {userHub && (
        <HubSection hub={userHub} onClick={() => onHubClick?.('user-hub')}>
          <SubLane
            label="orders"
            rate={getSubRate(userHub, 'Orders')}
            state={userHub.state}
            marketOpen={marketOpen}
            noTrack
          >
            <DestLabel text="Orders" />
          </SubLane>
          <SubLane
            label="positions"
            rate={getSubRate(userHub, 'Positions')}
            state={userHub.state}
            marketOpen={marketOpen}
            noTrack
          >
            <DestLabel text="Positions" />
          </SubLane>
          <SubLane
            label="trades"
            rate={getSubRate(userHub, 'Trades')}
            state={userHub.state}
            marketOpen={marketOpen}
            noTrack
          >
            <DestLabel text="Fills" />
          </SubLane>
        </HubSection>
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
