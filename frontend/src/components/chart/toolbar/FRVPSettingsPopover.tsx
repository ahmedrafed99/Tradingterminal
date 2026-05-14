import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useStore } from '../../../store/useStore';
import { RADIUS, Z, SHADOW } from '../../../constants/layout';
import type { Drawing, FRVPDrawing } from '../../../types/drawing';
import { ColorSwatchButton } from '../ColorPopover';
import { COLOR_ACCENT } from '../../../constants/colors';
import { DropdownButton } from '../../shared/DropdownButton';
import { SpinnerInput } from '../../SpinnerInput';
import { Popover } from '../../shared/Popover';

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
  const [tab, setTab] = useState<'input' | 'style'>('input');

  const snapshot = useRef<Partial<FRVPDrawing>>({
    mode: frvp.mode, t2: frvp.t2, t2Auto: frvp.t2Auto,
    numBars: frvp.numBars, rowSizeMode: frvp.rowSizeMode, rowSizePrice: frvp.rowSizePrice,
    volumeType: frvp.volumeType,
    showProfile: frvp.showProfile, color: frvp.color, barPlacement: frvp.barPlacement,
    barOffset: frvp.barOffset, barLength: frvp.barLength,
    showBarValues: frvp.showBarValues, valuesMode: frvp.valuesMode, valuesColor: frvp.valuesColor, valuesBgColor: frvp.valuesBgColor, highlightOnHover: frvp.highlightOnHover,
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
  const [showValuesModeDD, setShowValuesModeDD] = useState(false);

  const modeRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const volTypeRef = useRef<HTMLDivElement>(null);
  const placementRef = useRef<HTMLDivElement>(null);
  const valuesModeRef = useRef<HTMLDivElement>(null);

  useClickOutside(modeRef, showModeDD, useCallback(() => setShowModeDD(false), []));
  useClickOutside(rowRef, showRowDD, useCallback(() => setShowRowDD(false), []));
  useClickOutside(volTypeRef, showVolTypeDD, useCallback(() => setShowVolTypeDD(false), []));
  useClickOutside(placementRef, showPlacementDD, useCallback(() => setShowPlacementDD(false), []));
  useClickOutside(valuesModeRef, showValuesModeDD, useCallback(() => setShowValuesModeDD(false), []));

  const profileVisible = frvp.showProfile !== false;
  const pocVisible = frvp.showPoc !== false;

  const labelStyle: React.CSSProperties = {
    fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap', width: 90, flexShrink: 0,
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
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
  const ddPanelStyle: React.CSSProperties = {
    position: 'absolute', zIndex: Z.DROPDOWN + 1,
    top: '100%', left: 0, marginTop: 4,
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
    <Popover title="FRVP Settings" onClose={onClose} onCancel={handleCancel} width={440} persistKey="popover-frvp">
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
                <DropdownButton open={showModeDD} onClick={() => { setShowRowDD(false); setShowModeDD((v) => !v); }} minWidth={100}>
                  <span>{(frvp.mode ?? 'anchor') === 'anchor' ? 'Anchor' : 'Range'}</span>
                </DropdownButton>
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
                <DropdownButton open={showRowDD} onClick={() => { setShowModeDD(false); setShowRowDD((v) => !v); }} width={150}>
                  <span>{(frvp.rowSizeMode ?? 'count') === 'count' ? 'Number of Rows' : 'Ticks per Row'}</span>
                </DropdownButton>
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
                <DropdownButton open={showVolTypeDD} onClick={() => { setShowModeDD(false); setShowRowDD(false); setShowVolTypeDD((v) => !v); }} width={150}>
                  <span>Total Volume</span>
                </DropdownButton>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, userSelect: 'none' }}>
                <span style={{ ...checkboxSpan(profileVisible), cursor: 'pointer' }} onClick={() => updateDrawing(drawingId, { showProfile: !profileVisible } as Partial<Drawing>)}>{profileVisible && <Checkmark />}</span>
                <span style={labelStyle}>Volume Profile</span>
              </div>
              <ColorSwatchButton color={frvp.color} onChange={(color) => updateDrawing(drawingId, { color } as Partial<Drawing>)} />
            </div>

            {/* Sub-rows — single grid so every right-column item shares the same left edge */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 14, columnGap: 8, alignItems: 'center', paddingLeft: 21, opacity: profileVisible ? 1 : 0.35, pointerEvents: profileVisible ? 'auto' : 'none', transition: 'opacity var(--transition-fast)' }}>

              {/* Values */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, userSelect: 'none' }}>
                <span style={{ ...checkboxSpan(!!frvp.showBarValues), cursor: 'pointer' }} onClick={() => updateDrawing(drawingId, { showBarValues: !frvp.showBarValues } as Partial<Drawing>)}>{frvp.showBarValues && <Checkmark />}</span>
                <span style={labelStyle}>Values</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: frvp.showBarValues ? 1 : 0.35, pointerEvents: frvp.showBarValues ? 'auto' : 'none', transition: 'opacity var(--transition-fast)' }}>
                <ColorSwatchButton color={frvp.valuesColor ?? '#ffffff'} onChange={(color) => updateDrawing(drawingId, { valuesColor: color } as Partial<Drawing>)} />
                <div ref={valuesModeRef} className="relative">
                  <DropdownButton open={showValuesModeDD} onClick={() => setShowValuesModeDD((v) => !v)} minWidth={90}>
                    <span>{(frvp.valuesMode ?? 'hover') === 'always' ? 'Always' : 'On Hover'}</span>
                  </DropdownButton>
                  {showValuesModeDD && (
                    <div style={{ ...ddPanelStyle, minWidth: 90 }} onClick={(e) => e.stopPropagation()}>
                      {(['hover', 'always'] as const).map((m) => {
                        const active = (frvp.valuesMode ?? 'hover') === m;
                        return (
                          <button key={m} onClick={() => { updateDrawing(drawingId, { valuesMode: m } as Partial<Drawing>); setShowValuesModeDD(false); }}
                            className={`flex items-center w-full rounded-lg transition-colors text-left ${active ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
                            style={ddItemStyle(active)}>
                            {m === 'always' ? 'Always' : 'On Hover'}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Background */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, userSelect: 'none', opacity: frvp.showBarValues ? 1 : 0.35, pointerEvents: frvp.showBarValues ? 'auto' : 'none', transition: 'opacity var(--transition-fast)' }}>
                <span style={{ ...checkboxSpan(!!frvp.valuesBgColor), cursor: 'pointer' }} onClick={() => updateDrawing(drawingId, { valuesBgColor: frvp.valuesBgColor ? undefined : 'rgba(0,0,0,0.55)' } as Partial<Drawing>)}>{frvp.valuesBgColor && <Checkmark />}</span>
                <span style={labelStyle}>Background</span>
              </div>
              <div style={{ opacity: frvp.showBarValues && frvp.valuesBgColor ? 1 : 0.35, pointerEvents: frvp.showBarValues && frvp.valuesBgColor ? 'auto' : 'none', transition: 'opacity var(--transition-fast)' }}>
                <ColorSwatchButton color={frvp.valuesBgColor ?? 'rgba(0,0,0,0.55)'} onChange={(color) => updateDrawing(drawingId, { valuesBgColor: color } as Partial<Drawing>)} />
              </div>

              {/* Highlight on Hover */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, userSelect: 'none' }}>
                <span style={{ ...checkboxSpan(frvp.highlightOnHover !== false), cursor: 'pointer' }} onClick={() => updateDrawing(drawingId, { highlightOnHover: !(frvp.highlightOnHover !== false) } as Partial<Drawing>)}>{frvp.highlightOnHover !== false && <Checkmark />}</span>
                <span style={labelStyle}>Highlight on Hover</span>
              </div>
              <div />

              {/* Placement */}
              <span style={labelStyle}>Placement</span>
              <div ref={placementRef} className="relative" style={{ justifySelf: 'end' }}>
                <DropdownButton open={showPlacementDD} onClick={() => setShowPlacementDD((v) => !v)} minWidth={90}>
                  <span style={{ textTransform: 'capitalize' }}>{frvp.barPlacement ?? 'left'}</span>
                </DropdownButton>
                {showPlacementDD && (
                  <div style={{ ...ddPanelStyle, minWidth: 90 }} onClick={(e) => e.stopPropagation()}>
                    {(['left', 'right', 'middle'] as const).map((p) => {
                      const active = (frvp.barPlacement ?? 'left') === p;
                      return (
                        <button key={p} onClick={() => { if (!active) updateDrawing(drawingId, { barPlacement: p } as Partial<Drawing>); setShowPlacementDD(false); }}
                          className={`flex items-center w-full rounded-lg transition-colors text-left ${active ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
                          style={{ ...ddItemStyle(active), textTransform: 'capitalize' }}>
                          {p}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Offset */}
              <span style={labelStyle}>Offset</span>
              <div style={{ justifySelf: 'end' }}>
                <SpinnerInput value={frvp.barOffset ?? 0} onChange={(v) => updateDrawing(drawingId, { barOffset: Math.max(0, v) } as Partial<Drawing>)} min={0} max={200} step={1} inputWidth={74} />
              </div>

              {/* Length % */}
              <span style={labelStyle}>Length %</span>
              <div style={{ justifySelf: 'end' }}>
                <SpinnerInput value={frvp.barLength ?? 50} onChange={(v) => updateDrawing(drawingId, { barLength: Math.min(100, Math.max(1, v)) } as Partial<Drawing>)} min={1} max={100} step={1} inputWidth={74} />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', margin: '2px 0' }} />

            {/* POC visibility + color swatch */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, userSelect: 'none' }}>
                <span style={{ ...checkboxSpan(pocVisible), cursor: 'pointer' }} onClick={() => updateDrawing(drawingId, { showPoc: !pocVisible } as Partial<Drawing>)}>{pocVisible && <Checkmark />}</span>
                <span style={labelStyle}>POC</span>
              </div>
              <ColorSwatchButton
                color={frvp.pocColor ?? COLOR_ACCENT}
                onChange={(color) => updateDrawing(drawingId, { pocColor: color } as Partial<Drawing>)}
                disabled={!pocVisible}
              />
            </div>

            {/* Extend — sub-row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, userSelect: 'none', paddingLeft: 21, opacity: pocVisible ? 1 : 0.4, pointerEvents: pocVisible ? 'auto' : 'none', transition: 'opacity var(--transition-fast)' }}>
              <span style={{ ...checkboxSpan(!!frvp.extendPoc), cursor: 'pointer' }} onClick={() => updateDrawing(drawingId, { extendPoc: !frvp.extendPoc } as Partial<Drawing>)}>{frvp.extendPoc && <Checkmark />}</span>
              <span style={labelStyle}>Extend</span>
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}
