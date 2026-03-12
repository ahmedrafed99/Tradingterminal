import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';
import type { Drawing, TextHAlign, TextVAlign, HLineTemplate } from '../../types/drawing';
import { STROKE_WIDTH_OPTIONS, FONT_SIZE_OPTIONS, DEFAULT_HLINE_COLOR } from '../../types/drawing';
import { ColorPopover, COLOR_PALETTE } from './ColorPopover';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TextColorGrid({
  color,
  setColor,
  customColorRef,
}: {
  color: string;
  setColor: (c: string) => void;
  customColorRef: React.RefObject<HTMLInputElement | null>;
}) {
  const customColors = useStore((s) => s.customColors);
  const addCustomColor = useStore((s) => s.addCustomColor);
  const removeCustomColor = useStore((s) => s.removeCustomColor);

  // Save custom color only on final selection (native 'change'), not during drag
  useEffect(() => {
    const input = customColorRef.current;
    if (!input) return;
    const handler = () => addCustomColor(input.value);
    input.addEventListener('change', handler);
    return () => input.removeEventListener('change', handler);
  }, [customColorRef, addCustomColor]);

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3, marginBottom: customColors.length > 0 ? 4 : 6 }}>
        {COLOR_PALETTE.flat().map((c, i) => (
          <button
            key={`txt-${c}-${i}`}
            onClick={() => setColor(c)}
            style={{
              width: 20,
              height: 20,
              background: c,
              borderRadius: 3,
              border: c === color ? '2px solid #fff' : '1px solid var(--color-border)',
              cursor: 'pointer',
              boxShadow: c === color ? '0 0 0 1px var(--color-surface)' : 'none',
            }}
          />
        ))}
      </div>
      {customColors.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
          {customColors.map((c, i) => (
            <div key={`txt-custom-${c}-${i}`} className="relative group">
              <button
                onClick={() => setColor(c)}
                style={{
                  width: 20,
                  height: 20,
                  background: c,
                  borderRadius: 3,
                  border: c === color ? '2px solid #fff' : '1px solid var(--color-border)',
                  cursor: 'pointer',
                  boxShadow: c === color ? '0 0 0 1px var(--color-surface)' : 'none',
                }}
              />
              <button
                onClick={(e) => { e.stopPropagation(); removeCustomColor(i); }}
                className="absolute opacity-0 group-hover:opacity-100"
                style={{
                  top: -4, right: -4, width: 12, height: 12,
                  borderRadius: '50%', background: '#000', border: '1px solid var(--color-text-dim)',
                  color: 'var(--color-text-muted)', fontSize: 8, lineHeight: '10px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'opacity 0.15s',
                }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => customColorRef.current?.click()}
        style={{
          width: 20,
          height: 20,
          borderRadius: 3,
          border: '1px dashed var(--color-text-muted)',
          background: 'transparent',
          color: 'var(--color-text-muted)',
          fontSize: 14,
          lineHeight: '18px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        +
      </button>
      <input
        ref={customColorRef}
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
      />
    </div>
  );
}

function TextPopover({
  drawing,
  onUpdate,
  onClose,
}: {
  drawing: Drawing;
  onUpdate: (patch: Partial<Drawing>) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const customColorRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState(drawing.text?.content ?? '');
  const [color, setColor] = useState(drawing.text?.color ?? '#ffffff');
  const [fontSize, setFontSize] = useState(drawing.text?.fontSize ?? 12);
  const [bold, setBold] = useState(drawing.text?.bold ?? true);
  const [italic, setItalic] = useState(drawing.text?.italic ?? false);
  const [hAlign, setHAlign] = useState<TextHAlign>(drawing.text?.hAlign ?? 'center');
  const [vAlign, setVAlign] = useState<TextVAlign>(drawing.text?.vAlign ?? 'middle');
  const [showColorGrid, setShowColorGrid] = useState(false);

  // Snapshot original text so we can restore on cancel
  const originalText = useRef(drawing.text ? { ...drawing.text } : null);

  // Live-preview: push changes to drawing whenever any field changes
  useEffect(() => {
    if (content.trim()) {
      onUpdate({ text: { content: content.trim(), color, fontSize, bold, italic, hAlign, vAlign } });
    } else {
      onUpdate({ text: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, color, fontSize, bold, italic, hAlign, vAlign]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  const apply = () => {
    // Changes already applied via live preview — just close
    onClose();
  };

  const cancel = () => {
    // Restore original text state
    onUpdate({ text: originalText.current });
    onClose();
  };

  const vAlignLabel: Record<TextVAlign, string> = { top: 'Top', middle: 'Middle', bottom: 'Bottom' };
  const hAlignLabel: Record<TextHAlign, string> = { left: 'Left', center: 'Center', right: 'Right' };

  const toggleBtn = (active: boolean): React.CSSProperties => ({
    width: 28,
    height: 28,
    borderRadius: 4,
    border: active ? '1px solid var(--color-text-dim)' : '1px solid transparent',
    cursor: 'pointer',
    background: active ? 'var(--color-input)' : 'transparent',
    color: active ? 'var(--color-warning)' : 'var(--color-text-muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
  });

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 border border-(--color-border) rounded-lg shadow-lg z-50"
      style={{ padding: 12, width: 290, background: '#000' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Row 1: Color swatch + Font size + Bold + Italic */}
      <div className="flex items-center" style={{ gap: 6, marginBottom: 8 }}>
        {/* Color swatch */}
        <button
          onClick={() => setShowColorGrid(!showColorGrid)}
          style={{
            width: 28,
            height: 28,
            background: color,
            borderRadius: 4,
            border: showColorGrid ? '2px solid #fff' : '1px solid var(--color-border)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'border-color 0.15s',
          }}
          title="Text color"
        />
        {/* Font size */}
        <select
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          style={{
            background: 'var(--color-input)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            padding: '4px 6px',
            fontSize: 12,
            cursor: 'pointer',
            width: 56,
            outline: 'none',
          }}
          title="Font size"
        >
          {FONT_SIZE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {/* Bold toggle */}
        <button
          onClick={() => setBold(!bold)}
          style={{ ...toggleBtn(bold), fontSize: 14, fontWeight: 700 }}
          title="Bold"
        >
          B
        </button>
        {/* Italic toggle */}
        <button
          onClick={() => setItalic(!italic)}
          style={{ ...toggleBtn(italic), fontSize: 14, fontStyle: 'italic' }}
          title="Italic"
        >
          I
        </button>
      </div>

      {/* Color palette grid (animated toggle) */}
      <div
        style={{
          overflow: 'hidden',
          maxHeight: showColorGrid ? 300 : 0,
          opacity: showColorGrid ? 1 : 0,
          transition: 'max-height 0.2s ease, opacity 0.15s ease',
        }}
      >
        <TextColorGrid
          color={color}
          setColor={setColor}
          customColorRef={customColorRef}
        />
      </div>

      {/* Row 2: Textarea */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="text"
        className="w-full text-(--color-text) text-xs rounded outline-none"
        style={{
          padding: '8px 10px',
          marginBottom: 8,
          resize: 'vertical',
          minHeight: 60,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
          fontSize: 12,
          lineHeight: '1.4',
          border: '1px solid var(--color-border)',
          background: 'var(--color-input)',
        }}
        autoFocus
      />

      {/* Row 3: Text alignment */}
      <div style={{ marginBottom: 10 }}>
        <div className={SECTION_LABEL} style={{ marginBottom: 6 }}>
          Text alignment
        </div>
        <div className="flex items-center" style={{ gap: 6 }}>
          {/* Vertical alignment buttons */}
          <div className="flex items-center" style={{ gap: 2, flex: 1 }}>
            {(['top', 'middle', 'bottom'] as TextVAlign[]).map((v) => (
              <button
                key={v}
                onClick={() => setVAlign(v)}
                style={{
                  ...toggleBtn(vAlign === v),
                  flex: 1,
                  width: 'auto',
                  height: 24,
                  padding: '0 6px',
                  fontSize: 11,
                  fontWeight: 400,
                  fontStyle: 'normal',
                }}
                title={`Vertical: ${vAlignLabel[v]}`}
              >
                {vAlignLabel[v]}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--color-border)', flexShrink: 0 }} />
          {/* Horizontal alignment buttons */}
          <div className="flex items-center" style={{ gap: 2, flex: 1 }}>
            {(['left', 'center', 'right'] as TextHAlign[]).map((h) => (
              <button
                key={h}
                onClick={() => setHAlign(h)}
                style={{
                  ...toggleBtn(hAlign === h),
                  flex: 1,
                  width: 'auto',
                  height: 24,
                  padding: '0 6px',
                  fontSize: 11,
                  fontWeight: 400,
                  fontStyle: 'normal',
                }}
                title={`Horizontal: ${hAlignLabel[h]}`}
              >
                {hAlignLabel[h]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Row 4: Cancel + Ok */}
      <div className="flex justify-end" style={{ gap: 6 }}>
        <button
          onClick={cancel}
          className="text-xs text-(--color-text) rounded"
          style={{
            padding: '5px 16px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-hover-toolbar)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-surface)')}
        >
          Cancel
        </button>
        <button
          onClick={apply}
          className="text-xs text-white rounded"
          style={{
            padding: '5px 16px',
            background: 'var(--color-focus-ring)',
            border: '1px solid transparent',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-accent-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-focus-ring)')}
        >
          Ok
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar separator
// ---------------------------------------------------------------------------
function Divider() {
  return <div style={{ width: 1, height: 20, background: 'var(--color-text-dim)', flexShrink: 0 }} />;
}

// ---------------------------------------------------------------------------
// Stroke width popover (visual line previews)
// ---------------------------------------------------------------------------
function StrokePopover({
  current,
  onChange,
  onClose,
}: {
  current: number;
  onChange: (w: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full left-1/2 mt-1 bg-black border border-(--color-border) rounded-lg shadow-lg z-50"
      style={{ transform: 'translateX(-50%)', padding: '6px 4px', width: 120 }}
      onClick={(e) => e.stopPropagation()}
    >
      {STROKE_WIDTH_OPTIONS.map((w) => (
        <button
          key={w}
          onClick={() => { onChange(w); onClose(); }}
          className="flex items-center w-full rounded hover:bg-(--color-hover-toolbar)"
          style={{
            padding: '6px 10px',
            gap: 10,
            cursor: 'pointer',
            background: w === current ? 'var(--color-hover-toolbar)' : 'transparent',
            border: 'none',
          }}
        >
          {/* Line preview */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '100%', height: w, background: 'var(--color-text)', borderRadius: w / 2 }} />
          </div>
          {/* Label */}
          <span style={{ color: 'var(--color-text-muted)', fontSize: 11, flexShrink: 0 }}>{w}px</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template popover (hline only)
// ---------------------------------------------------------------------------
function TemplatePopover({
  drawing,
  onApply,
  onClose,
}: {
  drawing: Drawing;
  onApply: (template: HLineTemplate) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const templates = useStore((s) => s.hlineTemplates);
  const addTemplate = useStore((s) => s.addHLineTemplate);
  const removeTemplate = useStore((s) => s.removeHLineTemplate);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    if (saving) nameRef.current?.focus();
  }, [saving]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // If a template with this name already exists, remove it first (override)
    const existing = templates.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) removeTemplate(existing.id);
    addTemplate({
      id: crypto.randomUUID(),
      name: trimmed,
      color: drawing.color,
      strokeWidth: drawing.strokeWidth,
      text: drawing.text ? { ...drawing.text } : null,
    });
    setSaving(false);
    setName('');
  };

  const suggestions = templates.filter(
    (t) => name.trim() && t.name.toLowerCase().includes(name.trim().toLowerCase())
  );

  const handleApplyDefaults = () => {
    onApply({ id: '', name: '', color: DEFAULT_HLINE_COLOR, strokeWidth: 1, text: null });
    onClose();
  };

  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const json = JSON.stringify(templates, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hline-templates.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (!Array.isArray(data)) return;
        for (const t of data) {
          if (t.name && t.color && typeof t.strokeWidth === 'number') {
            addTemplate({ ...t, id: crypto.randomUUID() });
          }
        }
      } catch { /* ignore malformed JSON */ }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported
    e.target.value = '';
  };

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 bg-black border border-(--color-border) rounded-lg shadow-lg z-50"
      style={{ padding: '4px 0', width: 220, maxHeight: 300, overflowY: 'auto', overflowX: 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Saved templates */}
      {templates.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 hover:bg-(--color-hover-toolbar) group"
          style={{ padding: '6px 10px', cursor: 'pointer' }}
          onClick={() => { onApply(t); onClose(); }}
        >
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: t.color, flexShrink: 0,
            border: '1px solid var(--color-border)',
          }} />
          <div style={{
            width: 16, height: t.strokeWidth, background: t.color,
            borderRadius: t.strokeWidth / 2, flexShrink: 0,
          }} />
          <span className="text-(--color-text) text-xs truncate" style={{ flex: 1 }}>{t.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); removeTemplate(t.id); }}
            className="text-(--color-text-muted) hover:text-(--color-error) opacity-0 group-hover:opacity-100"
            style={{ fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: 0 }}
          >
            &times;
          </button>
        </div>
      ))}

      {templates.length > 0 && (
        <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />
      )}

      {/* Save as... */}
      {saving ? (
        <div style={{ padding: '6px 10px' }}>
          <div className="flex items-center gap-1" style={{ position: 'relative' }}>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setShowSuggestions(true); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') { setSaving(false); setName(''); setShowSuggestions(false); }
              }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Template name"
              className="bg-(--color-bg) text-white text-xs rounded outline-none"
              style={{
                flex: 1, minWidth: 0, padding: '4px 8px',
                border: '1px solid var(--color-border)',
              }}
            />
            <button
              onClick={handleSave}
              className="text-xs text-white rounded"
              style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', flexShrink: 0, background: 'var(--color-focus-ring)', transition: 'background 0.15s' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-accent-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-focus-ring)')}
            >
              Save
            </button>
          </div>
          {/* Suggestions dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div
              className="bg-(--color-bg) border border-(--color-border) rounded"
              style={{ marginTop: 4, maxHeight: 120, overflowY: 'auto' }}
            >
              {suggestions.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setName(t.name); setShowSuggestions(false); nameRef.current?.focus(); }}
                  className="flex items-center gap-2 w-full text-left text-xs text-(--color-text) hover:bg-(--color-surface)"
                  style={{ padding: '5px 8px', border: 'none', background: 'none', cursor: 'pointer' }}
                >
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: t.color, flexShrink: 0,
                    border: '1px solid var(--color-border)',
                  }} />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="flex items-center gap-2 w-full text-left text-(--color-text) text-xs hover:bg-(--color-hover-toolbar)"
          style={{ padding: '6px 10px', border: 'none', background: 'none', cursor: 'pointer' }}
        >
          Save as...
        </button>
      )}

      {/* Apply defaults */}
      <button
        onClick={handleApplyDefaults}
        className="flex items-center gap-2 w-full text-left text-(--color-text) text-xs hover:bg-(--color-hover-toolbar)"
        style={{ padding: '6px 10px', border: 'none', background: 'none', cursor: 'pointer' }}
      >
        Apply defaults
      </button>

      <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />

      {/* Export / Import */}
      <div className="flex items-center" style={{ padding: '4px 10px', gap: 4 }}>
        <button
          onClick={handleExport}
          disabled={templates.length === 0}
          className="text-xs text-(--color-text) hover:bg-(--color-hover-toolbar) rounded"
          style={{
            flex: 1, padding: '4px 0', border: 'none', background: 'none', cursor: 'pointer',
            opacity: templates.length === 0 ? 0.4 : 1,
          }}
        >
          Export
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="text-xs text-(--color-text) hover:bg-(--color-hover-toolbar) rounded"
          style={{ flex: 1, padding: '4px 0', border: 'none', background: 'none', cursor: 'pointer' }}
        >
          Import
        </button>
        <input ref={fileRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main edit toolbar
// ---------------------------------------------------------------------------
export function DrawingEditToolbar({
  contractId,
}: {
  contractId: string | undefined;
}) {
  const selectedId = useStore((s) => s.selectedDrawingId);
  const drawings = useStore((s) => s.drawings);
  const updateDrawing = useStore((s) => s.updateDrawing);
  const removeDrawing = useStore((s) => s.removeDrawing);
  const setSelectedDrawingId = useStore((s) => s.setSelectedDrawingId);

  const [showColor, setShowColor] = useState(false);
  const [showText, setShowText] = useState(false);
  const [showStroke, setShowStroke] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);

  const toolbarRef = useRef<HTMLDivElement>(null);

  const drawing = selectedId ? drawings.find((d) => d.id === selectedId && d.contractId === contractId) : null;

  const closeAll = () => { setShowColor(false); setShowText(false); setShowStroke(false); setShowTemplate(false); };

  if (!drawing) return null;

  const btnBase = "relative flex items-center justify-center w-8 h-8 rounded-md border-none bg-transparent cursor-pointer text-(--color-text-muted) transition-colors duration-150";
  const btnHover = "hover:bg-(--color-hover-toolbar) hover:text-(--color-text)";
  const btnActive = "bg-(--color-hover-toolbar) text-white";

  return (
    <div
      ref={toolbarRef}
      className="absolute z-40 flex items-center pointer-events-auto animate-toolbar-in"
      style={{
        left: '10%',
        top: '10%',
        padding: '4px 6px',
        gap: 4,
        background: '#000000',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Color picker */}
      <div className="relative">
        <button
          onClick={() => { const v = !showColor; closeAll(); setShowColor(v); }}
          className={`${btnBase} ${showColor ? btnActive : btnHover}`}
          title="Color"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
          {/* Color dot overlay on pencil tip */}
          <div style={{
            position: 'absolute', bottom: 4, right: 4,
            width: 8, height: 8, borderRadius: '50%',
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

      <Divider />

      {/* Text */}
      <div className="relative">
        <button
          onClick={() => { const v = !showText; closeAll(); setShowText(v); }}
          className={`${btnBase} ${showText ? btnActive : btnHover}`}
          style={{ fontWeight: 700, fontSize: 15, fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif" }}
          title="Text"
        >
          T
          {/* Text color dot */}
          <div style={{
            position: 'absolute', bottom: 4, right: 4,
            width: 8, height: 8, borderRadius: '50%',
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

      <Divider />

      {/* Stroke width */}
      <div className="relative">
        <button
          onClick={() => { const v = !showStroke; closeAll(); setShowStroke(v); }}
          className={`${btnBase} !w-auto ${showStroke ? btnActive : btnHover}`}
          style={{ padding: '0 8px', gap: 6 }}
          title="Line width"
        >
          {/* Line preview */}
          <div style={{ width: 18, height: drawing.strokeWidth, background: 'currentColor', borderRadius: drawing.strokeWidth / 2 }} />
          <span style={{ fontSize: 11, fontWeight: 500 }}>{drawing.strokeWidth}px</span>
        </button>
        {showStroke && (
          <StrokePopover
            current={drawing.strokeWidth}
            onChange={(w) => updateDrawing(drawing.id, { strokeWidth: w })}
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
            title="Extend left"
          >
            {/* Ray icon: arrow pointing right from a vertical bar */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="6" x2="5" y2="18" />
              <line x1="5" y1="12" x2="21" y2="12" />
              <polyline points="17 8 21 12 17 16" />
            </svg>
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
                style={{ transform: showTemplate ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
              >
                <path d="M2.5 4L5 6.5L7.5 4" />
              </svg>
            </button>
            {showTemplate && (
              <TemplatePopover
                drawing={drawing}
                onApply={(t) => updateDrawing(drawing.id, { color: t.color, strokeWidth: t.strokeWidth, text: t.text })}
                onClose={() => setShowTemplate(false)}
              />
            )}
          </div>
        </>
      )}

      <Divider />

      {/* Delete */}
      <button
        onClick={() => { removeDrawing(drawing.id); setSelectedDrawingId(null); }}
        className={`${btnBase} hover:bg-(--color-hover-toolbar) hover:text-(--color-error)`}
        title="Delete"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
    </div>
  );
}
