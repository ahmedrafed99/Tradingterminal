import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';
import { SpinnerInput } from '../SpinnerInput';

export function ContractsSpinner() {
  const { orderSize, setOrderSize } = useStore(useShallow((s) => ({
    orderSize: s.orderSize,
    setOrderSize: s.setOrderSize,
  })));

  return (
    <div>
      <div className={`${SECTION_LABEL} mb-1 text-center`}>Contracts</div>
      <SpinnerInput
        value={orderSize}
        onChange={(v) => setOrderSize(Math.max(1, Math.round(v)))}
        min={1}
        step={1}
        height={28}
        fullWidth
      />
    </div>
  );
}
