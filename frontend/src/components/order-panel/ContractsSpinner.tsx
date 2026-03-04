import { useStore } from '../../store/useStore';

export function ContractsSpinner() {
  const { orderSize, setOrderSize } = useStore();

  return (
    <div>
      <div className="text-[10px] text-[#787b86] uppercase tracking-wider mb-1 text-center">Contracts</div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setOrderSize(orderSize - 1)}
          disabled={orderSize <= 1}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-[#111] text-[#d1d4dc] text-base font-medium leading-none
                     hover:text-white hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          −
        </button>
        <input
          type="number"
          min={1}
          value={orderSize}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10); // TODO Phase 6: use parseFloat + quantityStep for crypto
            if (!isNaN(v)) setOrderSize(v);
          }}
          className="flex-1 bg-[#111] border border-[#2a2e39] rounded px-2 py-1 text-xs text-white text-center
                     focus:outline-none focus:border-[#1a3a6e] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          onClick={() => setOrderSize(orderSize + 1)}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-[#111] text-[#d1d4dc] text-base font-medium leading-none
                     hover:text-white hover:bg-[#1a1a1a] transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}
