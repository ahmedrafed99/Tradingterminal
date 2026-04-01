import { useState, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';
import { orderService } from '../../services/orderService';
import { bracketEngine } from '../../services/bracketEngine';
import { OrderType, OrderSide, PositionType } from '../../types/enums';
import { markAsManualClose } from '../../services/manualCloseTracker';
import { showToast, errorMessage } from '../../utils/toast';
import { calcPnl, roundToTick } from '../../utils/instrument';
import { formatPrice, getPnlColorClass } from '../../utils/formatters';

export function PositionDisplay() {
  const { positions, orderContract, lastPrice, activeAccountId } = useStore(useShallow((s) => ({
    positions: s.positions,
    orderContract: s.orderContract,
    lastPrice: s.lastPrice,
    activeAccountId: s.activeAccountId,
  })));
  const pnlRef = useRef<number>(0);

  const pos = orderContract ? positions.find((p) => p.accountId === activeAccountId && String(p.contractId) === String(orderContract.id)) : undefined;
  const hasPos = pos != null && pos.size !== 0;

  if (!orderContract || !hasPos) {
    return (
      <div className="border-t border-(--color-border) mt-2 pt-3">
        <div className={`${SECTION_LABEL} mb-1 text-center`}>Position</div>
        <div className="text-xs text-(--color-text-dim) text-center">No position</div>
      </div>
    );
  }

  const isLong = pos.type === PositionType.Long;
  const sign = isLong ? '+' : '-';

  if (lastPrice != null) {
    const priceDiff = isLong
      ? lastPrice - pos.averagePrice
      : pos.averagePrice - lastPrice;
    pnlRef.current = calcPnl(priceDiff, orderContract, pos.size);
  }
  const pnl = pnlRef.current;

  const inProfit = pnl > 0;

  const pnlColor = pnl > 0 ? 'var(--color-buy)' : pnl < 0 ? 'var(--color-sell)' : 'var(--color-text-muted)';
  const dirColor = isLong ? 'var(--color-buy)' : 'var(--color-sell)';
  // Subtle tinted glow behind P&L
  const pnlBg = pnl > 0
    ? 'color-mix(in srgb, var(--color-buy) 8%, transparent)'
    : pnl < 0 ? 'color-mix(in srgb, var(--color-sell) 8%, transparent)' : 'transparent';

  return (
    <div className="border-t border-(--color-border) mt-2" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 16 }}>
      <div className={`${SECTION_LABEL} text-center`}>Position</div>
      {/* Position card — left accent bar indicates direction */}
      <div
        className="rounded overflow-hidden"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderLeftWidth: 3,
          borderLeftColor: dirColor,
        }}
      >
        {/* Top section: direction badge + size + entry */}
        <div style={{ padding: '10px 12px 8px' }}>
          <div className="flex items-center justify-center">
            <div className="flex items-center" style={{ gap: 6 }}>
              <span
                className="rounded text-[9px] font-bold uppercase"
                style={{
                  background: isLong ? dirColor : 'var(--color-btn-sell)',
                  color: 'var(--color-text-bright)',
                  padding: '1px 5px',
                  letterSpacing: '0.04em',
                }}
              >
                {isLong ? 'Long' : 'Short'}
              </span>
              <span className="text-xs font-semibold text-(--color-text)">
                {sign}{pos.size} @ {formatPrice(pos.averagePrice)}
              </span>
            </div>
          </div>
        </div>

        {/* P&L section — hero element */}
        <div
          className="transition-colors"
          style={{ background: pnlBg, padding: '8px 12px', textAlign: 'center' }}
        >
          <div
            className="font-bold tabular-nums"
            style={{ color: pnlColor, fontSize: 18, lineHeight: 1.1, letterSpacing: '-0.02em' }}
          >
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} $
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5">
        <MoveToBEButton
          accountId={activeAccountId}
          contractId={orderContract.id}
          positionSide={isLong ? 'long' : 'short'}
          size={pos.size}
          entryPrice={pos.averagePrice}
          tickSize={orderContract.tickSize}
          disabled={!inProfit}
        />
        <ClosePositionButton
          accountId={activeAccountId}
          contractId={orderContract.id}
          side={isLong ? OrderSide.Sell : OrderSide.Buy}
          size={pos.size}
        />
      </div>
    </div>
  );
}

function MoveToBEButton({
  accountId,
  contractId,
  positionSide,
  size,
  entryPrice,
  tickSize,
  disabled,
}: {
  accountId: string | null;
  contractId: string;
  positionSide: 'long' | 'short';
  size: number;
  entryPrice: number;
  tickSize: number;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const openOrders = useStore((s) => s.openOrders);

  async function handleClick() {
    if (!accountId) return;
    setBusy(true);
    try {
      // If bracket engine has an active session with an SL, use it
      if (bracketEngine.hasActiveSession()) {
        await bracketEngine.moveSLToBreakeven();
        return;
      }

      // Naked position: find existing SL order for this contract to modify, or place a new one
      const existingSL = openOrders.find(
        (o) =>
          String(o.contractId) === String(contractId) &&
          (o.type === OrderType.Stop || o.type === OrderType.TrailingStop),
      );

      const bePrice = roundToTick(entryPrice, tickSize);
      if (existingSL) {
        await orderService.modifyOrder({
          accountId,
          orderId: existingSL.id,
          stopPrice: bePrice,
        });
      } else {
        // Place a new stop order at breakeven — SL side is opposite of position
        await orderService.placeOrder({
          accountId,
          contractId,
          type: OrderType.Stop,
          side: positionSide === 'long' ? OrderSide.Sell : OrderSide.Buy,
          size,
          stopPrice: bePrice,
        });
      }
    } catch (err) {
      showToast('error', 'Failed to move SL to breakeven', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy || disabled}
      className="flex-1 py-2.5 rounded text-[11px] font-bold transition-colors
                 bg-transparent border border-(--color-warning)/40 text-(--color-warning) hover:border-(--color-warning) hover:bg-(--color-warning)/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className="inline-flex items-center gap-1">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        {busy ? '...' : 'SL to BE'}
      </span>
    </button>
  );
}

function ClosePositionButton({
  accountId,
  contractId,
  side,
  size,
}: {
  accountId: string | null;
  contractId: string;
  side: OrderSide;
  size: number;
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (!accountId) return;
    setBusy(true);
    try {
      markAsManualClose(contractId);
      await orderService.placeOrder({
        accountId,
        contractId,
        type: OrderType.Market,
        side,
        size,
      });
    } catch (err) {
      console.error('Failed to close position:', err);
      showToast('error', 'Failed to close position', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="flex-1 py-2.5 rounded text-[11px] font-bold text-(--color-text-bright) transition-colors
                 bg-(--color-btn-sell) hover:bg-(--color-btn-sell-hover) cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className="inline-flex items-center gap-1">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        {busy ? 'Closing...' : 'Close'}
      </span>
    </button>
  );
}
