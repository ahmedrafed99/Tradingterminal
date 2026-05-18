import { useState, useRef, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Z, SHADOW } from '../../constants/layout';
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
    bracketPresets, activePresetId, suspendedPresetId, setActivePresetId, setEditingPresetId,
    deletePreset, draftSlPoints, draftTpPoints,
  } = useStore(useShallow((s) => ({
    bracketPresets: s.bracketPresets,
    activePresetId: s.activePresetId,
    suspendedPresetId: s.suspendedPresetId,
    setActivePresetId: s.setActivePresetId,
    setEditingPresetId: s.setEditingPresetId,
    deletePreset: s.deletePreset,
    draftSlPoints: s.draftSlPoints,
    draftTpPoints: s.draftTpPoints,
  })));

  const activePreset = bracketPresets.find((p) => p.id === activePresetId) ?? null;
  // Show suspended preset config (dimmed) so layout doesn't shift when position opens
  const suspendedPreset = suspendedPresetId ? bracketPresets.find((p) => p.id === suspendedPresetId) ?? null : null;
  const displayPreset = activePreset ?? suspendedPreset;
  const isSuspended = !activePreset && !!suspendedPreset;
  const config = displayPreset?.config;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeDropdown = useCallback(() => setOpen(false), []);
  useClickOutside(containerRef, open, closeDropdown);

  const displayName = displayPreset ? displayPreset.name : 'None';

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className={`${SECTION_LABEL} text-center flex-1`}>Bracket</div>
        {/* Add new preset */}
        <button
          onClick={() => setEditingPresetId('new')}
          title="New preset"
          className="text-(--color-text-muted) hover:text-(--color-text) transition-colors text-sm leading-none cursor-pointer"
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
          className="w-full flex items-center justify-between gap-1 text-xs text-(--color-text) bg-(--color-input) border border-(--color-border) rounded-lg focus:outline-none cursor-pointer transition-colors"
          style={{ padding: '6px 10px' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >
          <span className={`truncate ${isSuspended ? 'text-(--color-text-muted)' : ''}`}>{displayName}</span>
          <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
            <path d="M0 0l4 5 4-5z" />
          </svg>
        </button>

        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-(--color-surface) border border-(--color-border) rounded-lg overflow-hidden max-h-48 overflow-y-auto" style={{ zIndex: Z.DROPDOWN, boxShadow: SHADOW.LG, padding: '2px 0' }}>
            {/* None option */}
            <button
              onClick={() => { setActivePresetId(null); setOpen(false); }}
              className={`w-full text-left text-xs transition-colors cursor-pointer ${
                activePresetId === null ? 'bg-(--color-text) text-(--color-surface)' : 'text-(--color-text) hover:bg-(--color-hover-row)'
              }`}
              style={{ padding: '6px 10px' }}
            >
              None
            </button>

            {/* Preset items */}
            {bracketPresets.map((p) => (
              <div key={p.id} className="relative">
                <button
                  onClick={() => { setActivePresetId(p.id); setOpen(false); }}
                  className={`w-full text-left text-xs transition-colors cursor-pointer ${
                    p.id === activePresetId ? 'bg-(--color-text) text-(--color-surface)' : 'text-(--color-text) hover:bg-(--color-hover-row)'
                  }`}
                  style={{ padding: '6px 10px' }}
                >
                  {p.name}
                </button>
                {(() => {
                  const sel = p.id === activePresetId;
                  const restColor = sel ? 'var(--color-surface)' : 'var(--color-text-muted)';
                  const trashHover = sel ? 'var(--color-surface)' : 'var(--color-error)';
                  return (
                    <div className="absolute right-0 top-0 bottom-0 flex items-center" style={{ gap: 2, marginRight: 4 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingPresetId(p.id); setOpen(false); }}
                        title="Edit preset"
                        style={{ padding: '4px 6px', border: 'none', background: 'transparent', cursor: 'pointer', color: restColor, opacity: 0.4, display: 'flex', alignItems: 'center' }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; }}
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
                        style={{ padding: '4px 6px', border: 'none', background: 'transparent', cursor: 'pointer', color: restColor, opacity: 0.4, display: 'flex', alignItems: 'center' }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = trashHover; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.color = restColor; }}
                      >
                        <svg width="17" height="17" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor">
                          <path d="M18 7h5v1h-2.01l-1.33 14.64a1.5 1.5 0 0 1-1.5 1.36H9.84a1.5 1.5 0 0 1-1.49-1.36L7.01 8H5V7h5V6c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v1Zm-6-2a1 1 0 0 0-1 1v1h6V6a1 1 0 0 0-1-1h-4ZM8.02 8l1.32 14.54a.5.5 0 0 0 .5.46h8.33a.5.5 0 0 0 .5-.46L19.99 8H8.02Z" />
                        </svg>
                      </button>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Config summary when preset is active (dimmed when suspended during open position) */}
      {config && (
        <div className={`bg-(--color-input) border border-(--color-border) rounded text-xs space-y-2.5${isSuspended ? ' opacity-35 pointer-events-none' : ''}`} style={{ padding: 12, marginTop: 6 }}>
          {/* SL */}
          {(() => {
            const slPts = draftSlPoints ?? config.stopLoss.points;
            const isDraft = draftSlPoints != null;
            return (
              <div className="flex justify-between">
                <span className="text-(--color-text-muted)">SL</span>
                <span className={slPts > 0 ? (isDraft ? 'text-(--color-sell)' : 'text-(--color-btn-sell-hover)') : 'text-(--color-text-dim)'}>
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
                  <span className={isDraft ? 'text-(--color-buy)' : 'text-(--color-btn-buy-hover)'}>
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
              <span className="text-(--color-accent-text)">{formatAction(cond.action, config.takeProfits)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
