import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';

export function OrderTypeTabs() {
  const { orderType, setOrderType, limitPrice, setLimitPrice, orderContract } = useStore();
  const tickSize = orderContract?.tickSize ?? 0.25;

  return (
    <div>
      <div className={`${SECTION_LABEL} mb-1 text-center`}>Order Type</div>
      <div className="flex gap-1">
        <button
          onClick={() => setOrderType('market')}
          className={`flex-1 text-xs py-1.5 rounded transition-colors ${
            orderType === 'market'
              ? 'bg-[#c8891a] text-black font-medium'
              : 'bg-[#111] text-[#787b86] hover:text-[#d1d4dc]'
          }`}
        >
          Market
        </button>
        <button
          onClick={() => setOrderType('limit')}
          className={`flex-1 text-xs py-1.5 rounded transition-colors ${
            orderType === 'limit'
              ? 'bg-[#c8891a] text-black font-medium'
              : 'bg-[#111] text-[#787b86] hover:text-[#d1d4dc]'
          }`}
        >
          Limit
        </button>
      </div>

      {orderType === 'limit' && (
        <div style={{ marginTop: 20 }}>
          <div className={`${SECTION_LABEL} mb-1 text-center`}>Limit Price</div>
          <input
            type="number"
            step={tickSize}
            value={limitPrice ?? ''}
            onChange={(e) => setLimitPrice(e.target.value ? Number(e.target.value) : null)}
            placeholder=""
            className="w-full bg-[#111] border border-[#2a2e39] rounded px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-[#1a3a6e] placeholder-[#434651]"
          />
        </div>
      )}
    </div>
  );
}
