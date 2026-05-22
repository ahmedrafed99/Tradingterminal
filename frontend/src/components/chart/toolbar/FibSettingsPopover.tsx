import { useRef } from 'react';
import type { Drawing, FibDrawing, FibLevel } from '../../../types/drawing';
import { DEFAULT_FIB_LEVELS, DEFAULT_FIB_COLOR, DEFAULT_FIB_NEG_COLOR } from '../../../types/drawing';
import { Popover } from '../../shared/Popover';
import { ColorSwatchButton } from '../ColorPopover';
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
// SectionHeader — label + "All" master color swatch
// ---------------------------------------------------------------------------
function SectionHeader({ label, color, onColorChange }: { label: string; color: string; onColorChange: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>All</span>
        <ColorSwatchButton color={color} onChange={onColorChange} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OptionRow — checkbox + label
// ---------------------------------------------------------------------------
function OptionRow({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={checkboxStyle(checked)} onClick={onClick}>{checked && <Checkmark />}</span>
      <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{label}</span>
    </div>
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

      {/* Ratio value */}
      <input
        type="text"
        inputMode="numeric"
        defaultValue={level.ratio}
        key={level.ratio}
        onBlur={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onRatioChange(v);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{
          flex: 1, minWidth: 0, width: 62,
          opacity: checked ? 1 : 0.45,
          transition: 'opacity var(--transition-fast)',
          background: 'transparent',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          color: 'var(--color-text)',
          fontSize: 12,
          padding: '0 6px',
          height: 26,
          outline: 'none',
        }}
      />

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

  // Current merged level list — carry original index so each row has a stable identity
  const levels = resolvedFibLevels(fib);
  const levelsWithIdx = levels.map((l, i) => ({ level: l, origIdx: i }));
  const positiveLevels = levelsWithIdx.filter(({ level }) => level.ratio >= 0).sort((a, b) => a.level.ratio - b.level.ratio);
  const negativeLevels = levelsWithIdx.filter(({ level }) => level.ratio < 0).sort((a, b) => b.level.ratio - a.level.ratio);

  // ---------------------------------------------------------------------------
  // Patch helpers — keyed by origIdx so duplicate ratios never cross-contaminate
  // ---------------------------------------------------------------------------
  const patchLevel = (origIdx: number, patch: Partial<FibLevel>) => {
    const current = resolvedFibLevels(fib);
    const updated = current.map((l, i) => i === origIdx ? { ...l, ...patch } : l);
    updateDrawing(drawingId, { levels: updated } as Partial<Drawing>);
  };

  const changeLevelRatio = (origIdx: number, oldRatio: number, newRatio: number) => {
    if (oldRatio === newRatio) return;
    // Positive levels stay positive, negative stay negative
    if (oldRatio >= 0 && newRatio < 0) return;
    if (oldRatio < 0 && newRatio >= 0) return;
    const current = resolvedFibLevels(fib);
    // Skip if the target ratio already exists on a different level
    if (current.some((l, i) => i !== origIdx && l.ratio === newRatio)) return;
    let updated = current.map((l, i) => i === origIdx ? { ...l, ratio: newRatio } : l);

    // When negatives are active and a positive ratio changed, sync the mirror
    if (showNegative && oldRatio > 0) {
      const mirrorOld = -oldRatio;
      const mirrorNew = -newRatio;
      const mirrorIdx = updated.findIndex((l) => l.ratio === mirrorOld);
      if (mirrorIdx !== -1) {
        // Update existing mirror — strip explicit color so it follows negative master
        updated = updated.map((l, i) => i === mirrorIdx ? { ratio: mirrorNew, visible: l.visible } : l);
      } else if (!updated.some((l) => l.ratio === mirrorNew)) {
        // No mirror yet — add one using negative master color (no explicit color)
        updated = [...updated, { ratio: mirrorNew, visible: true }];
      }
    }

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

  // When enabling negatives, always mirror the current positive levels
  const toggleShowNegative = () => {
    if (!showNegative) {
      const current = resolvedFibLevels(fib);
      const mirrored: FibLevel[] = current
        .filter((l) => l.ratio > 0)
        .map((l) => ({ ratio: -l.ratio, visible: l.visible }));
      updateDrawing(drawingId, {
        showNegative: true,
        levels: [...current.filter((l) => l.ratio >= 0), ...mirrored],
      } as Partial<Drawing>);
    } else {
      updateDrawing(drawingId, { showNegative: false } as Partial<Drawing>);
    }
  };
  const positiveMasterColor = fib.color ?? DEFAULT_FIB_COLOR;
  const negativeMasterColor = fib.negativeMasterColor ?? DEFAULT_FIB_NEG_COLOR;

  return (
    <Popover title="Fibonacci Settings" onClose={onClose} onCancel={handleCancel} width={500} persistKey="popover-fib">
      <div className="scrollbar-thin" style={{ flex: 1, padding: '16px 24px 20px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', maxHeight: '85vh' }}>

        {/* ── Positive Lines ─────────────────────── */}
        <SectionHeader label="Positive Lines" color={positiveMasterColor} onColorChange={applyPositiveMaster} />
        {(() => {
          const half = Math.ceil(positiveLevels.length / 2);
          const cols = [positiveLevels.slice(0, half), positiveLevels.slice(half)];
          return (
            <div style={{ display: 'flex', gap: 20 }}>
              {cols.map((col, ci) => (
                <div key={ci} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {col.map(({ level, origIdx }) => (
                    <LevelRow
                      key={origIdx}
                      level={level}
                      masterColor={positiveMasterColor}
                      onToggle={() => patchLevel(origIdx, { visible: level.visible === false ? true : false })}
                      onColorChange={(c) => patchLevel(origIdx, { color: c })}
                      onRatioChange={(r) => changeLevelRatio(origIdx, level.ratio, r)}
                    />
                  ))}
                </div>
              ))}
            </div>
          );
        })()}

        <div style={{ borderTop: '1px solid var(--color-border)' }} />

        {/* ── Show Negative ──────────────────────── */}
        <OptionRow
          checked={showNegative}
          label="Show Negative"
          onClick={toggleShowNegative}
        />

        {/* Negative Lines — only when showNegative */}
        {showNegative && (
          <>
            <SectionHeader label="Negative Lines" color={negativeMasterColor} onColorChange={applyNegativeMaster} />
            {(() => {
              const half = Math.ceil(negativeLevels.length / 2);
              const cols = [negativeLevels.slice(0, half), negativeLevels.slice(half)];
              return (
                <div style={{ display: 'flex', gap: 20 }}>
                  {cols.map((col, ci) => (
                    <div key={ci} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {col.map(({ level, origIdx }) => (
                        <LevelRow
                          key={origIdx}
                          level={level}
                          masterColor={negativeMasterColor}
                          onToggle={() => patchLevel(origIdx, { visible: level.visible === false ? true : false })}
                          onColorChange={(c) => patchLevel(origIdx, { color: c })}
                          onRatioChange={(r) => changeLevelRatio(origIdx, level.ratio, r)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}
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
