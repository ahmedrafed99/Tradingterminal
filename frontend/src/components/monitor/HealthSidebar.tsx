import type { NodeMetrics, NodeState, HubConnectionState } from '../../services/monitor/types';
import { FONT_SIZE, RADIUS } from '../../constants/layout';

interface Props {
  nodes: NodeMetrics[];
}

const STATE_COLOR: Record<NodeState, string> = {
  normal:   'var(--color-buy)',
  degraded: 'var(--color-warning)',
  frozen:   'var(--color-sell)',
};

const STATE_LABEL: Record<NodeState, string> = {
  normal:   'Normal',
  degraded: 'Degraded',
  frozen:   'Frozen',
};

const HUB_COLOR: Record<HubConnectionState, string> = {
  connected:    'var(--color-buy)',
  reconnecting: 'var(--color-warning)',
  disconnected: 'var(--color-sell)',
};

function RateBar({ current, baseline }: { current: number; baseline: number }) {
  const pct = baseline > 0 ? Math.min(100, (current / baseline) * 100) : 0;
  const color = pct >= 80 ? 'var(--color-buy)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-sell)';
  return (
    <div style={{
      width: '100%',
      height: 3,
      background: 'var(--color-border)',
      borderRadius: RADIUS.SM,
      overflow: 'hidden',
    }}>
      <div style={{
        width: `${pct}%`,
        height: '100%',
        background: color,
        transition: 'width 0.5s ease, background 0.3s',
        borderRadius: RADIUS.SM,
      }} />
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export function HealthSidebar({ nodes }: Props) {
  return (
    <div style={{
      borderLeft: '1px solid var(--color-border)',
      padding: '16px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      minWidth: 260,
      maxWidth: 320,
    }}>
      {/* NODE HEALTH */}
      <div style={{ fontSize: FONT_SIZE.SM, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.08em' }}>
        NODE HEALTH
      </div>

      {nodes.map((node) => {
        const isHub = node.id === 'market-hub' || node.id === 'user-hub';
        return (
          <div key={node.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: FONT_SIZE.LG, fontWeight: 600, color: 'var(--color-text-bright)' }}>
                {node.label}
              </span>
              <span style={{ fontSize: FONT_SIZE.BASE, fontWeight: 600, color: STATE_COLOR[node.state] }}>
                {STATE_LABEL[node.state]}
              </span>
            </div>

            <div style={{ fontSize: FONT_SIZE.BASE, color: 'var(--color-text)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {isHub ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Connection</span>
                    <span style={{ color: node.hubState ? HUB_COLOR[node.hubState] : 'var(--color-text-dim)' }}>
                      {node.hubState ?? '—'}
                    </span>
                  </div>
                  {node.tickRate > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Events</span>
                      <span>{node.tickRate}/min</span>
                    </div>
                  )}
                  {node.subRates?.map((sr) => sr.rate > 0 && (
                    <div key={sr.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ paddingLeft: 8 }}>{sr.label}</span>
                      <span style={{ color: 'var(--color-text-dim)' }}>{sr.rate}/min</span>
                    </div>
                  ))}
                  {node.lastTickAgo > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Last event</span>
                      <span>{formatMs(node.lastTickAgo)}</span>
                    </div>
                  )}
                </>
              ) : node.id === 'chart' ? (
                <>
                  <div>RAF lag: {node.rafLagMs}ms</div>
                  <div>Frames: {node.tickRate}/min</div>
                </>
              ) : (
                <>
                  <div>Last: {formatMs(node.lastTickAgo)}</div>
                  <div>
                    Rate: {node.tickRate}/min
                    {node.baselineRate > 0 && (
                      <span style={{ color: 'var(--color-text-dim)', marginLeft: 4 }}>
                        (baseline {node.baselineRate})
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Rate bar for adapter only */}
            {node.id === 'adapter' && (
              <RateBar current={node.tickRate} baseline={node.baselineRate || node.tickRate} />
            )}
          </div>
        );
      })}

    </div>
  );
}
