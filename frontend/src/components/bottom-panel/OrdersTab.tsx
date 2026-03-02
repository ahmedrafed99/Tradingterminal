import { useState } from 'react';
import { orderService } from '../../services/orderService';
import { useStore } from '../../store/useStore';

const TYPE_LABELS: Record<number, string> = { 1: 'Limit', 2: 'Market', 4: 'Stop', 5: 'Trail' };

function shortSymbol(contractId: string): string {
  // "CON.F.US.MNQ.H26" → "MNQH6" (symbol + month + last digit of year)
  const parts = contractId.split('.');
  if (parts.length >= 5) {
    const sym = parts[3];          // MNQ
    const expiry = parts[4];       // H26
    return sym + expiry.charAt(0) + expiry.slice(-1); // MNQH6
  }
  return contractId;
}

export function OrdersTab() {
  const openOrders = useStore((s) => s.openOrders);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const handleCancel = async (orderId: number) => {
    if (activeAccountId == null) return;
    setCancellingId(orderId);
    try {
      await orderService.cancelOrder(activeAccountId, orderId);
    } catch (err) {
      console.error('Failed to cancel order:', err);
    } finally {
      setCancellingId(null);
    }
  };

  if (openOrders.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[#434651] text-xs">
        No open orders
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[#787b86] border-b border-[#2a2e39]">
          <th className="text-left font-normal px-3 py-1.5">Side</th>
          <th className="text-left font-normal px-3 py-1.5">Type</th>
          <th className="text-left font-normal px-3 py-1.5">Symbol</th>
          <th className="text-right font-normal px-3 py-1.5">Size</th>
          <th className="text-right font-normal px-3 py-1.5">Price</th>
          <th className="text-center font-normal px-3 py-1.5"></th>
        </tr>
      </thead>
      <tbody>
        {openOrders.map((order) => {
          const isBuy = order.side === 0;
          const price = order.type === 4 || order.type === 5
            ? order.stopPrice
            : order.limitPrice;
          return (
            <tr
              key={order.id}
              className="border-b border-[#1e222d] hover:bg-[#1e222d] transition-colors"
            >
              <td className="px-3 py-1.5">
                <span className={`font-medium ${isBuy ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                  {isBuy ? 'BUY' : 'SELL'}
                </span>
              </td>
              <td className="px-3 py-1.5 text-[#d1d4dc]">
                {TYPE_LABELS[order.type] ?? order.type}
              </td>
              <td className="px-3 py-1.5 text-[#d1d4dc]">
                {shortSymbol(order.contractId)}
              </td>
              <td className="px-3 py-1.5 text-right text-[#d1d4dc]">{order.size}</td>
              <td className="px-3 py-1.5 text-right text-[#d1d4dc]">
                {price != null ? price.toFixed(2) : '—'}
              </td>
              <td className="px-3 py-1.5 text-center">
                <button
                  onClick={() => handleCancel(order.id)}
                  disabled={cancellingId === order.id}
                  className="text-[#ef5350] hover:bg-[#ef5350]/10 rounded px-1.5 py-0.5 transition-colors disabled:opacity-50"
                  title="Cancel order"
                >
                  {cancellingId === order.id ? '...' : '\u2715'}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
