import { useState } from 'react';
import { TABLE_ROW_STRIPE } from '../../constants/styles';
import { orderService } from '../../services/orderService';
import { useStore } from '../../store/useStore';
import { OrderType, OrderSide } from '../../types/enums';
import { shortSymbol } from '../../utils/formatters';

const TYPE_LABELS: Record<number, string> = {
  [OrderType.Limit]: 'Limit',
  [OrderType.Market]: 'Market',
  [OrderType.Stop]: 'Stop',
  [OrderType.TrailingStop]: 'Trail',
};

const cols = 'grid-cols-[0.7fr_0.8fr_1fr_0.5fr_1fr_0.4fr]';

export function OrdersTab() {
  const openOrders = useStore((s) => s.openOrders);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const handleCancel = async (orderId: number) => {
    if (activeAccountId == null) return;
    setCancellingId(orderId);
    try {
      await orderService.cancelOrder(activeAccountId, orderId);
    } catch {
      // Failure is visible — order stays in the list
    } finally {
      setCancellingId(null);
    }
  };

  if (openOrders.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-(--color-text-dim) text-xs">
        No open orders
      </div>
    );
  }

  return (
    <div className="text-xs" style={{ fontFeatureSettings: '"tnum"' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-(--color-panel) border-b border-(--color-border)">
        <div className={`grid ${cols} items-center h-8 text-(--color-text-muted) pl-4`} style={{ width: '70%' }}>
          <div className="px-3 text-center">Side</div>
          <div className="px-3 text-center">Type</div>
          <div className="px-3 text-center">Symbol</div>
          <div className="px-3 text-center">Qty</div>
          <div className="px-3 text-center">Price</div>
          <div className="px-3 text-center"></div>
        </div>
      </div>

      {/* Rows */}
      {openOrders.map((order, i) => {
        const isBuy = order.side === OrderSide.Buy;
        const price = order.type === OrderType.Stop || order.type === OrderType.TrailingStop
          ? order.stopPrice
          : order.limitPrice;
        const stripe = i % 2 === 1 ? TABLE_ROW_STRIPE : '';

        return (
          <div
            key={order.id}
            className={`${stripe} hover:bg-(--color-surface)/50 transition-colors`}
          >
            <div className={`grid ${cols} items-center h-7 pl-4`} style={{ width: '70%' }}>
              <div className="px-3 text-center whitespace-nowrap">
                <span className={`font-medium ${isBuy ? 'text-(--color-buy)' : 'text-(--color-sell)'}`}>
                  {isBuy ? 'Buy' : 'Sell'}
                </span>
              </div>
              <div className="px-3 text-center text-(--color-text) whitespace-nowrap">
                {TYPE_LABELS[order.type] ?? order.type}
              </div>
              <div className="px-3 text-center text-(--color-text-medium) whitespace-nowrap">
                {shortSymbol(order.contractId)}
              </div>
              <div className="px-3 text-center text-(--color-text)">{order.size}</div>
              <div className="px-3 text-center text-(--color-text) whitespace-nowrap">
                {price != null ? price.toFixed(2) : '\u2014'}
              </div>
              <div className="px-3 text-center">
                <button
                  onClick={() => handleCancel(order.id)}
                  disabled={cancellingId === order.id}
                  className="text-(--color-sell) hover:bg-(--color-sell)/10 rounded px-1.5 py-0.5 transition-colors disabled:opacity-50"
                  title="Cancel order"
                >
                  {cancellingId === order.id ? '...' : '\u2715'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
