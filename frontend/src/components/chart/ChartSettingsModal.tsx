import { useState, useRef, useCallback, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { CHART_SETTINGS_DEFAULTS } from '../../store/slices/chartSettingsSlice';
import { Modal } from '../shared/Modal';
import { ColorPopover } from './ColorPopover';

type Category = 'bars' | 'canvas';

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

// ---------------------------------------------------------------------------
// Sidebar icons
// ---------------------------------------------------------------------------
function BarsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="4" y1="2" x2="4" y2="14" />
      <line x1="2.5" y1="5" x2="5.5" y2="5" />
      <line x1="2.5" y1="11" x2="5.5" y2="11" />
      <rect x="2.5" y="5" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.3" />
      <line x1="10" y1="3" x2="10" y2="13" />
      <line x1="8.5" y1="6" x2="11.5" y2="6" />
      <line x1="8.5" y1="10" x2="11.5" y2="10" />
      <rect x="8.5" y="6" width="3" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

function CanvasIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M2 10l3-3 2 2 4-4 3 3" opacity="0.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Color swatch button (opens ColorPopover)
// ---------------------------------------------------------------------------
function ColorSwatchButton({
  color,
  onChange,
  disabled,
}: {
  color: string;
  onChange: (c: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure swatch position when opening
  useEffect(() => {
    if (!open || !swatchRef.current) return;
    const r = swatchRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }, [open]);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center' }}>
      <button
        ref={swatchRef}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          width: 28,
          height: 28,
          borderRadius: 4,
          background: color,
          border: '1px solid var(--color-border)',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          transition: 'opacity 0.15s',
          boxSizing: 'border-box',
        }}
      />
      {open && !disabled && pos && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 100 }}>
          <ColorPopover
            current={color}
            onChange={(c) => { onChange(c); }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------
function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        fontSize: 13,
        color: 'var(--color-text)',
        fontFamily: FONT,
      }}
    >
      <span
        onClick={() => onChange(!checked)}
        style={{
          width: 16,
          height: 16,
          borderRadius: 3,
          border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-text-dim)'}`,
          background: checked ? 'var(--color-accent)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.15s, border-color 0.15s',
          flexShrink: 0,
          cursor: 'pointer',
        }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5.5l2 2L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------
function SectionHeader({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--color-text-muted)',
        marginBottom: 12,
        marginTop: 4,
        fontFamily: FONT,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row: checkbox + label + color swatches
// ---------------------------------------------------------------------------
function ColorRow({
  label,
  enabled,
  onToggle,
  upColor,
  downColor,
  onUpChange,
  onDownChange,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  upColor: string;
  downColor: string;
  onUpChange: (c: string) => void;
  onDownChange: (c: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
      <Checkbox checked={enabled} onChange={onToggle} label={label} />
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <ColorSwatchButton color={upColor} onChange={onUpChange} disabled={!enabled} />
        <ColorSwatchButton color={downColor} onChange={onDownChange} disabled={!enabled} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Modal
// ---------------------------------------------------------------------------
export function ChartSettingsModal({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<Category>('bars');
  const chartSettings = useStore((s) => s.chartSettings);
  const setChartSettings = useStore((s) => s.setChartSettings);

  // Snapshot on open for Cancel
  const snapshotRef = useRef({ ...chartSettings });

  const handleCancel = useCallback(() => {
    setChartSettings(snapshotRef.current);
    onClose();
  }, [setChartSettings, onClose]);

  const handleOk = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleReset = useCallback(() => {
    setChartSettings({ ...CHART_SETTINGS_DEFAULTS });
  }, [setChartSettings]);

  const categories: { id: Category; label: string; icon: React.ReactNode }[] = [
    { id: 'bars', label: 'Bars', icon: <BarsIcon /> },
    { id: 'canvas', label: 'Canvas', icon: <CanvasIcon /> },
  ];

  return (
    <Modal onClose={handleCancel} className="bg-(--color-surface) border border-(--color-border) rounded-lg" style={{ width: 520, maxHeight: '80vh', fontFamily: FONT, overflow: 'visible' }}>
      {/* Title bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--color-border)' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Settings</span>
        <button
          onClick={handleCancel}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            fontSize: 18,
            cursor: 'pointer',
            lineHeight: 1,
            padding: '0 2px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
        >
          &times;
        </button>
      </div>

      {/* Body: sidebar + content */}
      <div style={{ display: 'flex', minHeight: 260 }}>
        {/* Sidebar */}
        <div style={{ width: 140, borderRight: '1px solid var(--color-border)', padding: '8px 0' }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 16px',
                background: category === cat.id ? 'var(--color-border)' : 'transparent',
                border: 'none',
                color: category === cat.id ? '#fff' : 'var(--color-text-muted)',
                fontSize: 13,
                fontFamily: FONT,
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (category !== cat.id) {
                  e.currentTarget.style.color = 'var(--color-text)';
                }
              }}
              onMouseLeave={(e) => {
                if (category !== cat.id) {
                  e.currentTarget.style.color = 'var(--color-text-muted)';
                }
              }}
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '16px 24px', overflowY: 'auto' }}>
          {category === 'bars' && <BarsPanel settings={chartSettings} onChange={setChartSettings} />}
          {category === 'canvas' && <CanvasPanel settings={chartSettings} onChange={setChartSettings} />}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--color-border)' }}>
        <button
          onClick={handleReset}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            fontSize: 12,
            fontFamily: FONT,
            cursor: 'pointer',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
        >
          Reset defaults
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleCancel}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              fontSize: 13,
              fontFamily: FONT,
              cursor: 'pointer',
              padding: '6px 16px',
              borderRadius: 4,
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            Cancel
          </button>
          <button
            onClick={handleOk}
            style={{
              background: 'var(--color-accent-hover)',
              border: 'none',
              color: '#fff',
              fontSize: 13,
              fontFamily: FONT,
              cursor: 'pointer',
              padding: '6px 20px',
              borderRadius: 4,
              fontWeight: 500,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-accent-hover)'; }}
          >
            Ok
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Bars Panel
// ---------------------------------------------------------------------------
type Settings = ReturnType<typeof useStore.getState>['chartSettings'];
type OnChange = (patch: Partial<Settings>) => void;

function BarsPanel({ settings, onChange }: { settings: Settings; onChange: OnChange }) {
  return (
    <>
      <SectionHeader>Candles</SectionHeader>

      <ColorRow
        label="Body"
        enabled={settings.bodyVisible}
        onToggle={(v) => onChange({ bodyVisible: v })}
        upColor={settings.upColor}
        downColor={settings.downColor}
        onUpChange={(c) => onChange({ upColor: c })}
        onDownChange={(c) => onChange({ downColor: c })}
      />

      <ColorRow
        label="Borders"
        enabled={settings.borderVisible}
        onToggle={(v) => onChange({ borderVisible: v })}
        upColor={settings.borderUpColor}
        downColor={settings.borderDownColor}
        onUpChange={(c) => onChange({ borderUpColor: c })}
        onDownChange={(c) => onChange({ borderDownColor: c })}
      />

      <ColorRow
        label="Wick"
        enabled={settings.wickVisible}
        onToggle={(v) => onChange({ wickVisible: v })}
        upColor={settings.wickUpColor}
        downColor={settings.wickDownColor}
        onUpChange={(c) => onChange({ wickUpColor: c })}
        onDownChange={(c) => onChange({ wickDownColor: c })}
      />

      {/* Legend for up/down columns */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: -4 }}>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', width: 28, textAlign: 'center' }}>up</span>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', width: 28, textAlign: 'center' }}>down</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Canvas Panel
// ---------------------------------------------------------------------------
function CanvasPanel({ settings, onChange }: { settings: Settings; onChange: OnChange }) {
  return (
    <>
      <SectionHeader>Background</SectionHeader>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <select
          value={settings.bgType}
          onChange={(e) => onChange({ bgType: e.target.value as 'solid' | 'gradient' })}
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            color: 'var(--color-text)',
            fontSize: 12,
            fontFamily: FONT,
            padding: '5px 8px',
            height: 28,
            boxSizing: 'border-box',
            cursor: 'pointer',
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
        >
          <option value="solid">Solid</option>
          <option value="gradient">Gradient</option>
        </select>

        {settings.bgType === 'solid' && (
          <ColorSwatchButton color={settings.bgColor} onChange={(c) => onChange({ bgColor: c })} />
        )}

        {settings.bgType === 'gradient' && (
          <>
            <ColorSwatchButton color={settings.gradientTopColor} onChange={(c) => onChange({ gradientTopColor: c })} />
            <ColorSwatchButton color={settings.gradientBottomColor} onChange={(c) => onChange({ gradientBottomColor: c })} />
          </>
        )}
      </div>
    </>
  );
}
