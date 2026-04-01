import { useState, useRef, useCallback } from 'react';
import type { Contract } from '../../services/marketDataService';
import { useMarketStatus, type MarketType } from '../../utils/marketHours';
import { useClickOutside } from '../../hooks/useClickOutside';
import { RADIUS, Z } from '../../constants/layout';

const INNER_DOT = 8;
const OUTER_DOT = 11;

const pulseKeyframes = `
@keyframes dotPulse {
  0%, 100% { opacity: 0.25; }
  50%      { opacity: 0.6; }
}`;

// Inject keyframes once
if (typeof document !== 'undefined' && !document.getElementById('dot-pulse-style')) {
  const style = document.createElement('style');
  style.id = 'dot-pulse-style';
  style.textContent = pulseKeyframes;
  document.head.appendChild(style);
}

export function MarketStatusBadge({ contract }: { contract: Contract }) {
  const marketType = (contract.marketType ?? 'futures') as MarketType;

  // Hide for 24/7 markets — always open, badge is noise
  if (marketType === 'crypto') return null;

  const { open, reopenLabel, closeLabel, session } = useMarketStatus(marketType);
  const [showTip, setShowTip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useCallback(() => setShowTip(false), []);
  useClickOutside(ref, showTip, onClose);

  const dotColor = open ? 'var(--color-buy)' : 'var(--color-sell)';
  const barColor = open ? 'var(--color-buy)' : 'var(--color-sell)';

  return (
    <div ref={ref} className="relative pointer-events-auto shrink-0">
      {/* Dot trigger */}
      <button
        type="button"
        onClick={() => setShowTip((v) => !v)}
        className="flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80"
        style={{ width: OUTER_DOT + 8, height: OUTER_DOT + 8, position: 'relative' }}
      >
        {/* Outer ring — fades in/out when open */}
        {open && (
          <span
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: OUTER_DOT,
              height: OUTER_DOT,
              borderRadius: RADIUS.CIRCLE,
              background: dotColor,
              animation: 'dotPulse 2s ease-in-out infinite',
            }}
          />
        )}
        {/* Inner solid dot */}
        <span
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: INNER_DOT,
            height: INNER_DOT,
            borderRadius: RADIUS.CIRCLE,
            background: dotColor,
          }}
        />
      </button>

      {/* Tooltip popover */}
      {showTip && (
        <div
          className="absolute left-0 top-full select-none text-[11px]"
          style={{
            marginTop: 4,
            width: 230,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: RADIUS.MD,
            padding: '10px 12px',
            zIndex: Z.DROPDOWN,
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-1.5" style={{ marginBottom: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 7,
                height: 7,
                borderRadius: RADIUS.CIRCLE,
                background: dotColor,
                flexShrink: 0,
              }}
            />
            <span
              className="font-semibold"
              style={{ color: open ? 'var(--color-buy)' : 'var(--color-sell)' }}
            >
              {open ? 'Market open' : 'Market closed'}
            </span>
          </div>

          {/* Description */}
          <p className="text-(--color-text-muted) leading-snug" style={{ margin: '0 0 8px' }}>
            {open
              ? <>Market is open. {session.countdown}</>
              : <>Market is closed. {session.countdown}</>}
          </p>

          {/* Progress bar */}
          <div style={{ marginBottom: 4 }}>
            <div className="flex items-center gap-1.5 text-(--color-text-muted)">
              <span className="font-medium" style={{ minWidth: 28 }}>{session.dayLabel}</span>
              <div
                className="flex-1"
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: 'var(--color-border)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.round(session.progress * 100)}%`,
                    height: '100%',
                    borderRadius: 2,
                    background: barColor,
                    transition: 'width 1s linear',
                  }}
                />
              </div>
            </div>
            <div
              className="flex justify-between text-(--color-text-muted)"
              style={{ marginTop: 2, paddingLeft: 34 }}
            >
              <span>{session.startLabel}</span>
              <span>{session.endLabel}</span>
            </div>
          </div>

          {/* Timezone footer */}
          <div
            className="text-(--color-text-muted)"
            style={{ borderTop: '1px solid var(--color-border)', paddingTop: 6, marginTop: 4 }}
          >
            Exchange timezone: ET (New York)
          </div>
        </div>
      )}
    </div>
  );
}
