import { useState, useEffect, useRef, useCallback } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useStore } from '../../../store/useStore';
import { SECTION_LABEL } from '../../../constants/styles';
import { RADIUS, Z, SHADOW } from '../../../constants/layout';
import type { Drawing, FRVPDrawing } from '../../../types/drawing';
import { ColorSwatchButton } from '../ColorPopover';
import { COLOR_ACCENT } from '../../../constants/colors';
import { SpinnerInput } from '../../SpinnerInput';

const btnBase = 'relative flex items-center justify-center w-8 h-8 rounded-md border-none bg-transparent cursor-pointer text-(--color-text) transition-colors duration-150';

interface FRVPToolbarPanelProps {
  frvp: FRVPDrawing;
  drawingId: string;
  frvpTab: 'input' | 'style' | null;
  setFrvpTab: (tab: 'input' | 'style' | null) => void;
  closeAll: () => void;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  autoTickSize: number;
}

export function FRVPToolbarPanel({
  frvp,
  drawingId,
  frvpTab,
  setFrvpTab,
  closeAll,
  updateDrawing,
  autoTickSize,
}: FRVPToolbarPanelProps) {
  const [showFrvpModeDD, setShowFrvpModeDD] = useState(false);
  const [showFrvpRowDD, setShowFrvpRowDD] = useState(false);
  const [showFrvpPlacementDD, setShowFrvpPlacementDD] = useState(false);
  const [showFrvpVolTypeDD, setShowFrvpVolTypeDD] = useState(false);

  const frvpModeRef = useRef<HTMLDivElement>(null);
  const frvpRowRef = useRef<HTMLDivElement>(null);
  const frvpPlacementRef = useRef<HTMLDivElement>(null);
  const frvpVolTypeRef = useRef<HTMLDivElement>(null);

  const closeFrvpModeDD = useCallback(() => setShowFrvpModeDD(false), []);
  const closeFrvpRowDD = useCallback(() => setShowFrvpRowDD(false), []);
  const closeFrvpPlacementDD = useCallback(() => setShowFrvpPlacementDD(false), []);
  const closeFrvpVolTypeDD = useCallback(() => setShowFrvpVolTypeDD(false), []);
  useClickOutside(frvpModeRef, showFrvpModeDD, closeFrvpModeDD);
  useClickOutside(frvpRowRef, showFrvpRowDD, closeFrvpRowDD);
  useClickOutside(frvpPlacementRef, showFrvpPlacementDD, closeFrvpPlacementDD);
  useClickOutside(frvpVolTypeRef, showFrvpVolTypeDD, closeFrvpVolTypeDD);

  // Reset dropdowns when the panel is hidden
  useEffect(() => {
    if (!frvpTab) {
      setShowFrvpModeDD(false);
      setShowFrvpRowDD(false);
      setShowFrvpPlacementDD(false);
      setShowFrvpVolTypeDD(false);
    }
  }, [frvpTab]);

  const pocVisible = frvp.showPoc !== false;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, width: 240 }}>
      {/* Input tab */}
      <button
        onClick={() => { const v = frvpTab === 'input' ? null : 'input'; closeAll(); setFrvpTab(v); }}
        className={`${btnBase} !w-auto ${frvpTab === 'input' ? 'text-(--color-warning)' : 'hover:bg-white/5 hover:text-(--color-text)'}`}
        style={{ padding: '0 8px', fontSize: 13, fontWeight: 600, flex: 1, ...(frvpTab === 'input' ? { backgroundColor: '#0d0d0d' } : {}) }}
      >
        Input
      </button>
      {/* Style tab */}
      <button
        onClick={() => { const v = frvpTab === 'style' ? null : 'style'; closeAll(); setFrvpTab(v); }}
        className={`${btnBase} !w-auto ${frvpTab === 'style' ? 'text-(--color-warning)' : 'hover:bg-white/5 hover:text-(--color-text)'}`}
        style={{ padding: '0 8px', fontSize: 13, fontWeight: 600, flex: 1, ...(frvpTab === 'style' ? { backgroundColor: '#0d0d0d' } : {}) }}
      >
        Style
      </button>

      {/* Tab panel */}
      <div
        style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          right: 0,
          padding: '14px 16px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: RADIUS.XL,
          boxShadow: SHADOW.LG,
          zIndex: Z.DROPDOWN,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          opacity: frvpTab ? 1 : 0,
          transform: frvpTab ? 'translateY(0)' : 'translateY(-4px)',
          pointerEvents: frvpTab ? 'auto' : 'none',
          transition: 'opacity 150ms ease, transform 150ms ease',
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {frvpTab === 'input' && (
          <>
            {/* Mode dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Mode</span>
              <div ref={frvpModeRef} className="relative">
                <button
                  onClick={() => { setShowFrvpRowDD(false); setShowFrvpModeDD((v) => !v); }}
                  className="focus:outline-none focus:ring-0"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    background: 'var(--color-surface)', color: 'var(--color-text)',
                    border: '1px solid var(--color-border)', borderRadius: RADIUS.XL,
                    padding: '4px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', minWidth: 90,
                    transition: 'border-color var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                >
                  <span>{(frvp.mode ?? 'anchor') === 'anchor' ? 'Anchor' : 'Range'}</span>
                  <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0, transform: showFrvpModeDD ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}>
                    <path d="M0 0l4 5 4-5z" />
                  </svg>
                </button>
                {showFrvpModeDD && (
                  <div
                    className="absolute border border-(--color-border) rounded-lg shadow-lg animate-dropdown-in"
                    style={{ zIndex: Z.DROPDOWN + 1, top: '100%', right: 0, marginTop: 4, background: 'var(--color-surface)', boxShadow: SHADOW.LG, padding: '2px 0', minWidth: 100 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(['anchor', 'range'] as const).map((m) => {
                      const active = (frvp.mode ?? 'anchor') === m;
                      return (
                        <button
                          key={m}
                          onClick={() => {
                            if (!active) {
                              if (m === 'range') {
                                const latestBar = useStore.getState().lastBarTime;
                                const defaultT2 = latestBar ?? (frvp.anchorTime + 3600);
                                updateDrawing(drawingId, { mode: 'range', t2: defaultT2, t2Auto: true } as Partial<Drawing>);
                              } else {
                                updateDrawing(drawingId, { mode: 'anchor', t2: undefined } as Partial<Drawing>);
                              }
                            }
                            setShowFrvpModeDD(false);
                          }}
                          className={`flex items-center w-full rounded-lg transition-colors text-left ${active ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
                          style={{ padding: '7px 10px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, ...(active ? { background: 'var(--color-text)', color: 'var(--color-surface)' } : {}) }}
                        >
                          {m === 'anchor' ? 'Anchor' : 'Range'}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Row Layout dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Row Layout</span>
              <div ref={frvpRowRef} className="relative">
                <button
                  onClick={() => { setShowFrvpModeDD(false); setShowFrvpRowDD((v) => !v); }}
                  className="focus:outline-none focus:ring-0"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    background: 'var(--color-surface)', color: 'var(--color-text)',
                    border: '1px solid var(--color-border)', borderRadius: RADIUS.XL,
                    padding: '4px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: 140,
                    transition: 'border-color var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                >
                  <span>{(frvp.rowSizeMode ?? 'count') === 'count' ? 'Number of Rows' : 'Ticks per Row'}</span>
                  <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0, transform: showFrvpRowDD ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}>
                    <path d="M0 0l4 5 4-5z" />
                  </svg>
                </button>
                {showFrvpRowDD && (
                  <div
                    className="absolute border border-(--color-border) rounded-lg shadow-lg animate-dropdown-in"
                    style={{ zIndex: Z.DROPDOWN + 1, top: '100%', right: 0, marginTop: 4, background: 'var(--color-surface)', boxShadow: SHADOW.LG, padding: '2px 0', width: 140 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {([['count', 'Number of Rows'], ['price', 'Ticks per Row']] as [string, string][]).map(([m, label]) => {
                      const active = (frvp.rowSizeMode ?? 'count') === m;
                      return (
                        <button
                          key={m}
                          onClick={() => {
                            if (!active) {
                              const patch: Partial<FRVPDrawing> = { rowSizeMode: m as 'count' | 'price' };
                              if (m === 'price' && !(frvp.rowSizePrice! > 0)) patch.rowSizePrice = autoTickSize * 5;
                              updateDrawing(drawingId, patch as Partial<Drawing>);
                            }
                            setShowFrvpRowDD(false);
                          }}
                          className={`flex items-center w-full rounded-lg transition-colors text-left ${active ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
                          style={{ padding: '7px 10px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, ...(active ? { background: 'var(--color-text)', color: 'var(--color-surface)' } : {}) }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Row size */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Row size</span>
              {(frvp.rowSizeMode ?? 'count') === 'count' ? (
                <SpinnerInput
                  value={frvp.numBars ?? 20}
                  onChange={(v) => updateDrawing(drawingId, { numBars: v } as Partial<Drawing>)}
                  min={1}
                  max={500}
                  step={1}
                />
              ) : (
                <SpinnerInput
                  value={Math.max(1, Math.round((frvp.rowSizePrice ?? autoTickSize * 5) / autoTickSize))}
                  onChange={(v) => updateDrawing(drawingId, { rowSizePrice: Math.max(1, v) * autoTickSize } as Partial<Drawing>)}
                  min={1}
                  max={10000}
                  step={1}
                />
              )}
            </div>

            {/* Volume type dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Volume</span>
              <div ref={frvpVolTypeRef} className="relative">
                <button
                  onClick={() => { setShowFrvpModeDD(false); setShowFrvpRowDD(false); setShowFrvpVolTypeDD((v) => !v); }}
                  className="focus:outline-none focus:ring-0"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    background: 'var(--color-surface)', color: 'var(--color-text)',
                    border: '1px solid var(--color-border)', borderRadius: RADIUS.XL,
                    padding: '4px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: 140,
                    transition: 'border-color var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                >
                  <span>Total Volume</span>
                  <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0, transform: showFrvpVolTypeDD ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}>
                    <path d="M0 0l4 5 4-5z" />
                  </svg>
                </button>
                {showFrvpVolTypeDD && (
                  <div
                    className="absolute border border-(--color-border) rounded-lg shadow-lg animate-dropdown-in"
                    style={{ zIndex: Z.DROPDOWN + 1, top: '100%', right: 0, marginTop: 4, background: 'var(--color-surface)', boxShadow: SHADOW.LG, padding: '2px 0', width: 140 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {([['total', 'Total Volume', true], ['delta', 'Delta', false], ['updown', 'Up/Down Volume', false]] as [string, string, boolean][]).map(([val, label, enabled]) => {
                      const active = (frvp.volumeType ?? 'total') === val;
                      return (
                        <button
                          key={val}
                          onClick={() => { if (enabled && !active) { updateDrawing(drawingId, { volumeType: val as 'total' | 'delta' | 'updown' } as Partial<Drawing>); } if (enabled) setShowFrvpVolTypeDD(false); }}
                          className={`flex items-center w-full rounded-lg text-left ${active ? '' : enabled ? 'text-(--color-text) hover:bg-(--color-hover-row)' : ''}`}
                          style={{ padding: '7px 10px', border: 'none', cursor: enabled ? 'pointer' : 'default', fontSize: 13, fontWeight: 600, ...(active ? { background: 'var(--color-text)', color: 'var(--color-surface)' } : !enabled ? { opacity: 0.4, pointerEvents: 'none' } : {}) }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {frvpTab === 'style' && (
          <>
            {/* ── Bars section ── */}
            <span className={`${SECTION_LABEL} block text-center`}>Bars</span>
            {/* Bar color */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text)' }}>Color</span>
              <ColorSwatchButton
                color={frvp.color}
                onChange={(color) => updateDrawing(drawingId, { color } as Partial<Drawing>)}
              />
            </div>

            {/* Placement dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Placement</span>
              <div ref={frvpPlacementRef} className="relative">
                <button
                  onClick={() => { setShowFrvpPlacementDD((v) => !v); }}
                  className="focus:outline-none focus:ring-0"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    background: 'var(--color-surface)', color: 'var(--color-text)',
                    border: '1px solid var(--color-border)', borderRadius: RADIUS.XL,
                    padding: '4px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', minWidth: 80,
                    transition: 'border-color var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                >
                  <span style={{ textTransform: 'capitalize' }}>{frvp.barPlacement ?? 'left'}</span>
                  <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0, transform: showFrvpPlacementDD ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}>
                    <path d="M0 0l4 5 4-5z" />
                  </svg>
                </button>
                {showFrvpPlacementDD && (
                  <div
                    className="absolute border border-(--color-border) rounded-lg shadow-lg animate-dropdown-in"
                    style={{ zIndex: Z.DROPDOWN + 1, top: '100%', right: 0, marginTop: 4, background: 'var(--color-surface)', boxShadow: SHADOW.LG, padding: '2px 0', minWidth: 80 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(['left', 'right', 'middle'] as const).map((p) => {
                      const active = (frvp.barPlacement ?? 'left') === p;
                      return (
                        <button
                          key={p}
                          onClick={() => { if (!active) updateDrawing(drawingId, { barPlacement: p } as Partial<Drawing>); setShowFrvpPlacementDD(false); }}
                          className={`flex items-center w-full rounded-lg transition-colors text-left ${active ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
                          style={{ padding: '7px 10px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, textTransform: 'capitalize', ...(active ? { background: 'var(--color-text)', color: 'var(--color-surface)' } : {}) }}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Offset spinner */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Offset</span>
              <SpinnerInput
                value={frvp.barOffset ?? 0}
                onChange={(v) => updateDrawing(drawingId, { barOffset: Math.max(0, v) } as Partial<Drawing>)}
                min={0}
                max={200}
                step={1}
              />
            </div>

            {/* Bar length spinner */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Length %</span>
              <SpinnerInput
                value={frvp.barLength ?? 50}
                onChange={(v) => updateDrawing(drawingId, { barLength: Math.min(100, Math.max(1, v)) } as Partial<Drawing>)}
                min={1}
                max={100}
                step={1}
              />
            </div>

            {/* Show Values */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}
              onClick={() => updateDrawing(drawingId, { showBarValues: !frvp.showBarValues } as Partial<Drawing>)}
            >
              <span style={{
                width: 14, height: 14, borderRadius: 3,
                border: '1.5px solid var(--color-border)',
                background: frvp.showBarValues ? '#ffffff' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'background var(--transition-fast)',
              }}>
                {frvp.showBarValues && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.5 6L8 1" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Show Values</span>
            </label>

            {/* Highlight on Hover */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}
              onClick={() => updateDrawing(drawingId, { highlightOnHover: !(frvp.highlightOnHover !== false) } as Partial<Drawing>)}
            >
              <span style={{
                width: 14, height: 14, borderRadius: 3,
                border: '1.5px solid var(--color-border)',
                background: frvp.highlightOnHover !== false ? '#ffffff' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'background var(--transition-fast)',
              }}>
                {frvp.highlightOnHover !== false && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.5 6L8 1" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Highlight on Hover</span>
            </label>

            {/* ── POC section ── */}
            <div style={{ borderTop: '1px solid var(--color-border)', margin: '2px 0' }} />
            <span className={`${SECTION_LABEL} block text-center`}>POC</span>

            {/* Extend Right */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}
              onClick={() => updateDrawing(drawingId, { extendPoc: !frvp.extendPoc } as Partial<Drawing>)}
            >
              <span style={{
                width: 14, height: 14, borderRadius: 3,
                border: '1.5px solid var(--color-border)',
                background: frvp.extendPoc ? '#ffffff' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'background var(--transition-fast)',
              }}>
                {frvp.extendPoc && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.5 6L8 1" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Extend</span>
            </label>

            {/* POC color + visibility toggle */}
            <div className="relative" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none', flex: 1 }}
                onClick={() => updateDrawing(drawingId, { showPoc: !pocVisible } as Partial<Drawing>)}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3,
                  border: '1.5px solid var(--color-border)',
                  background: pocVisible ? '#ffffff' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'background var(--transition-fast)',
                }}>
                  {pocVisible && (
                    <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                      <path d="M1 3.5L3.5 6L8 1" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Color</span>
              </label>
              <ColorSwatchButton
                color={frvp.pocColor ?? COLOR_ACCENT}
                onChange={(color) => updateDrawing(drawingId, { pocColor: color } as Partial<Drawing>)}
                disabled={!pocVisible}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
