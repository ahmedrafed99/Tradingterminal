import { useCallback, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { RADIUS, SHADOW, Z } from '../../constants/layout';
import type { Drawing, FRVPDrawing, HLineTemplate, LineStyle, RectDrawing } from '../../types/drawing';
import { ColorPopover } from './ColorPopover';
import { TextPopover } from './toolbar/TextPopover';
import { StrokePopover } from './toolbar/StrokePopover';
import { TemplatePopover } from './toolbar/TemplatePopover';
import { RectSettingsPopover } from './toolbar/RectSettingsPopover';
import { FRVPToolbarPanel } from './toolbar/FRVPToolbarPanel';

function Divider() {
  return <div style={{ width: 1, height: 20, background: 'var(--color-text-dim)', flexShrink: 0 }} />;
}

export function DrawingEditToolbar({
  contractId,
}: {
  contractId: string | undefined;
}) {
  const selectedIds = useStore((s) => s.selectedDrawingIds);
  const drawings = useStore((s) => s.drawings);
  const updateDrawing = useStore((s) => s.updateDrawing);
  const removeDrawing = useStore((s) => s.removeDrawing);
  const removeDrawings = useStore((s) => s.removeDrawings);
  const setSelectedDrawingIds = useStore((s) => s.setSelectedDrawingIds);
  const contract = useStore((s) => {
    if (s.contract?.id === contractId) return s.contract;
    if (s.secondContract?.id === contractId) return s.secondContract;
    return null;
  });
  const autoTickSize = contract?.tickSize ?? 0.25;

  const [showColor, setShowColor] = useState(false);
  const [showFillColor, setShowFillColor] = useState(false);
  const [showText, setShowText] = useState(false);
  const [showStroke, setShowStroke] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showRectSettings, setShowRectSettings] = useState(false);
  const [frvpTab, setFrvpTab] = useState<'input' | 'style' | null>(null);

  const toolbarRef = useRef<HTMLDivElement>(null);

  const isMulti = selectedIds.length > 1;
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const drawing = selectedId ? drawings.find((d) => d.id === selectedId && d.contractId === contractId) : null;
  const multiDrawings = isMulti ? drawings.filter((d) => selectedIds.includes(d.id) && d.contractId === contractId) : [];

  const closeAll = useCallback(() => {
    setShowColor(false);
    setShowFillColor(false);
    setShowText(false);
    setShowStroke(false);
    setShowTemplate(false);
    setShowRectSettings(false);
    setFrvpTab(null);
  }, []);

  if (!drawing && !isMulti) return null;
  if (isMulti && multiDrawings.length === 0) return null;

  const btnBase = 'relative flex items-center justify-center w-8 h-8 rounded-md border-none bg-transparent cursor-pointer text-(--color-text) transition-colors duration-150';
  const btnHover = 'hover:bg-(--color-border)/50 hover:text-(--color-text)';
  const btnActive = 'bg-(--color-hover-toolbar) text-white hover:bg-(--color-border)/50';

  const toolbarStyle = {
    zIndex: Z.TOOLBAR_EDIT,
    left: '10%',
    top: '10%',
    padding: '4px 6px',
    gap: 4,
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: RADIUS.XL,
    boxShadow: SHADOW.LG,
  } as const;

  const onMouseDownToolbar = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(e.target as HTMLElement).closest('button, input, select, textarea')) {
      setSelectedDrawingIds([]);
    }
  };

  // Multi-selection toolbar
  if (isMulti) {
    return (
      <div
        ref={toolbarRef}
        className="absolute flex items-center pointer-events-auto animate-toolbar-in"
        style={toolbarStyle}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={onMouseDownToolbar}
      >
        <span className="text-xs text-(--color-text-muted)" style={{ padding: '0 8px' }}>
          {multiDrawings.length} selected
        </span>
        <Divider />
        <button
          onClick={() => { removeDrawings(selectedIds); setSelectedDrawingIds([]); }}
          className={`${btnBase} hover:bg-(--color-border)/50 hover:text-(--color-error)`}
          title="Delete selected"
        >
          <TrashIcon />
        </button>
      </div>
    );
  }

  if (!drawing) return null;

  return (
    <div
      ref={toolbarRef}
      className="absolute flex items-center pointer-events-auto animate-toolbar-in"
      style={toolbarStyle}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={onMouseDownToolbar}
    >
      {drawing.type === 'frvp' ? (
        <FRVPToolbarPanel
          frvp={drawing as FRVPDrawing}
          drawingId={drawing.id}
          frvpTab={frvpTab}
          setFrvpTab={setFrvpTab}
          closeAll={closeAll}
          updateDrawing={updateDrawing}
          autoTickSize={autoTickSize}
        />
      ) : (
        <>
          {/* Color picker */}
          <div className="relative">
            <button
              onClick={() => { const v = !showColor; closeAll(); setShowColor(v); }}
              className={`${btnBase} ${showColor ? btnActive : btnHover}`}
              title="Color"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" shapeRendering="geometricPrecision" fill="currentColor">
                <path d="M10.62.72a2.47 2.47 0 0 1 3.5 0l1.16 1.16c.96.97.96 2.54 0 3.5l-.58.58-8.9 8.9-1 1-.14.14H0v-4.65l.14-.15 1-1 8.9-8.9.58-.58Zm2.8.7a1.48 1.48 0 0 0-2.1 0l-.23.23 3.26 3.26.23-.23c.58-.58.58-1.52 0-2.1l-1.16-1.16Zm.23 4.2-3.26-3.27-8.2 8.2 3.25 3.27 8.2-8.2Zm-8.9 8.9-3.27-3.26-.5.5V15h3.27l.5-.5Z" />
              </svg>
              <div style={{
                position: 'absolute', bottom: 4, right: 4,
                width: 8, height: 8, borderRadius: RADIUS.CIRCLE,
                background: drawing.color, border: '1px solid var(--color-border)',
              }} />
            </button>
            {showColor && (
              <ColorPopover
                current={drawing.color}
                onChange={(color) => updateDrawing(drawing.id, { color })}
                onClose={() => setShowColor(false)}
              />
            )}
          </div>

          {/* Fill color (rect & oval) */}
          {(drawing.type === 'rect' || drawing.type === 'oval') && (
            <>
              <Divider />
              <div className="relative">
                <button
                  onClick={() => { const v = !showFillColor; closeAll(); setShowFillColor(v); }}
                  className={`${btnBase} ${showFillColor ? btnActive : btnHover}`}
                  title="Fill color"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" shapeRendering="geometricPrecision" fill="none">
                    <path stroke="currentColor" d="M13.5 6.5l-3-3-7 7 7.59 7.59a2 2 0 0 0 2.82 0l4.18-4.18a2 2 0 0 0 0-2.82L13.5 6.5zm0 0v-4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6" />
                    <path fill="currentColor" d="M0 16.5C0 15 2.5 12 2.5 12S5 15 5 16.5 4 19 2.5 19 0 18 0 16.5z" />
                    <circle fill="currentColor" cx="9.5" cy="9.5" r="1.5" />
                  </svg>
                  <div style={{
                    position: 'absolute', bottom: 4, right: 4,
                    width: 8, height: 8, borderRadius: RADIUS.CIRCLE,
                    background: (drawing as any).fillColor || 'transparent',
                    border: '1px solid var(--color-border)',
                  }} />
                </button>
                {showFillColor && (
                  <ColorPopover
                    current={(drawing as any).fillColor || 'rgba(255,152,0,0.15)'}
                    onChange={(color) => updateDrawing(drawing.id, { fillColor: color } as Partial<Drawing>)}
                    onClose={() => setShowFillColor(false)}
                  />
                )}
              </div>
            </>
          )}

          {/* Text (not shown for freedraw) */}
          {drawing.type !== 'freedraw' && (
            <>
              <Divider />
              <div className="relative">
                <button
                  onClick={() => { const v = !showText; closeAll(); setShowText(v); }}
                  className={`${btnBase} ${showText ? btnActive : btnHover}`}
                  title="Text"
                >
                  <svg width="14" height="16" viewBox="0 0 13 15" shapeRendering="geometricPrecision" fill="none">
                    <path stroke="currentColor" d="M4 14.5h2.5m2.5 0H6.5m0 0V.5m0 0h-5a1 1 0 0 0-1 1V4m6-3.5h5a1 1 0 0 1 1 1V4" />
                  </svg>
                  <div style={{
                    position: 'absolute', bottom: 4, right: 4,
                    width: 8, height: 8, borderRadius: RADIUS.CIRCLE,
                    background: drawing.text?.color ?? '#ffffff', border: '1px solid var(--color-border)',
                  }} />
                </button>
                {showText && (
                  <TextPopover
                    drawing={drawing}
                    onUpdate={(patch) => updateDrawing(drawing.id, patch)}
                    onClose={() => setShowText(false)}
                  />
                )}
              </div>
            </>
          )}

          <Divider />

          {/* Stroke width / style */}
          <div className="relative">
            <button
              onClick={() => { const v = !showStroke; closeAll(); setShowStroke(v); }}
              className={`${btnBase} !w-auto ${showStroke ? btnActive : btnHover}`}
              style={{ padding: '0 8px', gap: 6 }}
              title="Line style"
            >
              {(() => {
                const sw = drawing.strokeWidth;
                const h = sw + 6;
                const ls = (drawing as { lineStyle?: LineStyle }).lineStyle ?? 'solid';
                const dasharray = ls === 'dashed' ? `${sw * 4} ${sw * 3}` : ls === 'dotted' ? `${sw * 1.2} ${sw * 2.5}` : undefined;
                const linecap = ls === 'dotted' ? 'round' : 'butt';
                return (
                  <svg width="22" height={h} viewBox={`0 0 22 ${h}`} style={{ flexShrink: 0 }}>
                    <line x1="0" y1={h / 2} x2="22" y2={h / 2}
                      stroke="currentColor" strokeWidth={sw}
                      strokeDasharray={dasharray}
                      strokeLinecap={linecap as React.SVGAttributes<SVGLineElement>['strokeLinecap']}
                    />
                  </svg>
                );
              })()}
              <span style={{ fontSize: 13, fontWeight: 500 }}>{drawing.strokeWidth}px</span>
            </button>
            {showStroke && (
              <StrokePopover
                currentWidth={drawing.strokeWidth}
                currentStyle={(drawing as { lineStyle?: LineStyle }).lineStyle ?? 'solid'}
                onChange={(patch) => updateDrawing(drawing.id, patch)}
                onClose={() => setShowStroke(false)}
              />
            )}
          </div>

          {/* Extend left toggle (hline only) */}
          {drawing.type === 'hline' && (
            <>
              <Divider />
              <button
                onClick={() => updateDrawing(drawing.id, { extendLeft: drawing.extendLeft === false ? true : false })}
                className={`${btnBase} ${drawing.extendLeft === false ? btnActive : btnHover}`}
                title={drawing.extendLeft === false ? 'Extend to full width' : 'Start from click point'}
              >
                {drawing.extendLeft === false ? (
                  <svg width="22" height="22" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor" fillRule="nonzero">
                    <path d="M4 15h8.5v-1h-8.5zM16.5 15h8.5v-1h-8.5z" />
                    <path d="M14.5 16c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor" fillRule="nonzero">
                    <path d="M8.5 15h16.5v-1h-16.5z" />
                    <path d="M6.5 16c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z" />
                  </svg>
                )}
              </button>
            </>
          )}

          {/* Template dropdown (hline only) */}
          {drawing.type === 'hline' && (
            <>
              <Divider />
              <div className="relative">
                <button
                  onClick={() => { const v = !showTemplate; closeAll(); setShowTemplate(v); }}
                  className={`${btnBase} !w-auto ${showTemplate ? btnActive : btnHover}`}
                  style={{ padding: '0 8px', gap: 4, fontSize: 11, fontWeight: 500 }}
                  title="Template"
                >
                  <span>Template</span>
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
                    style={{ transform: showTemplate ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}
                  >
                    <path d="M2.5 4L5 6.5L7.5 4" />
                  </svg>
                </button>
                {showTemplate && (
                  <TemplatePopover
                    drawing={drawing}
                    onApply={(t: HLineTemplate) => updateDrawing(drawing.id, { color: t.color, strokeWidth: t.strokeWidth, lineStyle: t.lineStyle ?? 'solid', text: t.text })}
                    onClose={() => setShowTemplate(false)}
                  />
                )}
              </div>
            </>
          )}

          {/* Rect settings */}
          {drawing.type === 'rect' && (
            <>
              <Divider />
              <div className="relative">
                <button
                  onClick={() => { const v = !showRectSettings; closeAll(); if (v) setShowRectSettings(true); }}
                  className={`${btnBase} ${showRectSettings ? btnActive : btnHover}`}
                  title="Rectangle settings"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <polygon points="8,1 13.66,4.25 13.66,11.75 8,15 2.34,11.75 2.34,4.25" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
                    <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
                  </svg>
                </button>
                {showRectSettings && (
                  <RectSettingsPopover
                    drawing={drawing as RectDrawing}
                    onUpdate={(patch) => updateDrawing(drawing.id, patch as Partial<Drawing>)}
                    onClose={() => setShowRectSettings(false)}
                  />
                )}
              </div>
            </>
          )}
        </>
      )}

      <Divider />

      {/* Delete */}
      <button
        onClick={() => { removeDrawing(drawing.id); setSelectedDrawingIds([]); }}
        className={`${btnBase} hover:bg-(--color-border)/50 hover:text-(--color-error)`}
        title="Delete"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor">
      <path d="M18 7h5v1h-2.01l-1.33 14.64a1.5 1.5 0 0 1-1.5 1.36H9.84a1.5 1.5 0 0 1-1.49-1.36L7.01 8H5V7h5V6c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v1Zm-6-2a1 1 0 0 0-1 1v1h6V6a1 1 0 0 0-1-1h-4ZM8.02 8l1.32 14.54a.5.5 0 0 0 .5.46h8.33a.5.5 0 0 0 .5-.46L19.99 8H8.02Z" />
    </svg>
  );
}
