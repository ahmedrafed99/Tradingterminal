import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import {
  SHORTCUT_DEFS,
  DEFAULT_SHORTCUTS,
  getEffectiveShortcuts,
  formatKeyCombo,
  type KeyCombo,
} from '../../constants/shortcuts';

const SECTION_TITLE = 'text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider';

/** Group shortcut defs by category */
function groupByCategory() {
  const groups: Record<string, typeof SHORTCUT_DEFS> = {};
  for (const def of SHORTCUT_DEFS) {
    (groups[def.category] ??= []).push(def);
  }
  return groups;
}

function KeyBadge({
  combo,
  active,
  onClick,
  dimmed,
}: {
  combo: KeyCombo;
  active?: boolean;
  onClick?: () => void;
  dimmed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={dimmed}
      className="transition-all"
      style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
        background: 'var(--color-input)',
        border: active
          ? '1px solid var(--color-accent)'
          : '1px solid var(--color-border)',
        color: active ? 'var(--color-accent-text)' : 'var(--color-text-bright)',
        cursor: dimmed ? 'default' : 'pointer',
        opacity: dimmed ? 0.5 : 1,
        animation: active ? 'pulse-border 1.2s ease-in-out infinite' : 'none',
      }}
    >
      {formatKeyCombo(combo)}
    </button>
  );
}

function RecordingBadge({ onRecord, onCancel }: { onRecord: (combo: KeyCombo) => void; onCancel: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore standalone modifier presses
      if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return;

      if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        onCancel();
        return;
      }

      const combo: KeyCombo = { key: e.key };
      if (e.ctrlKey || e.metaKey) combo.ctrl = true;
      if (e.shiftKey) combo.shift = true;
      if (e.altKey) combo.alt = true;
      onRecord(combo);
    };

    const clickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCancel();
      }
    };

    window.addEventListener('keydown', handler, true);
    window.addEventListener('mousedown', clickOutside);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('mousedown', clickOutside);
    };
  }, [onRecord, onCancel]);

  return (
    <button
      ref={ref}
      className="transition-all"
      style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
        background: 'var(--color-input)',
        border: '1px solid var(--color-accent)',
        color: 'var(--color-accent-text)',
        cursor: 'default',
        animation: 'pulse-border 1.2s ease-in-out infinite',
      }}
    >
      Press keys...
    </button>
  );
}

export function ShortcutsTab() {
  const customShortcuts = useStore((s) => s.customShortcuts);
  const setShortcut = useStore((s) => s.setShortcut);
  const resetAllShortcuts = useStore((s) => s.resetAllShortcuts);
  const resetShortcut = useStore((s) => s.resetShortcut);

  const [recording, setRecording] = useState<string | null>(null); // shortcut id being recorded
  const [conflict, setConflict] = useState<{ id: string; message: string } | null>(null);

  const effective = getEffectiveShortcuts(customShortcuts);
  const groups = groupByCategory();
  const hasCustom = Object.keys(customShortcuts).length > 0;

  function handleStartRecording(id: string) {
    setRecording(id);
    setConflict(null);
  }

  function handleRecord(id: string, combo: KeyCombo) {
    // Check for conflicts
    for (const def of SHORTCUT_DEFS) {
      if (def.id === id || !def.rebindable) continue;
      const combos = effective[def.id] ?? [];
      for (const c of combos) {
        if (
          c.key.toLowerCase() === combo.key.toLowerCase() &&
          (c.ctrl ?? false) === (combo.ctrl ?? false) &&
          (c.shift ?? false) === (combo.shift ?? false) &&
          (c.alt ?? false) === (combo.alt ?? false)
        ) {
          setConflict({ id, message: `Already assigned to "${def.label}"` });
          setTimeout(() => setConflict((prev) => prev?.id === id ? null : prev), 3000);
        }
      }
    }

    setShortcut(id, [combo]);
    setRecording(null);
  }

  function handleCancelRecording() {
    setRecording(null);
  }

  function isCustomized(id: string): boolean {
    return id in customShortcuts;
  }

  return (
    <div style={{ padding: '20px 24px 24px' }}>
      <style>{`
        @keyframes pulse-border {
          0%, 100% { border-color: var(--color-accent); }
          50% { border-color: transparent; }
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {Object.entries(groups).map(([category, defs]) => (
          <div key={category}>
            <div className={SECTION_TITLE} style={{ marginBottom: 12 }}>{category}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {defs.map((def) => {
                const combos = effective[def.id] ?? def.defaults;
                const isRecording = recording === def.id;

                return (
                  <div key={def.id}>
                    <div
                      className="flex items-center justify-between rounded transition-colors"
                      style={{
                        padding: '6px 8px',
                        minHeight: 32,
                      }}
                    >
                      {/* Label */}
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <span
                          className="text-xs"
                          style={{
                            color: def.rebindable ? 'var(--color-text)' : 'var(--color-text-muted)',
                          }}
                        >
                          {def.label}
                        </span>
                        {isCustomized(def.id) && def.rebindable && (
                          <button
                            onClick={() => resetShortcut(def.id)}
                            className="text-[10px] hover:text-(--color-accent-text) transition-colors"
                            style={{
                              color: 'var(--color-text-dim)',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                            }}
                            title="Reset to default"
                          >
                            reset
                          </button>
                        )}
                      </div>

                      {/* Key badges */}
                      <div className="flex items-center" style={{ gap: 4 }}>
                        {isRecording ? (
                          <RecordingBadge
                            onRecord={(combo) => handleRecord(def.id, combo)}
                            onCancel={handleCancelRecording}
                          />
                        ) : (
                          combos.map((combo, i) => (
                            <KeyBadge
                              key={i}
                              combo={combo}
                              dimmed={!def.rebindable}
                              onClick={def.rebindable ? () => handleStartRecording(def.id) : undefined}
                            />
                          ))
                        )}
                      </div>
                    </div>

                    {/* Conflict warning */}
                    {conflict?.id === def.id && (
                      <div
                        className="text-[10px] transition-opacity"
                        style={{
                          color: 'var(--color-warning)',
                          padding: '0 8px 4px',
                        }}
                      >
                        {conflict.message}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Reset All */}
        <div className="flex justify-end">
          <button
            onClick={resetAllShortcuts}
            disabled={!hasCustom}
            className="text-[11px] rounded transition-colors hover:text-(--color-text)"
            style={{
              padding: '5px 14px',
              color: 'var(--color-text-muted)',
              background: 'none',
              border: '1px solid var(--color-border)',
              cursor: hasCustom ? 'pointer' : 'default',
              opacity: hasCustom ? 1 : 0.4,
            }}
          >
            Reset All
          </button>
        </div>
      </div>
    </div>
  );
}
