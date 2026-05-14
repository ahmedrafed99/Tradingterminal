import { useState, useEffect, useRef } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useStore } from '../../../store/useStore';
import { RADIUS, Z } from '../../../constants/layout';
import type { Drawing, HLineTemplate, LineStyle } from '../../../types/drawing';
import { DEFAULT_HLINE_COLOR } from '../../../types/drawing';

export function TemplatePopover({
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

  useClickOutside(ref, true, onClose);

  useEffect(() => {
    if (saving) nameRef.current?.focus();
  }, [saving]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = templates.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) removeTemplate(existing.id);
    addTemplate({
      id: crypto.randomUUID(),
      name: trimmed,
      color: drawing.color,
      strokeWidth: drawing.strokeWidth,
      lineStyle: (drawing as { lineStyle?: LineStyle }).lineStyle ?? 'solid',
      text: drawing.text ? { ...drawing.text } : null,
    });
    setSaving(false);
    setName('');
  };

  const suggestions = templates.filter(
    (t) => name.trim() && t.name.toLowerCase().includes(name.trim().toLowerCase())
  );

  const handleApplyDefaults = () => {
    onApply({ id: '', name: '', color: DEFAULT_HLINE_COLOR, strokeWidth: 1, lineStyle: 'solid', text: null });
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
    e.target.value = '';
  };

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 bg-(--color-surface) border border-(--color-border) rounded-lg shadow-lg"
      style={{ zIndex: Z.DROPDOWN, padding: '4px 0', width: 220, maxHeight: 300, overflowY: 'auto', overflowX: 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Saved templates */}
      {templates.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 hover:bg-(--color-hover-row) group transition-colors"
          style={{ padding: '6px 10px', cursor: 'pointer', borderRadius: RADIUS.LG }}
          onClick={() => { onApply(t); onClose(); }}
        >
          <div style={{
            width: 10, height: 10, borderRadius: RADIUS.CIRCLE,
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
            className="text-(--color-text-muted) hover:text-(--color-error) opacity-0 group-hover:opacity-100 transition-colors"
            style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center' }}
          >
            <svg width="14" height="14" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor">
              <path d="M18 7h5v1h-2.01l-1.33 14.64a1.5 1.5 0 0 1-1.5 1.36H9.84a1.5 1.5 0 0 1-1.49-1.36L7.01 8H5V7h5V6c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v1Zm-6-2a1 1 0 0 0-1 1v1h6V6a1 1 0 0 0-1-1h-4ZM8.02 8l1.32 14.54a.5.5 0 0 0 .5.46h8.33a.5.5 0 0 0 .5-.46L19.99 8H8.02Z" />
            </svg>
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
              className="text-xs rounded"
              style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', flexShrink: 0, background: 'var(--color-label-close)', color: 'var(--color-label-text)', transition: 'background var(--transition-fast)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-label-close-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-label-close)')}
            >
              Save
            </button>
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div
              className="bg-(--color-bg) border border-(--color-border) rounded"
              style={{ marginTop: 4, maxHeight: 120, overflowY: 'auto' }}
            >
              {suggestions.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setName(t.name); setShowSuggestions(false); nameRef.current?.focus(); }}
                  className="flex items-center gap-2 w-full text-left text-xs text-(--color-text) bg-transparent hover:bg-(--color-hover-row) transition-colors"
                  style={{ padding: '5px 8px', border: 'none', cursor: 'pointer', borderRadius: RADIUS.LG }}
                >
                  <div style={{
                    width: 8, height: 8, borderRadius: RADIUS.CIRCLE,
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
          className="flex items-center gap-2 w-full text-left text-(--color-text) text-xs bg-transparent hover:bg-(--color-hover-row) transition-colors"
          style={{ padding: '6px 10px', border: 'none', cursor: 'pointer', borderRadius: RADIUS.LG }}
        >
          Save as...
        </button>
      )}

      {/* Apply defaults */}
      <button
        onClick={handleApplyDefaults}
        className="flex items-center gap-2 w-full text-left text-(--color-text) text-xs bg-transparent hover:bg-(--color-hover-row) transition-colors"
        style={{ padding: '6px 10px', border: 'none', cursor: 'pointer', borderRadius: RADIUS.LG }}
      >
        Apply defaults
      </button>

      <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />

      {/* Export / Import */}
      <div className="flex items-center" style={{ padding: '4px 10px', gap: 4 }}>
        <button
          onClick={handleExport}
          disabled={templates.length === 0}
          className="flex items-center justify-center gap-1.5 text-xs text-(--color-text) bg-transparent hover:bg-(--color-hover-row) rounded transition-colors"
          style={{
            flex: 1, padding: '4px 0', border: 'none', cursor: 'pointer',
            opacity: templates.length === 0 ? 0.4 : 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Export
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center justify-center gap-1.5 text-xs text-(--color-text) bg-transparent hover:bg-(--color-hover-row) rounded transition-colors"
          style={{ flex: 1, padding: '4px 0', border: 'none', cursor: 'pointer' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Import
        </button>
        <input ref={fileRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
      </div>
    </div>
  );
}
