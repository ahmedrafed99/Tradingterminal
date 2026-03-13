import { useState, useRef, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';
import type { ConditionAction, TakeProfitLevel } from '../../types/bracket';
import { useClickOutside } from '../../hooks/useClickOutside';

function formatAction(action: ConditionAction, tps: TakeProfitLevel[]): string {
  switch (action.kind) {
    case 'moveSLToBreakeven': return 'SL → BE';
    case 'moveSLToPrice': return `SL → +${action.points}pt`;
    case 'moveSLToTP': return `SL → TP${action.tpIndex + 1}`;
    case 'cancelRemainingTPs': return 'Cancel TPs';
    case 'customOffset': return `SL → +${action.points}pt`;
  }
}

export function BracketSummary() {
  const {
    bracketPresets, activePresetId, setActivePresetId, setEditingPresetId,
    deletePreset, draftSlPoints, draftTpPoints,
  } = useStore();

  const activePreset = bracketPresets.find((p) => p.id === activePresetId) ?? null;
  const config = activePreset?.config;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeDropdown = useCallback(() => setOpen(false), []);
  useClickOutside(containerRef, open, closeDropdown);

  const displayName = activePreset ? activePreset.name : 'None';

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className={`${SECTION_LABEL} text-center flex-1`}>Bracket</div>
        {/* Add new preset */}
        <button
          onClick={() => setEditingPresetId('new')}
          title="New preset"
          className="text-(--color-text-muted) hover:text-(--color-text) transition-colors text-sm leading-none"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Custom dropdown */}
      <div ref={containerRef} className="relative" style={{ marginTop: 6 }}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-center bg-(--color-input) border border-(--color-border) rounded text-xs text-white focus:outline-none focus:border-(--color-accent)"
          style={{ padding: '6px 8px' }}
        >
          <span className="truncate">{displayName}</span>
        </button>

        {open && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-(--color-panel) border border-(--color-border) rounded-lg shadow-xl max-h-48 overflow-y-auto" style={{ padding: '4px' }}>
            {/* None option */}
            <button
              onClick={() => { setActivePresetId(null); setOpen(false); }}
              className={`w-full text-center text-xs font-medium rounded-md transition-colors ${
                activePresetId === null ? 'text-(--color-warning) bg-(--color-surface)' : 'text-(--color-text) hover:bg-(--color-surface)'
              }`}
              style={{ padding: '8px 10px' }}
            >
              None
            </button>

            {/* Preset items */}
            {bracketPresets.map((p) => (
              <div
                key={p.id}
                className={`group relative flex items-center rounded-md transition-colors ${
                  p.id === activePresetId ? 'bg-(--color-surface)' : 'hover:bg-(--color-surface)'
                }`}
              >
                <button
                  onClick={() => { setActivePresetId(p.id); setOpen(false); }}
                  className={`w-full text-center text-xs font-medium truncate ${
                    p.id === activePresetId ? 'text-(--color-warning)' : 'text-(--color-text)'
                  }`}
                  style={{ padding: '8px 10px' }}
                >
                  {p.name}
                </button>
                <div className="absolute right-0 flex items-center opacity-0 group-hover:opacity-100 transition-all" style={{ gap: 6, marginRight: 8 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingPresetId(p.id); setOpen(false); }}
                    title="Edit preset"
                    className="p-1.5 rounded text-(--color-text-muted) hover:text-white hover:bg-(--color-hover-toolbar) transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      <path d="m15 5 4 4" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (p.id === activePresetId) setActivePresetId(null);
                      deletePreset(p.id);
                    }}
                    title="Delete preset"
                    className="p-1.5 rounded text-(--color-text-muted) hover:text-(--color-error) hover:bg-(--color-hover-toolbar) transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M5 6l1 14h12l1-14" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Config summary when preset is active */}
      {config && (
        <div className="bg-(--color-input) border border-(--color-border) rounded text-xs space-y-2.5" style={{ padding: 12, marginTop: 6 }}>
          {/* SL */}
          {(() => {
            const slPts = draftSlPoints ?? config.stopLoss.points;
            const isDraft = draftSlPoints != null;
            return (
              <div className="flex justify-between">
                <span className="text-(--color-text-muted)">SL</span>
                <span className={slPts > 0 ? (isDraft ? 'text-[#c4475a]' : 'text-(--color-btn-sell-hover)') : 'text-(--color-text-dim)'}>
                  {slPts > 0
                    ? `${slPts}pt ${config.stopLoss.type === 'TrailingStop' ? '(Trail)' : ''}${isDraft ? ' *' : ''}`
                    : 'Off'}
                </span>
              </div>
            );
          })()}

          {/* TP levels */}
          {config.takeProfits.length === 0 ? (
            <div className="flex justify-between">
              <span className="text-(--color-text-muted)">TP</span>
              <span className="text-(--color-text-dim)">Off</span>
            </div>
          ) : (
            config.takeProfits.map((tp, i) => {
              const tpPts = draftTpPoints[i] ?? tp.points;
              const isDraft = draftTpPoints[i] != null;
              return (
                <div key={tp.id} className="flex justify-between">
                  <span className="text-(--color-text-muted)">TP{i + 1}</span>
                  <span className={isDraft ? 'text-[#3aa876]' : 'text-(--color-btn-buy-hover)'}>
                    {tpPts}pt / {tp.size}ct{isDraft ? ' *' : ''}
                  </span>
                </div>
              );
            })
          )}

          {/* Conditions */}
          {config.conditions.map((cond, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-(--color-text-muted)">TP{cond.trigger.tpIndex + 1} hit</span>
              <span className="text-[#4a80b0]">{formatAction(cond.action, config.takeProfits)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
