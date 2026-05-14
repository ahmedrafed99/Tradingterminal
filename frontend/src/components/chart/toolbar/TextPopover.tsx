import { useState, useEffect, useRef, useCallback } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { FONT_FAMILY, RADIUS, Z, SHADOW } from '../../../constants/layout';
import { DropdownButton } from '../../shared/DropdownButton';
import type { Drawing, TextHAlign, TextVAlign } from '../../../types/drawing';
import { FONT_SIZE_OPTIONS } from '../../../types/drawing';
import { ColorSwatchButton } from '../ColorPopover';
import { Popover } from '../../shared/Popover';

export function TextPopover({
  drawing,
  onUpdate,
  onClose,
}: {
  drawing: Drawing;
  onUpdate: (patch: Partial<Drawing>) => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState(drawing.text?.content ?? '');
  const [color, setColor] = useState(drawing.text?.color ?? '#ffffff');
  const [fontSize, setFontSize] = useState(drawing.text?.fontSize ?? 12);
  const [bold, setBold] = useState(drawing.text?.bold ?? true);
  const [italic, setItalic] = useState(drawing.text?.italic ?? false);
  const [hAlign, setHAlign] = useState<TextHAlign>(drawing.text?.hAlign ?? 'center');
  const [vAlign, setVAlign] = useState<TextVAlign>(drawing.text?.vAlign ?? 'middle');
  const [showFontSizes, setShowFontSizes] = useState(false);
  const fontSizeRef = useRef<HTMLDivElement>(null);

  const originalText = useRef(drawing.text ? { ...drawing.text } : null);

  useEffect(() => {
    onUpdate({ text: { content: content.trim(), color, fontSize, bold, italic, hAlign, vAlign } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, color, fontSize, bold, italic, hAlign, vAlign]);

  const closeFontSizes = useCallback(() => setShowFontSizes(false), []);
  useClickOutside(fontSizeRef, showFontSizes, closeFontSizes);

  const cancel = () => {
    onUpdate({ text: originalText.current });
    onClose();
  };

  const toggleBtn = (active: boolean): React.CSSProperties => ({
    width: 34,
    height: 34,
    borderRadius: RADIUS.LG,
    border: '1px solid var(--color-border)',
    outline: 'none',
    cursor: 'pointer',
    background: active ? 'var(--color-input)' : 'transparent',
    color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast)',
  });
  const toggleHover = (active: boolean) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!active) {
        e.currentTarget.style.background = 'var(--color-hover-row)';
        e.currentTarget.style.color = 'var(--color-text)';
      }
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!active) {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--color-text-muted)';
      }
    },
  });

  return (
    <Popover title="Text" onClose={onClose} onCancel={cancel} width={460} minHeight={540}>
      {/* Body */}
      <div style={{ flex: 1, padding: '4px 24px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly' }}>
        {/* Row 1: Color swatch + Font size + Bold + Italic */}
        <div className="flex items-center" style={{ gap: 8 }}>
          <ColorSwatchButton color={color} onChange={setColor} />
          {/* Font size dropdown */}
          <div ref={fontSizeRef} style={{ position: 'relative' }}>
            <DropdownButton open={showFontSizes} onClick={() => setShowFontSizes((o) => !o)} width={56} title="Font size">
              {fontSize}
            </DropdownButton>
            {showFontSizes && (
              <div
                className="border border-(--color-border) rounded-lg shadow-lg animate-dropdown-in"
                style={{ zIndex: Z.DROPDOWN,
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  background: 'var(--color-surface)',
                  boxShadow: SHADOW.LG,
                  minWidth: 56,
                  padding: '2px 0',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {FONT_SIZE_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setFontSize(s); setShowFontSizes(false); }}
                    className={`flex items-center w-full rounded-lg transition-colors text-left ${s === fontSize ? '' : 'text-(--color-text) hover:bg-(--color-hover-row)'}`}
                    style={{
                      padding: '7px 10px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 600,
                      ...(s === fontSize ? { background: 'var(--color-text)', color: 'var(--color-surface)' } : {}),
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Bold */}
          <button
            onClick={() => setBold(!bold)}
            style={{ ...toggleBtn(bold), fontSize: 14, fontWeight: 700 }}
            className="focus:outline-none focus:ring-0"
            title="Bold"
            {...toggleHover(bold)}
          >
            B
          </button>
          {/* Italic */}
          <button
            onClick={() => setItalic(!italic)}
            style={{ ...toggleBtn(italic), fontSize: 14, fontStyle: 'italic' }}
            className="focus:outline-none focus:ring-0"
            title="Italic"
            {...toggleHover(italic)}
          >
            I
          </button>
        </div>

        {/* Row 2: Textarea */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="text"
          className="w-full text-(--color-text) rounded outline-none"
          style={{
            padding: '10px 12px',
            resize: 'none',
            minHeight: 120,
            fontFamily: FONT_FAMILY,
            fontSize: 13,
            lineHeight: '1.5',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            borderRadius: RADIUS.XL,
          }}
          autoFocus
        />

        {/* Row 3: Text position */}
        <div>
          <div style={{ fontSize: 13, color: 'var(--color-text)', marginBottom: 14 }}>Text position</div>
          <div style={{
            position: 'relative',
            width: '100%',
            height: 90,
            borderRadius: RADIUS.LG,
            overflow: 'hidden',
          }}>
            {/* Price line */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: 8,
              right: 8,
              height: 1,
              background: color,
              opacity: 0.4,
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }} />

            {/* Text preview */}
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center',
              justifyContent: hAlign === 'left' ? 'flex-start' : hAlign === 'right' ? 'flex-end' : 'center',
              padding: '6px 10px',
              pointerEvents: 'none',
            }}>
              <span style={{
                fontSize: 11,
                fontFamily: FONT_FAMILY,
                color: color,
                opacity: 0.9,
                whiteSpace: 'nowrap',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {(content.trim().split(/\s+/)[0]) || 'text'}
              </span>
            </div>

            {/* 3×3 clickable zones */}
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gridTemplateRows: '1fr 1fr 1fr',
            }}>
              {(['top', 'middle', 'bottom'] as TextVAlign[]).flatMap((v) =>
                (['left', 'center', 'right'] as TextHAlign[]).map((h) => {
                  const active = vAlign === v && hAlign === h;
                  return (
                    <button
                      key={`${v}-${h}`}
                      onClick={() => { setVAlign(v); setHAlign(h); }}
                      title={`${v} ${h}`}
                      style={{
                        background: active ? `${color}18` : 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: v === 'top' ? 'flex-start' : v === 'bottom' ? 'flex-end' : 'center',
                        justifyContent: h === 'left' ? 'flex-start' : h === 'right' ? 'flex-end' : 'center',
                        padding: 5,
                        transition: 'background var(--transition-fast)',
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--color-hover-row)'; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {!active && (
                        <span style={{
                          width: 3,
                          height: 3,
                          borderRadius: RADIUS.CIRCLE,
                          background: 'var(--color-text-dim)',
                          flexShrink: 0,
                        }} />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </Popover>
  );
}
