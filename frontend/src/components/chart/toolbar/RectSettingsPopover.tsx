import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { RADIUS, Z, SHADOW } from '../../../constants/layout';
import type { RectDrawing } from '../../../types/drawing';
import { ColorSwatchButton } from '../ColorPopover';
import { LINE_STYLE_DEFS } from './lineStyleDefs';
import { Popover } from '../../shared/Popover';

export function RectSettingsPopover({
  drawing,
  onUpdate,
  onClose,
}: {
  drawing: RectDrawing;
  onUpdate: (patch: Partial<RectDrawing>) => void;
  onClose: () => void;
}) {
  const snapshot = useRef<Partial<RectDrawing>>({
    extendMode: drawing.extendMode,
    middleLine: drawing.middleLine,
    middleLineColor: drawing.middleLineColor,
    middleLineStyle: drawing.middleLineStyle,
  });

  const [showMlStyle, setShowMlStyle] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const mlStyleRef = useRef<HTMLDivElement>(null);
  const extendRef = useRef<HTMLDivElement>(null);
  const closeMlStyle = useCallback(() => setShowMlStyle(false), []);
  const closeExtend = useCallback(() => setShowExtend(false), []);
  useClickOutside(mlStyleRef, showMlStyle, closeMlStyle);
  useClickOutside(extendRef, showExtend, closeExtend);

  const extendMode   = drawing.extendMode ?? 'none';
  const extendRight  = extendMode === 'right' || extendMode === 'both';
  const extendLeft   = extendMode === 'left'  || extendMode === 'both';
  const mlEnabled    = drawing.middleLine ?? false;
  const mlColor      = drawing.middleLineColor ?? drawing.color;
  const mlStyle      = drawing.middleLineStyle ?? 'dashed';
  const currentStyleDef = LINE_STYLE_DEFS.find((d) => d.style === mlStyle) ?? LINE_STYLE_DEFS[0];

  const checkboxStyle = (checked: boolean): React.CSSProperties => ({
    width: 14, height: 14, borderRadius: 3,
    border: '1.5px solid var(--color-border)',
    background: checked ? '#ffffff' : 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'background var(--transition-fast)',
  });

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', minHeight: 34, gap: 10,
  };
  const labelStyle: React.CSSProperties = {
    color: 'var(--color-text)', fontSize: 13, whiteSpace: 'nowrap',
  };

  const handleCancel = () => {
    onUpdate(snapshot.current);
    onClose();
  };

  return (
    <Popover title="Rectangle" onClose={onClose} onCancel={handleCancel} width={440} minHeight={360}>
      {/* Body */}
      <div style={{ flex: 1, padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Extend row */}
        <div className="flex items-center" style={{ minHeight: 34, gap: 10 }}>
          <span style={{ ...labelStyle, flexShrink: 0, width: 90 }}>Extend</span>
          <div ref={extendRef} className="relative" style={{ flex: 1 }}>
            <button
              onClick={() => setShowExtend((v) => !v)}
              className="focus:outline-none focus:ring-0"
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'var(--color-surface)', color: 'var(--color-text)',
                border: '1px solid var(--color-border)', borderRadius: RADIUS.XL,
                padding: '4px 10px', fontSize: 13, cursor: 'pointer',
                transition: 'border-color var(--transition-fast)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
            >
              <span>{extendRight && extendLeft ? 'Both' : extendRight ? 'Extend right' : extendLeft ? 'Extend left' : 'None'}</span>
              <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0, transform: showExtend ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}>
                <path d="M0 0l4 5 4-5z" />
              </svg>
            </button>
            {showExtend && (
              <div
                className="absolute border border-(--color-border) rounded-lg shadow-lg animate-dropdown-in"
                style={{ zIndex: Z.DROPDOWN + 1, top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--color-surface)', boxShadow: SHADOW.LG, padding: '4px 0' }}
                onClick={(e) => e.stopPropagation()}
              >
                {([['right', 'Extend right', extendRight, extendLeft], ['left', 'Extend left', extendLeft, extendRight]] as const).map(
                  ([dir, label, checked, other]) => (
                    <label
                      key={dir}
                      className="flex items-center hover:bg-(--color-border)/50 transition-colors"
                      style={{ gap: 8, cursor: 'pointer', userSelect: 'none', padding: '7px 10px' }}
                      onClick={() => onUpdate({ extendMode: checked ? (other ? (dir === 'right' ? 'left' : 'right') : 'none') : (other ? 'both' : dir) })}
                    >
                      <span style={checkboxStyle(checked)}>
                        {checked && (
                          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                            <path d="M1 3.5L3.5 6L8 1" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span style={labelStyle}>{label}</span>
                    </label>
                  )
                )}
              </div>
            )}
          </div>
        </div>

        {/* Middle line row */}
        <div style={rowStyle}>
          <div className="flex items-center" style={{ gap: 8, width: 90, flexShrink: 0, userSelect: 'none' }}>
            <span
              style={{ ...checkboxStyle(mlEnabled), cursor: 'pointer' }}
              onClick={() => onUpdate({ middleLine: !mlEnabled })}
            >
              {mlEnabled && (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                  <path d="M1 3.5L3.5 6L8 1" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span style={labelStyle}>Middle line</span>
          </div>

          <div style={{ flexShrink: 0, opacity: mlEnabled ? 1 : 0.35, pointerEvents: mlEnabled ? 'auto' : 'none', transition: 'opacity var(--transition-fast)' }}>
            <ColorSwatchButton color={mlColor} onChange={(color) => onUpdate({ middleLineColor: color })} />
          </div>

          <div
            ref={mlStyleRef}
            className="relative"
            style={{ flexShrink: 0, opacity: mlEnabled ? 1 : 0.35, pointerEvents: mlEnabled ? 'auto' : 'none', transition: 'opacity var(--transition-fast)' }}
          >
            <button
              onClick={() => setShowMlStyle((v) => !v)}
              className="focus:outline-none focus:ring-0"
              style={{
                background: 'transparent',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: RADIUS.XL,
                height: 30,
                padding: '0 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                transition: 'border-color var(--transition-fast)',
              }}
              title="Line style"
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
            >
              <svg width="44" height="10" viewBox="0 0 44 10" style={{ flexShrink: 0 }} shapeRendering="crispEdges">
                <line
                  x1="2" y1="5" x2="42" y2="5"
                  stroke="currentColor" strokeWidth="1"
                  strokeDasharray={currentStyleDef.dasharray}
                  strokeLinecap={(currentStyleDef.linecap ?? 'butt') as React.SVGAttributes<SVGLineElement>['strokeLinecap']}
                />
              </svg>
              <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0, transform: showMlStyle ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}>
                <path d="M0 0l4 5 4-5z" />
              </svg>
            </button>
            {showMlStyle && (
              <div
                className="absolute border border-(--color-border) rounded-lg shadow-lg animate-dropdown-in"
                style={{
                  zIndex: Z.DROPDOWN + 1,
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  background: 'var(--color-surface)',
                  boxShadow: SHADOW.LG,
                  minWidth: 130,
                  padding: '2px 0',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {LINE_STYLE_DEFS.map(({ style, label, dasharray, linecap }) => {
                  const active = style === mlStyle;
                  return (
                    <button
                      key={style}
                      onClick={() => { onUpdate({ middleLineStyle: style }); setShowMlStyle(false); }}
                      className={`flex items-center w-full rounded-lg transition-colors text-left ${active ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
                      style={{ padding: '7px 10px', gap: 10, border: 'none', cursor: 'pointer', ...(active ? { background: 'var(--color-text)', color: 'var(--color-surface)' } : {}) }}
                    >
                      <svg width="50" height="10" viewBox="0 0 50 10" preserveAspectRatio="none" shapeRendering="crispEdges" style={{ flex: 1 }}>
                        <line
                          x1="0" y1="5" x2="50" y2="5"
                          stroke="currentColor" strokeWidth="1"
                          strokeDasharray={dasharray}
                          strokeLinecap={(linecap ?? 'butt') as React.SVGAttributes<SVGLineElement>['strokeLinecap']}
                        />
                      </svg>
                      <span style={{ fontSize: 12, flexShrink: 0, width: 42, textAlign: 'center' }}>{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </Popover>
  );
}
