import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import type { ConditionAction, TakeProfitLevel } from '../../types/bracket';

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

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const displayName = activePreset ? activePreset.name : 'None';

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] text-[#787b86] uppercase tracking-wider text-center flex-1">Bracket</div>
        {/* Add new preset */}
        <button
          onClick={() => setEditingPresetId('new')}
          title="New preset"
          className="text-[#787b86] hover:text-[#d1d4dc] transition-colors text-sm leading-none"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Custom dropdown */}
      <div ref={containerRef} className="relative mb-1">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-center bg-[#111] border border-[#2a2e39] rounded text-xs text-white focus:outline-none focus:border-[#2962ff]"
          style={{ padding: '6px 8px' }}
        >
          <span className="truncate">{displayName}</span>
        </button>

        {open && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-black border border-[#2a2e39] rounded-lg shadow-xl max-h-48 overflow-y-auto" style={{ padding: '4px' }}>
            {/* None option */}
            <button
              onClick={() => { setActivePresetId(null); setOpen(false); }}
              className={`w-full text-center text-xs font-medium rounded-md transition-colors ${
                activePresetId === null ? 'text-[#f0a830] bg-[#1e222d]' : 'text-[#d1d4dc] hover:bg-[#1e222d]'
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
                  p.id === activePresetId ? 'bg-[#1e222d]' : 'hover:bg-[#1e222d]'
                }`}
              >
                <button
                  onClick={() => { setActivePresetId(p.id); setOpen(false); }}
                  className={`w-full text-center text-xs font-medium truncate ${
                    p.id === activePresetId ? 'text-[#f0a830]' : 'text-[#d1d4dc]'
                  }`}
                  style={{ padding: '8px 10px' }}
                >
                  {p.name}
                </button>
                <div className="absolute right-0 flex items-center opacity-0 group-hover:opacity-100 transition-all" style={{ gap: 6, marginRight: 8 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingPresetId(p.id); setOpen(false); }}
                    title="Edit preset"
                    className="p-1.5 rounded text-[#787b86] hover:text-white hover:bg-[#363a45] transition-colors"
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
                    className="p-1.5 rounded text-[#787b86] hover:text-[#f23645] hover:bg-[#363a45] transition-colors"
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
        <div className="bg-[#111] border border-[#2a2e39] rounded text-xs space-y-2.5" style={{ padding: 12 }}>
          {/* SL */}
          {(() => {
            const slPts = draftSlPoints ?? config.stopLoss.points;
            const isDraft = draftSlPoints != null;
            return (
              <div className="flex justify-between">
                <span className="text-[#787b86]">SL</span>
                <span className={slPts > 0 ? (isDraft ? 'text-[#c4475a]' : 'text-[#a62a3d]') : 'text-[#434651]'}>
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
              <span className="text-[#787b86]">TP</span>
              <span className="text-[#434651]">Off</span>
            </div>
          ) : (
            config.takeProfits.map((tp, i) => {
              const tpPts = draftTpPoints[i] ?? tp.points;
              const isDraft = draftTpPoints[i] != null;
              return (
                <div key={tp.id} className="flex justify-between">
                  <span className="text-[#787b86]">TP{i + 1}</span>
                  <span className={isDraft ? 'text-[#3aa876]' : 'text-[#22835b]'}>
                    {tpPts}pt / {tp.size}ct{isDraft ? ' *' : ''}
                  </span>
                </div>
              );
            })
          )}

          {/* Conditions */}
          {config.conditions.map((cond, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-[#787b86]">TP{cond.trigger.tpIndex + 1} hit</span>
              <span className="text-[#4a80b0]">{formatAction(cond.action, config.takeProfits)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
