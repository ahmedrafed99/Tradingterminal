import { useRef } from 'react';
import type { Drawing, FibDrawing, FibLevel } from '../../../types/drawing';
import { DEFAULT_FIB_LEVELS, DEFAULT_FIB_COLOR, DEFAULT_FIB_NEG_COLOR } from '../../../types/drawing';
import { Popover } from '../../shared/Popover';
import { ColorSwatchButton } from '../ColorPopover';
import { SpinnerInput } from '../../SpinnerInput';
import { resolvedFibLevels } from '../drawings/FibRenderer';

interface FibSettingsPopoverProps {
  fib: FibDrawing;
  drawingId: string;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Shared inline styles
// ---------------------------------------------------------------------------
function checkboxStyle(checked: boolean): React.CSSProperties {
  return {
    width: 14, height: 14, borderRadius: 3,
    border: '1.5px solid var(--color-border)',
    background: checked ? '#ffffff' : 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, cursor: 'pointer',
    transition: 'background var(--transition-fast)',
  };
}

function Checkmark() {
  return (
    <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
      <path d="M1 3.5L3.5 6L8 1" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// LevelRow — one row per fib level
// ---------------------------------------------------------------------------
interface LevelRowProps {
  level: FibLevel;
  masterColor: string;
  onToggle: () => void;
  onColorChange: (color: string) => void;
  onRatioChange: (newRatio: number) => void;
}

function LevelRow({ level, masterColor, onToggle, onColorChange, onRatioChange }: LevelRowProps) {
  const checked = level.visible !== false;
  const color = level.color ?? masterColor;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {/* Visibility checkbox */}
      <span style={checkboxStyle(checked)} onClick={onToggle}>
        {checked && <Checkmark />}
      </span>

      {/* Ratio value as editable spinner */}
      <div style={{ opacity: checked ? 1 : 0.45, transition: 'opacity var(--transition-fast)', flex: 1, minWidth: 0 }}>
        <SpinnerInput
          value={level.ratio}
          onChange={onRatioChange}
          step={1}
          decimals={3}
          min={-1000}
          max={1000}
          inputWidth={62}
        />
      </div>

      {/* Per-level color swatch */}
      <ColorSwatchButton
        color={color}
        onChange={onColorChange}
        disabled={!checked}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FibSettingsPopover
// ---------------------------------------------------------------------------
export function FibSettingsPopover({
  fib,
  drawingId,
  updateDrawing,
  onClose,
}: FibSettingsPopoverProps) {
  // Snapshot for cancel
  const snapshot = useRef<Partial<FibDrawing>>({
    color: fib.color,
    levels: fib.levels ? fib.levels.map((l) => ({ ...l })) : DEFAULT_FIB_LEVELS.map((l) => ({ ...l })),
    showNegative: fib.showNegative,
    extendRight: fib.extendRight,
    negativeMasterColor: fib.negativeMasterColor,
  });

  const handleCancel = () => {
    updateDrawing(drawingId, snapshot.current as Partial<Drawing>);
    onClose();
  };

  // Current merged level list
  const levels = resolvedFibLevels(fib);
  const positiveLevels = levels.filter((l) => l.ratio >= 0).sort((a, b) => a.ratio - b.ratio);
  const negativeLevels = levels.filter((l) => l.ratio < 0).sort((a, b) => b.ratio - a.ratio);

  // ---------------------------------------------------------------------------
  // Patch helpers
  // ---------------------------------------------------------------------------
  const patchLevel = (oldRatio: number, patch: Partial<FibLevel>) => {
    const current = resolvedFibLevels(fib);
    const updated = current.map((l) => l.ratio === oldRatio ? { ...l, ...patch } : l);
    updateDrawing(drawingId, { levels: updated } as Partial<Drawing>);
  };

  const changeLevelRatio = (oldRatio: number, newRatio: number) => {
    if (oldRatio === newRatio) return;
    const current = resolvedFibLevels(fib);
    // Prevent duplicate ratios — skip the step if that value already exists on another row
    if (current.some((l) => l.ratio === newRatio && l.ratio !== oldRatio)) return;
    // Prevent crossing zero — positive levels stay positive, negative levels stay negative
    if (oldRatio >= 0 && newRatio < 0) return;
    if (oldRatio < 0 && newRatio >= 0) return;
    const updated = current.map((l) => l.ratio === oldRatio ? { ...l, ratio: newRatio } : l);
    updateDrawing(drawingId, { levels: updated } as Partial<Drawing>);
  };

  // Positive master: sets drawing.color + all positive level colors
  const applyPositiveMaster = (color: string) => {
    const current = resolvedFibLevels(fib);
    const updated = current.map((l) => l.ratio >= 0 ? { ...l, color } : l);
    updateDrawing(drawingId, { color, levels: updated } as Partial<Drawing>);
  };

  // Negative master: sets negativeMasterColor + all negative level colors
  const applyNegativeMaster = (color: string) => {
    const current = resolvedFibLevels(fib);
    const updated = current.map((l) => l.ratio < 0 ? { ...l, color } : l);
    updateDrawing(drawingId, { negativeMasterColor: color, levels: updated } as Partial<Drawing>);
  };

  const showNegative = !!fib.showNegative;
  const extendRight = !!fib.extendRight;
  const positiveMasterColor = fib.color ?? DEFAULT_FIB_COLOR;
  const negativeMasterColor = fib.negativeMasterColor ?? DEFAULT_FIB_NEG_COLOR;

  // ---------------------------------------------------------------------------
  // Section header row
  // ---------------------------------------------------------------------------
  const SectionHeader = ({ label, color, onColorChange }: { label: string; color: string; onColorChange: (c: string) => void }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>All</span>
        <ColorSwatchButton color={color} onChange={onColorChange} />
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Checkbox row (options)
  // ---------------------------------------------------------------------------
  const OptionRow = ({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) => (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
      onClick={onClick}
    >
      <span style={checkboxStyle(checked)}>{checked && <Checkmark />}</span>
      <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{label}</span>
    </div>
  );

  return (
    <Popover title="Fibonacci Settings" onClose={onClose} onCancel={handleCancel} width={500} persistKey="popover-fib">
      <div className="scrollbar-thin" style={{ flex: 1, padding: '16px 24px 20px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', maxHeight: '85vh' }}>

        {/* ── Positive Lines ─────────────────────── */}
        <SectionHeader label="Positive Lines" color={positiveMasterColor} onColorChange={applyPositiveMaster} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
          {positiveLevels.map((level) => (
            <LevelRow
              key={level.ratio}
              level={level}
              masterColor={positiveMasterColor}
              onToggle={() => patchLevel(level.ratio, { visible: level.visible === false ? true : false })}
              onColorChange={(c) => patchLevel(level.ratio, { color: c })}
              onRatioChange={(r) => changeLevelRatio(level.ratio, r)}
            />
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)' }} />

        {/* ── Show Negative ──────────────────────── */}
        <OptionRow
          checked={showNegative}
          label="Show Negative"
          onClick={() => updateDrawing(drawingId, { showNegative: !showNegative } as Partial<Drawing>)}
        />

        {/* Negative Lines — only when showNegative */}
        {showNegative && (
          <>
            <SectionHeader label="Negative Lines" color={negativeMasterColor} onColorChange={applyNegativeMaster} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
              {negativeLevels.map((level) => (
                <LevelRow
                  key={level.ratio}
                  level={level}
                  masterColor={negativeMasterColor}
                  onToggle={() => patchLevel(level.ratio, { visible: level.visible === false ? true : false })}
                  onColorChange={(c) => patchLevel(level.ratio, { color: c })}
                  onRatioChange={(r) => changeLevelRatio(level.ratio, r)}
                />
              ))}
            </div>
          </>
        )}

        <div style={{ borderTop: '1px solid var(--color-border)' }} />

        {/* ── Extend Right ───────────────────────── */}
        <OptionRow
          checked={extendRight}
          label="Extend Right"
          onClick={() => updateDrawing(drawingId, { extendRight: !extendRight } as Partial<Drawing>)}
        />

      </div>
    </Popover>
  );
}
