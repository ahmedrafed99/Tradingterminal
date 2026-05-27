import { useRef, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';
import { realtimeService } from '../../services/realtimeService';
import type { GatewayQuote } from '../../services/realtimeService';

export function OrderTypeTabs() {
  const { orderType, setOrderType, limitPrice, setLimitPrice, orderContract } = useStore(useShallow((s) => ({
    orderType: s.orderType,
    setOrderType: s.setOrderType,
    limitPrice: s.limitPrice,
    setLimitPrice: s.setLimitPrice,
    orderContract: s.orderContract,
  })));
  const lastPriceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!orderContract) return;
    lastPriceRef.current = null;
    const handler = (contractId: string, data: GatewayQuote) => {
      if (contractId !== orderContract.id) return;
      if (data.lastPrice != null) lastPriceRef.current = data.lastPrice;
    };
    realtimeService.onQuote(handler);
    return () => realtimeService.offQuote(handler);
  }, [orderContract]);

  function handleSwitchToLimit() {
    setOrderType('limit');
    if (limitPrice == null && lastPriceRef.current != null) {
      setLimitPrice(lastPriceRef.current);
    }
  }

  return (
    <div>
<div className="flex" style={{ marginTop: 6, borderBottom: '1px solid var(--color-border)' }}>
        <button
          onClick={() => setOrderType('market')}
          className={`flex-1 relative text-xs py-2 transition-colors cursor-pointer ${
            orderType === 'market'
              ? 'text-(--color-text)'
              : 'text-(--color-text-muted) hover:text-(--color-text)'
          }`}
        >
          Market
          {orderType === 'market' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-(--color-text)" />
          )}
        </button>
        <button
          onClick={handleSwitchToLimit}
          className={`flex-1 relative text-xs py-2 transition-colors cursor-pointer ${
            orderType === 'limit'
              ? 'text-(--color-text)'
              : 'text-(--color-text-muted) hover:text-(--color-text)'
          }`}
        >
          Limit
          {orderType === 'limit' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-(--color-text)" />
          )}
        </button>
      </div>

      {orderType === 'limit' && (
        <div style={{ marginTop: 20 }}>
          <div className={`${SECTION_LABEL} mb-1 text-center`}>Limit Price</div>
          <input
            type="text"
            inputMode="decimal"
            value={limitPrice ?? ''}
            onChange={(e) => {
              const inputText = e.target.value;
              if (inputText === '' || inputText === '-') { setLimitPrice(null); return; }
              const numericPrice = Number(inputText);
              if (!isNaN(numericPrice)) setLimitPrice(numericPrice);
            }}
            placeholder="Enter price"
            className="w-full bg-(--color-input) border border-(--color-border) rounded h-7 text-xs text-white text-center
                       focus:outline-none focus:border-(--color-focus-ring) placeholder-(--color-text-dim)"
          />
        </div>
      )}
    </div>
  );
}
