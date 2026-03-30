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
      <div className={`${SECTION_LABEL} text-center`}>Order Type</div>
      <div className="flex gap-1" style={{ marginTop: 6 }}>
        <button
          onClick={() => setOrderType('market')}
          className={`flex-1 text-xs py-1.5 rounded transition-colors cursor-pointer ${
            orderType === 'market'
              ? 'bg-(--color-warning) text-black font-medium'
              : 'bg-(--color-input) text-(--color-text-muted) hover:text-(--color-text)'
          }`}
        >
          Market
        </button>
        <button
          onClick={() => setOrderType('limit')}
          className={`flex-1 text-xs py-1.5 rounded transition-colors cursor-pointer ${
            orderType === 'limit'
              ? 'bg-(--color-warning) text-black font-medium'
              : 'bg-(--color-input) text-(--color-text-muted) hover:text-(--color-text)'
          }`}
        >
          Limit
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
            className="w-full bg-(--color-input) border border-(--color-border) rounded py-2.5 text-sm text-white text-center
                       focus:outline-none focus:border-(--color-focus-ring) placeholder-(--color-text-dim)"
          />
        </div>
      )}
    </div>
  );
}
