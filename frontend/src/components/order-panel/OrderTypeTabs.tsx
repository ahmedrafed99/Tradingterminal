import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';

export function OrderTypeTabs() {
  const { orderType, setOrderType, limitPrice, setLimitPrice, orderContract } = useStore(useShallow((s) => ({
    orderType: s.orderType,
    setOrderType: s.setOrderType,
    limitPrice: s.limitPrice,
    setLimitPrice: s.setLimitPrice,
    orderContract: s.orderContract,
  })));
  const tickSize = orderContract?.tickSize ?? 0.25;

  return (
    <div>
<div className="flex" style={{ marginTop: 6, borderBottom: '1px solid var(--color-border)' }}>
        <button
          onClick={() => setOrderType('market')}
          className={`flex-1 relative text-xs py-2 transition-colors cursor-pointer ${
            orderType === 'market'
              ? 'text-(--color-text) font-medium'
              : 'text-(--color-text-muted) hover:text-(--color-text)'
          }`}
        >
          Market
          {orderType === 'market' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-(--color-text)" />
          )}
        </button>
        <button
          onClick={() => setOrderType('limit')}
          className={`flex-1 relative text-xs py-2 transition-colors cursor-pointer ${
            orderType === 'limit'
              ? 'text-(--color-text) font-medium'
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
              const v = e.target.value;
              if (v === '' || v === '-') { setLimitPrice(null); return; }
              const n = Number(v);
              if (!isNaN(n)) setLimitPrice(n);
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
