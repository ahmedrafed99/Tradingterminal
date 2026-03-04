import { useState, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { orderService } from '../../services/orderService';
import { bracketEngine } from '../../services/bracketEngine';
import { OrderType, OrderSide, PositionType } from '../../types/enums';
import { showToast, errorMessage } from '../../utils/toast';
import { calcPnl } from '../../utils/instrument';

function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PositionDisplay() {
  const { positions, orderContract, lastPrice, activeAccountId } = useStore();
  const pnlRef = useRef<number>(0);

  const pos = orderContract ? positions.find((p) => String(p.contractId) === String(orderContract.id)) : undefined;
  const hasPos = pos != null && pos.size !== 0;

  if (!orderContract || !hasPos) {
    return (
      <div className="border-t border-[#2a2e39] mt-2 pt-3">
        <div className="text-[10px] text-[#787b86] uppercase tracking-wider mb-1 text-center">Position</div>
        <div className="text-xs text-[#434651] text-center">No position</div>
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

  return (
    <div className="border-t border-[#2a2e39] mt-2 pt-3 space-y-1.5">
      <div className="text-[10px] text-[#787b86] uppercase tracking-wider text-center">Position</div>

      {/* +1 @ 24,905.00 */}
      <div className={`text-sm font-bold text-center ${isLong ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
        {sign}{pos.size} @ {formatPrice(pos.averagePrice)}
      </div>

      {/* UP&L: +12.50 $ */}
      <div className="flex items-center justify-center gap-1">
        <span className="text-[10px] text-[#787b86]">UP&L:</span>
        <span className={`text-xs font-semibold ${pnl >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
          {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} $
        </span>
      </div>

      {/* Action buttons — always both rendered to prevent layout bounce */}
      <div className="flex gap-1.5">
        <MoveToBEButton
          accountId={activeAccountId}
          contractId={orderContract.id}
          positionSide={isLong ? 'long' : 'short'}
          size={pos.size}
          entryPrice={pos.averagePrice}
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
  disabled,
}: {
  accountId: number | null;
  contractId: string;
  positionSide: 'long' | 'short';
  size: number;
  entryPrice: number;
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

      if (existingSL) {
        await orderService.modifyOrder({
          accountId,
          orderId: existingSL.id,
          stopPrice: entryPrice,
        });
      } else {
        // Place a new stop order at breakeven — SL side is opposite of position
        await orderService.placeOrder({
          accountId,
          contractId,
          type: OrderType.Stop,
          side: positionSide === 'long' ? OrderSide.Sell : OrderSide.Buy,
          size,
          stopPrice: entryPrice,
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
      className="flex-1 py-2.5 rounded text-[11px] font-bold text-[#d1d4dc] transition-colors
                 bg-transparent border border-[#363a45] hover:border-[#787b86] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {busy ? '...' : 'SL to BE'}
    </button>
  );
}

function ClosePositionButton({
  accountId,
  contractId,
  side,
  size,
}: {
  accountId: number | null;
  contractId: string;
  side: OrderSide;
  size: number;
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (!accountId) return;
    setBusy(true);
    try {
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
      className="flex-1 py-2.5 rounded text-[11px] font-bold text-[#d1d4dc] transition-colors
                 bg-transparent border border-[#363a45] hover:border-[#787b86] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {busy ? 'Closing...' : 'Close'}
    </button>
  );
}
