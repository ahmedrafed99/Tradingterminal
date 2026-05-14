import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useDraggable } from '../../../hooks/useDraggable';
import { RADIUS, Z, SHADOW } from '../../../constants/layout';
import type { RectDrawing } from '../../../types/drawing';
import { ColorSwatchButton } from '../ColorPopover';
import { LINE_STYLE_DEFS } from './lineStyleDefs';

export function RectSettingsPopover({
  drawing,
  onUpdate,
  onClose,
}: {
  drawing: RectDrawing;
  onUpdate: (patch: Partial<RectDrawing>) => void;
  onClose: () => void;
}) {
  const { ref, onDragMouseDown, dragStyle } = useDraggable<HTMLDivElement>();
  useClickOutside(ref, true, onClose);

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
    <div
      ref={ref}
      className="fixed bg-(--color-surface) border border-(--color-border) rounded-xl shadow-lg"
      style={{ zIndex: Z.DROPDOWN, width: 440, minHeight: 360, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', ...dragStyle }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.stopPropagation();
        const t = e.target as Node;
        if (showExtend && extendRef.current && !extendRef.current.contains(t)) setShowExtend(false);
        if (showMlStyle && mlStyleRef.current && !mlStyleRef.current.contains(t)) setShowMlStyle(false);
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 10px', cursor: 'grab' }} onMouseDown={onDragMouseDown}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>Rectangle</span>
        <button
          onClick={onClose}
          className="focus:outline-none focus:ring-0"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: RADIUS.MD,
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--color-text-muted)', fontSize: 16, lineHeight: 1,
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

      {/* Footer */}
      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />
      <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button
          onClick={handleCancel}
          className="text-(--color-text) rounded"
          style={{
            fontSize: 13,
            padding: '5px 16px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            cursor: 'pointer',
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-hover-toolbar)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-surface)')}
        >
          Cancel
        </button>
        <button
          onClick={onClose}
          className="rounded"
          style={{
            fontSize: 13,
            padding: '5px 16px',
            background: 'var(--color-label-close)',
            color: 'var(--color-label-text)',
            border: 'none',
            cursor: 'pointer',
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-label-close-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-label-close)')}
        >
          Ok
        </button>
      </div>
    </div>
  );
}
