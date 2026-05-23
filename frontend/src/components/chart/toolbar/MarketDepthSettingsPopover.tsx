import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useStore } from '../../../store/useStore';
import { RADIUS, Z, SHADOW } from '../../../constants/layout';
import { ColorSwatchButton } from '../ColorPopover';
import { DropdownButton } from '../../shared/DropdownButton';
import { SpinnerInput } from '../../SpinnerInput';
import { Popover } from '../../shared/Popover';

interface MarketDepthSettingsPopoverProps {
  onClose: () => void;
}

export function MarketDepthSettingsPopover({ onClose }: MarketDepthSettingsPopoverProps) {
  const isLeft = useStore((s) => s.selectedChart === 'left');

  // Read current values
  const domColor = useStore((s) => isLeft ? s.domColor : s.secondDomColor);
  const domHoverExpand = useStore((s) => isLeft ? s.domHoverExpand : s.secondDomHoverExpand);
  const domRowLayout = useStore((s) => isLeft ? s.domRowLayout : s.secondDomRowLayout);
  const domRowSize = useStore((s) => isLeft ? s.domRowSize : s.secondDomRowSize);
  const domBarPlacement = useStore((s) => isLeft ? s.domBarPlacement : s.secondDomBarPlacement);
  const domBarOffset = useStore((s) => isLeft ? s.domBarOffset : s.secondDomBarOffset);
  const domBarLength = useStore((s) => isLeft ? s.domBarLength : s.secondDomBarLength);

  // Setters
  const setDomColor = useStore((s) => isLeft ? s.setDomColor : s.setSecondDomColor);
  const setDomHoverExpand = useStore((s) => isLeft ? s.setDomHoverExpand : s.setSecondDomHoverExpand);
  const setDomRowLayout = useStore((s) => isLeft ? s.setDomRowLayout : s.setSecondDomRowLayout);
  const setDomRowSize = useStore((s) => isLeft ? s.setDomRowSize : s.setSecondDomRowSize);
  const setDomBarPlacement = useStore((s) => isLeft ? s.setDomBarPlacement : s.setSecondDomBarPlacement);
  const setDomBarOffset = useStore((s) => isLeft ? s.setDomBarOffset : s.setSecondDomBarOffset);
  const setDomBarLength = useStore((s) => isLeft ? s.setDomBarLength : s.setSecondDomBarLength);

  const [tab, setTab] = useState<'input' | 'style'>('input');

  // Snapshot for cancel
  const snapshot = useRef({
    domColor, domHoverExpand, domRowLayout, domRowSize,
    domBarPlacement, domBarOffset, domBarLength,
  });

  const handleCancel = () => {
    const s = snapshot.current;
    setDomColor(s.domColor);
    setDomHoverExpand(s.domHoverExpand);
    setDomRowLayout(s.domRowLayout);
    setDomRowSize(s.domRowSize);
    setDomBarPlacement(s.domBarPlacement);
    setDomBarOffset(s.domBarOffset);
    setDomBarLength(s.domBarLength);
    onClose();
  };

  // Dropdowns
  const [showRowDD, setShowRowDD] = useState(false);
  const [showPlacementDD, setShowPlacementDD] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const placementRef = useRef<HTMLDivElement>(null);
  useClickOutside(rowRef, showRowDD, useCallback(() => setShowRowDD(false), []));
  useClickOutside(placementRef, showPlacementDD, useCallback(() => setShowPlacementDD(false), []));

  // Styles
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
    <Popover
      title="Market Depth Settings"
      onClose={onClose}
      onCancel={handleCancel}
      width={380}
      persistKey="popover-market-depth"
    >
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 16, padding: '8px 24px 0' }}>
        <button style={tabBtn('input')} onClick={() => setTab('input')}>Input</button>
        <button style={tabBtn('style')} onClick={() => setTab('style')}>Style</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {tab === 'input' && (
          <>
            {/* Row Layout */}
            <div style={rowStyle}>
              <span style={labelStyle}>Row Layout</span>
              <div ref={rowRef} className="relative">
                <DropdownButton
                  open={showRowDD}
                  onClick={() => setShowRowDD((v) => !v)}
                  width={150}
                >
                  <span>{domRowLayout === 'count' ? 'Number of Rows' : 'Ticks per Row'}</span>
                </DropdownButton>
                {showRowDD && (
                  <div style={{ ...ddPanelStyle, width: 150 }} onClick={(e) => e.stopPropagation()}>
                    {([['count', 'Number of Rows'], ['price', 'Ticks per Row']] as [string, string][]).map(([m, label]) => {
                      const active = domRowLayout === m;
                      return (
                        <button
                          key={m}
                          onClick={() => {
                            if (!active) setDomRowLayout(m as 'count' | 'price');
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

            {/* Row Size */}
            <div style={rowStyle}>
              <span style={labelStyle}>Row Size</span>
              <SpinnerInput
                value={domRowSize}
                onChange={(v) => setDomRowSize(Math.max(1, v))}
                min={1}
                max={domRowLayout === 'count' ? 500 : 10000}
                step={1}
              />
            </div>
          </>
        )}

        {tab === 'style' && (
          <>
            {/* Color */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={labelStyle}>Color</span>
              <ColorSwatchButton color={domColor} onChange={setDomColor} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 14, columnGap: 8, alignItems: 'center' }}>

              {/* Hover Expand */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 7, userSelect: 'none', cursor: 'pointer' }}
                onClick={() => setDomHoverExpand(!domHoverExpand)}
              >
                <span style={{ ...checkboxSpan(domHoverExpand), cursor: 'pointer' }}>
                  {domHoverExpand && <Checkmark />}
                </span>
                <span style={labelStyle}>Highlight on Hover</span>
              </div>
              <div />

              {/* Placement */}
              <span style={labelStyle}>Placement</span>
              <div ref={placementRef} className="relative" style={{ justifySelf: 'end' }}>
                <DropdownButton
                  open={showPlacementDD}
                  onClick={() => setShowPlacementDD((v) => !v)}
                  minWidth={90}
                >
                  <span style={{ textTransform: 'capitalize' }}>{domBarPlacement}</span>
                </DropdownButton>
                {showPlacementDD && (
                  <div style={{ ...ddPanelStyle, minWidth: 90 }} onClick={(e) => e.stopPropagation()}>
                    {(['left', 'right', 'middle'] as const).map((p) => {
                      const active = domBarPlacement === p;
                      return (
                        <button
                          key={p}
                          onClick={() => { if (!active) setDomBarPlacement(p); setShowPlacementDD(false); }}
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

              {/* Offset */}
              <span style={labelStyle}>Offset</span>
              <div style={{ justifySelf: 'end' }}>
                <SpinnerInput
                  value={domBarOffset}
                  onChange={(v) => setDomBarOffset(Math.max(0, v))}
                  min={0} max={200} step={1} inputWidth={74}
                />
              </div>

              {/* Length % */}
              <span style={labelStyle}>Length %</span>
              <div style={{ justifySelf: 'end' }}>
                <SpinnerInput
                  value={domBarLength}
                  onChange={(v) => setDomBarLength(Math.min(100, Math.max(1, v)))}
                  min={1} max={100} step={1} inputWidth={74}
                />
              </div>

            </div>
          </>
        )}
      </div>
    </Popover>
  );
}
