import { useState, useRef } from 'react';
import { TIMEFRAMES } from '../../store/useStore';
import type { Timeframe } from '../../store/useStore';
import { useClickOutside } from '../../hooks/useClickOutside';
import { SHADOW, Z } from '../../constants/layout';
import { SECTION_LABEL } from '../../constants/styles';
import { SpinnerInput } from '../SpinnerInput';

const UNIT_OPTIONS = [
  { value: 1, label: 'Seconds', suffix: 's' },
  { value: 2, label: 'Minutes', suffix: 'm' },
  { value: 3, label: 'Hours',   suffix: 'h' },
  { value: 4, label: 'Days',    suffix: 'D' },
] as const;

const GROUPS = [
  { label: 'Seconds', unit: 1 },
  { label: 'Minutes', unit: 2 },
  { label: 'Hours',   unit: 3 },
  { label: 'Days',    unit: 4 },
] as const;

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor">
      <path d="M18 7h5v1h-2.01l-1.33 14.64a1.5 1.5 0 0 1-1.5 1.36H9.84a1.5 1.5 0 0 1-1.49-1.36L7.01 8H5V7h5V6c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v1Zm-6-2a1 1 0 0 0-1 1v1h6V6a1 1 0 0 0-1-1h-4ZM8.02 8l1.32 14.54a.5.5 0 0 0 .5.46h8.33a.5.5 0 0 0 .5-.46L19.99 8H8.02Z" />
    </svg>
  );
}

export function StarIcon({ filled, color }: { filled: boolean; color?: string }) {
  return filled ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={color ? '' : 'text-yellow-400'} style={color ? { color } : undefined}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={color ? '' : 'text-(--color-text-muted)'} style={color ? { color } : undefined}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function UnitDropdown({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));
  const current = UNIT_OPTIONS.find((u) => u.value === value);
  return (
    <div ref={ref} className="relative flex-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-1 text-xs text-(--color-text) bg-(--color-panel) border border-(--color-border) rounded-md hover:border-(--color-text-dim) transition-colors"
        style={{ padding: '5px 8px' }}
      >
        <span>{current?.label ?? 'Minutes'}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2.5 3.75L5 6.25L7.5 3.75" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-(--color-surface) border border-(--color-border) rounded-md overflow-hidden"
          style={{ zIndex: Z.DROPDOWN + 1, boxShadow: SHADOW.LG }}>
          {UNIT_OPTIONS.map((u) => (
            <button
              key={u.value}
              onClick={() => { onChange(u.value); setOpen(false); }}
              className={`w-full text-left text-xs px-2 py-1.5 transition-colors ${value === u.value ? 'bg-(--color-text) text-(--color-surface)' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
            >
              {u.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface TimeframePickerProps {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
  /** Defaults to all TIMEFRAMES */
  timeframes?: Timeframe[];
  /** When provided, renders pinned shortcut buttons inline and shows chevron-only trigger when active tf is pinned */
  pinnedTimeframes?: Timeframe[];
  onPin?: (tf: Timeframe) => void;
  onUnpin?: (tf: Timeframe) => void;
  /** Custom user-added timeframes shown alongside presets */
  customTimeframes?: Timeframe[];
  onAddCustom?: (tf: Timeframe) => void;
  onRemoveCustom?: (label: string) => void;
}

export function TimeframePicker({
  value,
  onChange,
  timeframes = TIMEFRAMES,
  pinnedTimeframes,
  onPin,
  onUnpin,
  customTimeframes = [],
  onAddCustom,
  onRemoveCustom,
}: TimeframePickerProps) {
  const [open, setOpen] = useState(false);
  const [pos,  setPos ] = useState<{ top: number; left: number } | null>(null);
  const [customNumber, setCustomNumber] = useState(1);
  const [customUnit,   setCustomUnit  ] = useState(2);
  const [showDupeError, setShowDupeError] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef    = useRef<HTMLDivElement>(null);

  useClickOutside(menuRef, open, () => setOpen(false));

  const hasPinning   = !!pinnedTimeframes && !!onPin && !!onUnpin;
  const hasCustom    = !!onAddCustom && !!onRemoveCustom;
  const isActivePinned = hasPinning && pinnedTimeframes!.some(
    (p) => p.unit === value.unit && p.unitNumber === value.unitNumber,
  );

  function isPinned(tf: Timeframe) {
    return hasPinning && pinnedTimeframes!.some((p) => p.unit === tf.unit && p.unitNumber === tf.unitNumber);
  }

  function handleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((o) => !o);
  }

  function handleSelect(tf: Timeframe) {
    onChange(tf);
    setOpen(false);
  }

  const customExists = [...timeframes, ...customTimeframes].some(
    (tf) => tf.unit === customUnit && tf.unitNumber === customNumber,
  );

  function handleApplyCustom() {
    if (customExists) { setShowDupeError(true); return; }
    setShowDupeError(false);
    if (!customNumber || customNumber < 1) return;
    const unitOpt = UNIT_OPTIONS.find((u) => u.value === customUnit);
    if (!unitOpt) return;
    const label = `${customNumber}${unitOpt.suffix}`;
    const tf: Timeframe = { unit: customUnit as Timeframe['unit'], unitNumber: customNumber, label };
    onAddCustom!(tf);
  }

  return (
    <>
      {/* Pinned shortcut buttons */}
      {hasPinning && pinnedTimeframes!.length > 0 && (
        <div className="self-stretch flex items-stretch gap-1">
          {pinnedTimeframes!.map((tf) => (
            <button
              key={tf.label}
              onClick={() => onChange(tf)}
              className={`flex items-center text-xs font-medium transition-colors rounded text-(--color-text) hover:bg-(--color-border) ${
                value.unit === tf.unit && value.unitNumber === tf.unitNumber ? 'bg-(--color-border)' : ''
              }`}
              style={{ paddingLeft: 4, paddingRight: 4 }}
            >
              {tf.label}
            </button>
          ))}
        </div>
      )}

      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={handleOpen}
        className="flex items-center gap-1 text-xs font-medium transition-colors text-(--color-text) hover:bg-(--color-border) rounded-md"
        style={hasPinning
          ? { paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }
          : { padding: '3px 8px', background: 'var(--color-input)', border: '1px solid var(--color-border)' }
        }
      >
        {(!hasPinning || !isActivePinned) && <span>{value.label}</span>}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2.5 3.75L5 6.25L7.5 3.75" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && pos && (
        <div
          ref={menuRef}
          className="bg-(--color-surface) border border-(--color-border) rounded-lg py-2"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: Z.DROPDOWN, boxShadow: SHADOW.LG, width: 224 }}
        >
          {GROUPS.map(({ label, unit }, idx) => {
            const presets = timeframes.filter((tf) => tf.unit === unit);
            const customs = customTimeframes.filter((tf) => tf.unit === unit);
            const all = [...presets, ...customs];
            if (all.length === 0) return null;
            return (
              <div key={unit}>
                {idx > 0 && <div className="border-t border-(--color-border) mx-3 my-1" />}
                <div className={`${SECTION_LABEL} text-center`} style={{ padding: '6px 14px 2px' }}>{label}</div>
                {all.map((tf) => {
                  const pinned   = isPinned(tf);
                  const active   = value.unit === tf.unit && value.unitNumber === tf.unitNumber;
                  const isCustom = customTimeframes.some((c) => c.label === tf.label);
                  return (
                    <div
                      key={tf.label}
                      className={`group relative flex items-center transition-colors rounded-md mx-1.5 ${active ? '' : 'hover:bg-(--color-hover-row)'}`}
                      style={{ padding: '8px 10px', ...(active ? { background: 'var(--color-text)' } : {}) }}
                    >
                      {isCustom && hasCustom && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onRemoveCustom!(tf.label); }}
                          className="absolute left-1.5 p-0.5 text-(--color-text-muted) opacity-0 group-hover:opacity-100 hover:!text-red-400 hover:!bg-(--color-border)/50 rounded transition-colors"
                          title="Remove"
                        >
                          <TrashIcon />
                        </button>
                      )}
                      <button
                        onClick={() => handleSelect(tf)}
                        className="text-xs flex-1 text-center font-medium"
                        style={{ color: active ? 'var(--color-surface)' : 'var(--color-text)' }}
                      >
                        {tf.label}
                      </button>
                      {hasPinning && (
                        <button
                          onClick={(e) => { e.stopPropagation(); pinned ? onUnpin!(tf) : onPin!(tf); }}
                          className="ml-2 p-0.5 hover:opacity-80 transition-opacity"
                        >
                          <StarIcon filled={pinned} color={active ? 'var(--color-panel)' : undefined} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Custom timeframe input */}
          {hasCustom && (
            <>
              <div className="border-t border-(--color-border) my-2 mx-3" />
              <div style={{ padding: '4px 14px 8px' }}>
                <div className={SECTION_LABEL} style={{ marginBottom: '8px' }}>Custom</div>
                <div className="flex items-center gap-1.5" style={{ marginBottom: showDupeError ? 4 : 0 }}>
                  <SpinnerInput
                    value={customNumber}
                    onChange={(v) => { setCustomNumber(v); setShowDupeError(false); }}
                    min={1}
                    step={1}
                    inputWidth={40}
                    height={28}
                  />
                  <UnitDropdown value={customUnit} onChange={(v) => { setCustomUnit(v); setShowDupeError(false); }} />
                  <button
                    onClick={handleApplyCustom}
                    className={`text-xs font-medium rounded-md bg-(--color-panel) border transition-all shrink-0 ${
                      showDupeError
                        ? 'border-red-700 text-red-400'
                        : 'text-(--color-text) border-(--color-border) hover:border-(--color-text-dim) active:bg-[#c8c8c8] active:text-black'
                    }`}
                    style={{ padding: '5px 12px' }}
                  >
                    Add
                  </button>
                </div>
                <div
                  className="text-[10px] text-red-400 text-center overflow-hidden transition-all duration-300"
                  style={{ maxHeight: showDupeError ? 20 : 0, opacity: showDupeError ? 1 : 0 }}
                >
                  Timeframe already exists
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
