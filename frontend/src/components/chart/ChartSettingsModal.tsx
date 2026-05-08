import { useState, useRef, useCallback, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { CHART_SETTINGS_DEFAULTS } from '../../store/slices/chartSettingsSlice';
import { ColorPopover } from './ColorPopover';
import { CustomSelect } from '../shared/CustomSelect';
import { FONT_FAMILY, RADIUS, SHADOW, Z } from '../../constants/layout';

type Category = 'bars' | 'canvas' | 'trading';

// ---------------------------------------------------------------------------
// Sidebar icons
// ---------------------------------------------------------------------------
function BarsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
      <path fill="currentColor" fillRule="evenodd" d="M11 4h-1v3H8.5a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5H10v3h1v-3h1.5a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5H11V4ZM9 8v12h3V8H9Zm10-1h-1v3h-1.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5H18v3h1v-3h1.5a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5H19V7Zm-2 10v-6h3v6h-3Z" />
    </svg>
  );
}

function CanvasIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none">
      <path fill="currentColor" d="M18.965 5a2.5 2.5 0 0 1 1.666.73l1.637 1.637c.49.49.733 1.132.732 1.773a2.5 2.5 0 0 1-.73 1.762l-.788.789L10.172 23H4.998v-5.17l.146-.146 1.116-1.117L16.31 6.519l.785-.787A2.5 2.5 0 0 1 18.965 5M6 18.243v3.758h3.758l.616-.616-3.758-3.759zm1.323-1.324 3.759 3.759 9.34-9.34-3.758-3.759zM19.924 6.438a1.5 1.5 0 0 0-2.122 0l-.433.433 3.758 3.758.435-.434a1.5 1.5 0 0 0-.001-2.12z" />
    </svg>
  );
}

function TradingIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none">
      <path fill="currentColor" d="M17.138 18.207a2.098 2.098 0 0 1-2.461 3.4l-4.68-3.359-4.673 3.357a2.097 2.097 0 0 1-2.463-3.398L9.997 13zm-13.687.808a1.097 1.097 0 0 0-.222 1.555 1.1 1.1 0 0 0 1.512.223l5.256-3.775 5.263 3.776a1.1 1.1 0 0 0 1.289-1.78l-6.552-4.777zM22.677 6.394a2.098 2.098 0 0 1 2.46 3.4L17.998 15l-7.136-5.207a2.097 2.097 0 0 1 2.463-3.397l4.673 3.356zm2.095 1.035a1.1 1.1 0 0 0-1.512-.223l-5.263 3.776-5.256-3.775a1.1 1.1 0 0 0-1.512.223 1.097 1.097 0 0 0 .222 1.555l6.546 4.778 6.552-4.778c.499-.364.6-1.067.223-1.556" />
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
        className="focus:outline-none focus:ring-0"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 4,
          borderRadius: RADIUS.XL,
          border: '1px solid var(--color-border)',
          background: 'transparent',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          transition: 'opacity var(--transition-fast)',
        }}
      >
        <span style={{
          display: 'block',
          width: 18,
          height: 18,
          borderRadius: RADIUS.LG,
          background: color,
        }} />
      </button>
      {open && !disabled && pos && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: Z.TOAST }}>
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
        fontFamily: FONT_FAMILY,
      }}
    >
      <span
        onClick={() => onChange(!checked)}
        style={{
          width: 16,
          height: 16,
          borderRadius: RADIUS.MD,
          border: '1px solid var(--color-border)',
          background: checked ? '#ffffff' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background var(--transition-fast)',
          flexShrink: 0,
          cursor: 'pointer',
        }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5.5l2 2L8 3" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--color-text-muted)',
        marginBottom: 12,
        marginTop: 4,
        fontFamily: FONT_FAMILY,
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

  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.round(window.innerWidth / 2 - 260),
    y: Math.round(window.innerHeight / 2 - 200),
  }));
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleCancel]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleTitleMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  };

  const categories: { id: Category; label: string; icon: React.ReactNode }[] = [
    { id: 'bars', label: 'Bars', icon: <BarsIcon /> },
    { id: 'canvas', label: 'Canvas', icon: <CanvasIcon /> },
    { id: 'trading', label: 'Trading', icon: <TradingIcon /> },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: Z.MODAL,
        width: 520,
        maxHeight: '80vh',
        fontFamily: FONT_FAMILY,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: RADIUS.LG,
        boxShadow: SHADOW.LG,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Title bar — drag handle */}
      <div
        onMouseDown={handleTitleMouseDown}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--color-border)',
          cursor: 'move', userSelect: 'none', flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-bright)' }}>Settings</span>
        <button
          onClick={handleCancel}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--color-text-muted)', fontSize: 18,
            cursor: 'pointer', lineHeight: 1, padding: '0 2px',
            transition: 'color var(--transition-fast)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-bright)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
        >
          &times;
        </button>
      </div>

      {/* Body: sidebar + content */}
      <div style={{ display: 'flex', flex: 1, minHeight: 380 }}>
        {/* Sidebar */}
        <div style={{ width: 160, borderRight: '1px solid var(--color-border)', padding: '8px 0', flexShrink: 0 }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '10px 18px',
                background: category === cat.id ? 'var(--color-border)' : 'transparent',
                border: 'none',
                color: category === cat.id ? 'var(--color-text-bright)' : 'var(--color-text-muted)',
                fontSize: 14, fontFamily: FONT_FAMILY, cursor: 'pointer',
                transition: 'background var(--transition-fast), color var(--transition-fast)',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { if (category !== cat.id) e.currentTarget.style.color = 'var(--color-text)'; }}
              onMouseLeave={(e) => { if (category !== cat.id) e.currentTarget.style.color = 'var(--color-text-muted)'; }}
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
          {category === 'trading' && <TradingPanel settings={chartSettings} onChange={setChartSettings} />}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
        <button
          onClick={handleReset}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--color-text-muted)', fontSize: 12,
            fontFamily: FONT_FAMILY, cursor: 'pointer',
            transition: 'color var(--transition-fast)',
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
              background: 'transparent', border: 'none',
              color: 'var(--color-text-muted)', fontSize: 13,
              fontFamily: FONT_FAMILY, cursor: 'pointer',
              padding: '6px 16px', borderRadius: RADIUS.LG,
              transition: 'color var(--transition-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-bright)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            Cancel
          </button>
          <button
            onClick={handleOk}
            style={{
              background: 'var(--color-label-close)', border: 'none',
              color: 'var(--color-label-text)', fontSize: 13,
              fontFamily: FONT_FAMILY, cursor: 'pointer',
              padding: '6px 20px', borderRadius: RADIUS.LG,
              fontWeight: 500, transition: 'background var(--transition-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-label-close-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-label-close)'; }}
          >
            Ok
          </button>
        </div>
      </div>
    </div>
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
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 28, textAlign: 'center' }}>up</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 28, textAlign: 'center' }}>down</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Canvas Panel
// ---------------------------------------------------------------------------
function TradingPanel({ settings, onChange }: { settings: Settings; onChange: OnChange }) {
  return (
    <>
      <SectionHeader>Trade Markers</SectionHeader>

      <Checkbox
        checked={settings.extendTradeZoneRight}
        onChange={(v) => onChange({ extendTradeZoneRight: v })}
        label="Extend zone right"
      />
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          marginTop: 6,
          marginLeft: 24,
          lineHeight: 1.4,
          fontFamily: FONT_FAMILY,
        }}
      >
        Extend the trade zone rectangle to the right edge of the chart
      </div>

    </>
  );
}

function CanvasPanel({ settings, onChange }: { settings: Settings; onChange: OnChange }) {
  return (
    <>
      <SectionHeader>Background</SectionHeader>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <CustomSelect
          value={settings.bgType}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient' },
          ]}
          onChange={(v) => onChange({ bgType: v as 'solid' | 'gradient' })}
          style={{
            width: 110,
          }}
        />

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

      <SectionHeader>Performance</SectionHeader>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Checkbox
          checked={settings.showFpsCounter}
          onChange={(v) => onChange({ showFpsCounter: v })}
          label="Show FPS counter"
        />
        <div style={{ marginLeft: 'auto' }}>
          <ColorSwatchButton
            color={settings.fpsCounterColor}
            onChange={(c) => onChange({ fpsCounterColor: c })}
            disabled={!settings.showFpsCounter}
          />
        </div>
      </div>
    </>
  );
}
