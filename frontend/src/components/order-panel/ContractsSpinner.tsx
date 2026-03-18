import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';

export function ContractsSpinner() {
  const { orderSize, setOrderSize } = useStore(useShallow((s) => ({
    orderSize: s.orderSize,
    setOrderSize: s.setOrderSize,
  })));

  return (
    <div>
      <div className={`${SECTION_LABEL} mb-1 text-center`}>Contracts</div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setOrderSize(orderSize - 1)}
          disabled={orderSize <= 1}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-(--color-input) text-(--color-text) text-base font-medium leading-none
                     hover:text-white hover:bg-(--color-bg) cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          className="flex-1 bg-(--color-input) border border-(--color-border) rounded px-2 py-1 text-xs text-white text-center
                     focus:outline-none focus:border-(--color-focus-ring) [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          onClick={() => setOrderSize(orderSize + 1)}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-(--color-input) text-(--color-text) text-base font-medium leading-none
                     hover:text-white hover:bg-(--color-bg) cursor-pointer transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}
