import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useDraggable } from '../../../hooks/useDraggable';
import { useStore } from '../../../store/useStore';
import { SECTION_LABEL } from '../../../constants/styles';
import { RADIUS, Z, SHADOW } from '../../../constants/layout';
import type { Drawing, FRVPDrawing } from '../../../types/drawing';
import { ColorSwatchButton } from '../ColorPopover';
import { COLOR_ACCENT } from '../../../constants/colors';
import { SpinnerInput } from '../../SpinnerInput';

interface FRVPSettingsPopoverProps {
  frvp: FRVPDrawing;
  drawingId: string;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  autoTickSize: number;
  onClose: () => void;
}

export function FRVPSettingsPopover({
  frvp,
  drawingId,
  updateDrawing,
  autoTickSize,
  onClose,
}: FRVPSettingsPopoverProps) {
  const { ref, onDragMouseDown, dragStyle } = useDraggable<HTMLDivElement>();
  useClickOutside(ref, true, onClose);

  const [tab, setTab] = useState<'input' | 'style'>('input');

  const snapshot = useRef<Partial<FRVPDrawing>>({
    mode: frvp.mode, t2: frvp.t2, t2Auto: frvp.t2Auto,
    numBars: frvp.numBars, rowSizeMode: frvp.rowSizeMode, rowSizePrice: frvp.rowSizePrice,
    volumeType: frvp.volumeType,
    color: frvp.color, barPlacement: frvp.barPlacement, barOffset: frvp.barOffset,
    barLength: frvp.barLength, showBarValues: frvp.showBarValues, highlightOnHover: frvp.highlightOnHover,
    extendPoc: frvp.extendPoc, showPoc: frvp.showPoc, pocColor: frvp.pocColor,
  });

  const handleCancel = () => {
    updateDrawing(drawingId, snapshot.current as Partial<Drawing>);
    onClose();
  };

  // ── Input tab dropdowns ──────────────────────────────────────────────────
  const [showModeDD, setShowModeDD] = useState(false);
  const [showRowDD, setShowRowDD] = useState(false);
  const [showVolTypeDD, setShowVolTypeDD] = useState(false);
  const [showPlacementDD, setShowPlacementDD] = useState(false);

  const modeRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const volTypeRef = useRef<HTMLDivElement>(null);
  const placementRef = useRef<HTMLDivElement>(null);

  useClickOutside(modeRef, showModeDD, useCallback(() => setShowModeDD(false), []));
  useClickOutside(rowRef, showRowDD, useCallback(() => setShowRowDD(false), []));
  useClickOutside(volTypeRef, showVolTypeDD, useCallback(() => setShowVolTypeDD(false), []));
  useClickOutside(placementRef, showPlacementDD, useCallback(() => setShowPlacementDD(false), []));

  const pocVisible = frvp.showPoc !== false;

  const labelStyle: React.CSSProperties = {
    fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap',
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  };
  const checkboxSpan = (checked: boolean): React.CSSProperties => ({
    width: 14, height: 14, borderRadius: 3,
    border: '1.5px solid var(--color-border)',
    background: checked ? '#ffffff' : 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'background var(--transition-fast)',
  });
  const Checkmark = () => (
    <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
      <path d="M1 3.5L3.5 6L8 1" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const ChevronDown = ({ open }: { open: boolean }) => (
    <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}>
      <path d="M0 0l4 5 4-5z" />
    </svg>
  );

  const ddBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    background: 'var(--color-surface)', color: 'var(--color-text)',
    border: '1px solid var(--color-border)', borderRadius: RADIUS.XL,
    padding: '4px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    transition: 'border-color var(--transition-fast)',
  };
  const ddPanelStyle: React.CSSProperties = {
    position: 'absolute', zIndex: Z.DROPDOWN + 1,
    top: '100%', right: 0, marginTop: 4,
    background: 'var(--color-surface)', boxShadow: SHADOW.LG,
    border: '1px solid var(--color-border)', borderRadius: RADIUS.LG,
    padding: '2px 0',
  };
  const ddItemStyle = (active: boolean): React.CSSProperties => ({
    padding: '7px 10px', border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 600,
    ...(active ? { background: 'var(--color-text)', color: 'var(--color-surface)' } : {}),
  });

  const tabBtn = (t: 'input' | 'style'): React.CSSProperties => ({
    padding: '6px 4px', fontSize: 13, fontWeight: 600,
    border: 'none', borderBottom: tab === t ? '2px solid var(--color-text)' : '2px solid transparent',
    cursor: 'pointer', background: 'transparent',
    color: tab === t ? 'var(--color-text)' : 'var(--color-text-muted)',
    transition: 'color var(--transition-fast), border-color var(--transition-fast)',
  });

  return (
    <div
      ref={ref}
      className="fixed bg-(--color-surface) border border-(--color-border) rounded-xl shadow-lg"
      style={{ zIndex: Z.DROPDOWN, width: 440, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', ...dragStyle }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 10px', cursor: 'grab' }} onMouseDown={onDragMouseDown}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>FRVP Settings</span>
        <button
          onClick={onClose}
          className="focus:outline-none focus:ring-0"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: RADIUS.MD,
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--color-text-muted)',
            transition: 'background var(--transition-fast), color var(--transition-fast)',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover-row)'; e.currentTarget.style.color = 'var(--color-text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 16, padding: '8px 24px 0' }}>
        <button style={tabBtn('input')} onClick={() => setTab('input')}>Input</button>
        <button style={tabBtn('style')} onClick={() => setTab('style')}>Style</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {tab === 'input' && (
          <>
            {/* Mode */}
            <div style={rowStyle}>
              <span style={labelStyle}>Mode</span>
              <div ref={modeRef} className="relative">
                <button
                  style={{ ...ddBtnStyle, minWidth: 100 }}
                  onClick={() => { setShowRowDD(false); setShowModeDD((v) => !v); }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                  className="focus:outline-none focus:ring-0"
                >
                  <span>{(frvp.mode ?? 'anchor') === 'anchor' ? 'Anchor' : 'Range'}</span>
                  <ChevronDown open={showModeDD} />
                </button>
                {showModeDD && (
                  <div style={{ ...ddPanelStyle, minWidth: 100 }} onClick={(e) => e.stopPropagation()}>
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
                            setShowModeDD(false);
                          }}
                          className={`flex items-center w-full rounded-lg transition-colors text-left ${active ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
                          style={ddItemStyle(active)}
                        >
                          {m === 'anchor' ? 'Anchor' : 'Range'}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Row Layout */}
            <div style={rowStyle}>
              <span style={labelStyle}>Row Layout</span>
              <div ref={rowRef} className="relative">
                <button
                  style={{ ...ddBtnStyle, width: 150 }}
                  onClick={() => { setShowModeDD(false); setShowRowDD((v) => !v); }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                  className="focus:outline-none focus:ring-0"
                >
                  <span>{(frvp.rowSizeMode ?? 'count') === 'count' ? 'Number of Rows' : 'Ticks per Row'}</span>
                  <ChevronDown open={showRowDD} />
                </button>
                {showRowDD && (
                  <div style={{ ...ddPanelStyle, width: 150 }} onClick={(e) => e.stopPropagation()}>
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
                            setShowRowDD(false);
                          }}
                          className={`flex items-center w-full rounded-lg transition-colors text-left ${active ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
                          style={ddItemStyle(active)}
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
            <div style={rowStyle}>
              <span style={labelStyle}>Row size</span>
              {(frvp.rowSizeMode ?? 'count') === 'count' ? (
                <SpinnerInput
                  value={frvp.numBars ?? 20}
                  onChange={(v) => updateDrawing(drawingId, { numBars: v } as Partial<Drawing>)}
                  min={1} max={500} step={1}
                />
              ) : (
                <SpinnerInput
                  value={Math.max(1, Math.round((frvp.rowSizePrice ?? autoTickSize * 5) / autoTickSize))}
                  onChange={(v) => updateDrawing(drawingId, { rowSizePrice: Math.max(1, v) * autoTickSize } as Partial<Drawing>)}
                  min={1} max={10000} step={1}
                />
              )}
            </div>

            {/* Volume type */}
            <div style={rowStyle}>
              <span style={labelStyle}>Volume</span>
              <div ref={volTypeRef} className="relative">
                <button
                  style={{ ...ddBtnStyle, width: 150 }}
                  onClick={() => { setShowModeDD(false); setShowRowDD(false); setShowVolTypeDD((v) => !v); }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                  className="focus:outline-none focus:ring-0"
                >
                  <span>Total Volume</span>
                  <ChevronDown open={showVolTypeDD} />
                </button>
                {showVolTypeDD && (
                  <div style={{ ...ddPanelStyle, width: 150 }} onClick={(e) => e.stopPropagation()}>
                    {([['total', 'Total Volume', true], ['delta', 'Delta', false], ['updown', 'Up/Down Volume', false]] as [string, string, boolean][]).map(([val, label, enabled]) => {
                      const active = (frvp.volumeType ?? 'total') === val;
                      return (
                        <button
                          key={val}
                          onClick={() => { if (enabled && !active) updateDrawing(drawingId, { volumeType: val as 'total' | 'delta' | 'updown' } as Partial<Drawing>); if (enabled) setShowVolTypeDD(false); }}
                          className={`flex items-center w-full rounded-lg text-left ${active ? '' : enabled ? 'text-(--color-text) hover:bg-(--color-hover-row)' : ''}`}
                          style={{ ...ddItemStyle(active), cursor: enabled ? 'pointer' : 'default', ...(!enabled ? { opacity: 0.4, pointerEvents: 'none' } : {}) }}
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

        {tab === 'style' && (
          <>
            {/* Volume Profile — main row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => updateDrawing(drawingId, { showBarValues: !frvp.showBarValues } as Partial<Drawing>)}
              >
                <span style={checkboxSpan(!!frvp.showBarValues)}>{frvp.showBarValues && <Checkmark />}</span>
                <span style={labelStyle}>Volume Profile</span>
              </label>
              <ColorSwatchButton color={frvp.color} onChange={(color) => updateDrawing(drawingId, { color } as Partial<Drawing>)} />
            </div>

            {/* Sub-rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 21 }}>
              {/* Highlight on Hover */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => updateDrawing(drawingId, { highlightOnHover: !(frvp.highlightOnHover !== false) } as Partial<Drawing>)}
              >
                <span style={checkboxSpan(frvp.highlightOnHover !== false)}>{frvp.highlightOnHover !== false && <Checkmark />}</span>
                <span style={labelStyle}>Highlight on Hover</span>
              </label>

              {/* Placement */}
              <div style={rowStyle}>
                <span style={labelStyle}>Placement</span>
                <div ref={placementRef} className="relative">
                  <button
                    style={{ ...ddBtnStyle, minWidth: 90 }}
                    onClick={() => setShowPlacementDD((v) => !v)}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                    className="focus:outline-none focus:ring-0"
                  >
                    <span style={{ textTransform: 'capitalize' }}>{frvp.barPlacement ?? 'left'}</span>
                    <ChevronDown open={showPlacementDD} />
                  </button>
                  {showPlacementDD && (
                    <div style={{ ...ddPanelStyle, minWidth: 90 }} onClick={(e) => e.stopPropagation()}>
                      {(['left', 'right', 'middle'] as const).map((p) => {
                        const active = (frvp.barPlacement ?? 'left') === p;
                        return (
                          <button
                            key={p}
                            onClick={() => { if (!active) updateDrawing(drawingId, { barPlacement: p } as Partial<Drawing>); setShowPlacementDD(false); }}
                            className={`flex items-center w-full rounded-lg transition-colors text-left ${active ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
                            style={{ ...ddItemStyle(active), textTransform: 'capitalize' }}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Offset */}
              <div style={rowStyle}>
                <span style={labelStyle}>Offset</span>
                <SpinnerInput value={frvp.barOffset ?? 0} onChange={(v) => updateDrawing(drawingId, { barOffset: Math.max(0, v) } as Partial<Drawing>)} min={0} max={200} step={1} />
              </div>

              {/* Length % */}
              <div style={rowStyle}>
                <span style={labelStyle}>Length %</span>
                <SpinnerInput value={frvp.barLength ?? 50} onChange={(v) => updateDrawing(drawingId, { barLength: Math.min(100, Math.max(1, v)) } as Partial<Drawing>)} min={1} max={100} step={1} />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', margin: '2px 0' }} />

            {/* POC visibility + color swatch */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => updateDrawing(drawingId, { showPoc: !pocVisible } as Partial<Drawing>)}
              >
                <span style={checkboxSpan(pocVisible)}>{pocVisible && <Checkmark />}</span>
                <span style={labelStyle}>POC</span>
              </label>
              <ColorSwatchButton
                color={frvp.pocColor ?? COLOR_ACCENT}
                onChange={(color) => updateDrawing(drawingId, { pocColor: color } as Partial<Drawing>)}
                disabled={!pocVisible}
              />
            </div>

            {/* Extend — sub-row */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none', paddingLeft: 21, opacity: pocVisible ? 1 : 0.4, pointerEvents: pocVisible ? 'auto' : 'none', transition: 'opacity var(--transition-fast)' }}
              onClick={() => updateDrawing(drawingId, { extendPoc: !frvp.extendPoc } as Partial<Drawing>)}
            >
              <span style={checkboxSpan(!!frvp.extendPoc)}>{frvp.extendPoc && <Checkmark />}</span>
              <span style={labelStyle}>Extend</span>
            </label>
          </>
        )}
      </div>

      {/* Footer */}
      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />
      <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button
          onClick={handleCancel}
          className="text-(--color-text) rounded"
          style={{ fontSize: 13, padding: '5px 16px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', cursor: 'pointer', transition: 'background var(--transition-fast)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-hover-toolbar)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-surface)')}
        >
          Cancel
        </button>
        <button
          onClick={onClose}
          className="rounded"
          style={{ fontSize: 13, padding: '5px 16px', background: 'var(--color-label-close)', color: 'var(--color-label-text)', border: 'none', cursor: 'pointer', transition: 'background var(--transition-fast)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-label-close-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-label-close)')}
        >
          Ok
        </button>
      </div>
    </div>
  );
}
