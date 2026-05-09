import { useStore, TIMEFRAMES, type Timeframe } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';
import { getCandlePeriodSeconds } from './barUtils';

interface Props {
  onSelect: (tf: Timeframe) => void;
  /** Hide timeframes with duration >= this many seconds (e.g. current candle's duration) */
  maxSeconds?: number;
}

const SECTIONS = [
  { label: 'Seconds', unit: 1 },
  { label: 'Minutes', unit: 2 },
  { label: 'Hours',   unit: 3 },
  { label: 'Days',    unit: 4 },
] as const;

export function TimeframePicker({ onSelect, maxSeconds }: Props) {
  const customTimeframes = useStore((s) => s.customTimeframes);

  return (
    <div className="py-2">
      {SECTIONS.map(({ label, unit }, idx) => {
        const presets = TIMEFRAMES.filter((tf) => tf.unit === unit);
        const customs = customTimeframes.filter((tf) => tf.unit === unit);
        const all = [...presets, ...customs].filter(
          (tf) => maxSeconds == null || getCandlePeriodSeconds(tf) < maxSeconds,
        );
        if (all.length === 0) return null;
        return (
          <div key={unit}>
            {idx > 0 && <div className="border-t border-(--color-border) mx-3 my-1" />}
            <div className={`${SECTION_LABEL} text-center`} style={{ padding: '6px 14px 2px' }}>{label}</div>
            {all.map((tf) => (
              <div
                key={tf.label}
                className="flex items-center hover:bg-(--color-border) transition-colors rounded-md mx-1.5"
                style={{ padding: '8px 10px' }}
              >
                <button
                  onClick={() => onSelect(tf)}
                  className="text-xs flex-1 text-center font-medium text-(--color-text)"
                >
                  {tf.label}
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
