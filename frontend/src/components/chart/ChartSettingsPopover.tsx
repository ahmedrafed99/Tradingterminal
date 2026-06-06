import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useStore } from '../../store/useStore';
import { CHART_SETTINGS_DEFAULTS } from '../../store/slices/chartSettingsSlice';
import { ColorSwatchButton } from './ColorPopover';
import { CustomSelect } from '../shared/CustomSelect';
import { Button } from '../shared/Button';
import { Popover } from '../shared/Popover';
import { FONT_FAMILY, RADIUS, SHADOW, Z } from '../../constants/layout';
import { Checkbox } from '../shared/Checkbox';

type Category = 'bars' | 'canvas' | 'trading' | 'market' | 'events';

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

function EventsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none">
      <path fill="currentColor" d="M10 6h8V4h1v2h1.5A2.5 2.5 0 0 1 23 8.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 5 19.5v-11A2.5 2.5 0 0 1 7.5 6H9V4h1zM6 19.5A1.5 1.5 0 0 0 7.5 21h13a1.5 1.5 0 0 0 1.5-1.5V11H6zM7.5 7A1.5 1.5 0 0 0 6 8.5V10h16V8.5A1.5 1.5 0 0 0 20.5 7H19v1h-1V7h-8v1H9V7z" />
    </svg>
  );
}

function MarketIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none">
      <path fill="currentColor" d="M5 21h18v1H5zM7 17h2v3H7zm4-5h2v8h-2zm4-4h2v12h-2zm4 7h2v5h-2zM6.5 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M4 6.5a2.5 2.5 0 1 1 4.9.5H22v1H8.9A2.5 2.5 0 0 1 4 6.5" />
    </svg>
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
// Main Popover
// ---------------------------------------------------------------------------
export function ChartSettingsPopover({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<Category>('bars');
  const chartSettings = useStore((s) => s.chartSettings);
  const setChartSettings = useStore((s) => s.setChartSettings);

  // Snapshot on open for Cancel
  const snapshotRef = useRef({ ...chartSettings });

  const handleCancel = useCallback(() => {
    setChartSettings(snapshotRef.current);
    onClose();
  }, [setChartSettings, onClose]);

  const handleReset = useCallback(() => {
    setChartSettings({ ...CHART_SETTINGS_DEFAULTS });
  }, [setChartSettings]);

  const categories: { id: Category; label: string; icon: React.ReactNode }[] = [
    { id: 'bars', label: 'Bars', icon: <BarsIcon /> },
    { id: 'canvas', label: 'Canvas', icon: <CanvasIcon /> },
    { id: 'trading', label: 'Trading', icon: <TradingIcon /> },
    { id: 'market', label: 'Market', icon: <MarketIcon /> },
    { id: 'events', label: 'Events', icon: <EventsIcon /> },
  ];

  return (
    <Popover
      title="Settings"
      onClose={onClose}
      onCancel={handleCancel}
      width={520}
      persistKey="popover-chart-settings"
      footerLeft={
        <Button
          variant="ghost"
          style={{ border: 'none', fontSize: 12 }}
          onClick={handleReset}
        >
          Reset defaults
        </Button>
      }
    >
      {/* Body: sidebar + content */}
      <div style={{ display: 'flex', flex: 1, minHeight: 380 }}>
        {/* Sidebar */}
        <div style={{ width: 160, borderRight: '1px solid var(--color-border)', padding: '8px 0', flexShrink: 0 }}>
          {categories.map((cat) => (
            <Button
              key={cat.id}
              variant="ghost"
              fullWidth
              className="justify-start rounded-none gap-2.5 hover:bg-(--color-hover-row)"
              style={{
                border: 'none',
                padding: '10px 18px',
                fontSize: 14,
                background: category === cat.id ? 'var(--color-border)' : undefined,
                color: category === cat.id ? 'var(--color-text-bright)' : undefined,
              }}
              onClick={() => setCategory(cat.id)}
            >
              {cat.icon}
              {cat.label}
            </Button>
          ))}
        </div>

        {/* Content */}
        <div className="scrollbar-thin" style={{ flex: 1, padding: '16px 24px', overflowY: 'auto' }}>
          {category === 'bars' && <BarsPanel settings={chartSettings} onChange={setChartSettings} />}
          {category === 'canvas' && <CanvasPanel settings={chartSettings} onChange={setChartSettings} />}
          {category === 'trading' && <TradingPanel settings={chartSettings} onChange={setChartSettings} />}
          {category === 'market' && <MarketPanel settings={chartSettings} onChange={setChartSettings} />}
          {category === 'events' && <EventsPanel />}
        </div>
      </div>
    </Popover>
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
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', width: 34, textAlign: 'center' }}>up</span>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', width: 34, textAlign: 'center' }}>down</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Trading Panel
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

// ---------------------------------------------------------------------------
// Market Panel
// ---------------------------------------------------------------------------
function MarketPanel({ settings, onChange }: { settings: Settings; onChange: OnChange }) {
  return (
    <>
      <SectionHeader>Price Limits</SectionHeader>

      <Checkbox
        checked={settings.showPriceLimits}
        onChange={(v) => onChange({ showPriceLimits: v })}
        label="Show price limit lines"
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
        Draws CME upper/lower price limit bands for equity index futures.
        Trading is automatically disabled within 2% of the limit.
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Events Panel
// ---------------------------------------------------------------------------
const IMPACT_LEVELS = [
  { key: 'high' as const,   label: 'High Impact' },
  { key: 'medium' as const, label: 'Medium Impact' },
  { key: 'low' as const,    label: 'Low Impact' },
];

function EventsPanel() {
  const newsImpactFilter = useStore((s) => s.newsImpactFilter);
  const setNewsImpactFilter = useStore((s) => s.setNewsImpactFilter);
  const lastFilterRef = useRef({ ...newsImpactFilter });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeDropdown = useCallback(() => setDropdownOpen(false), []);
  useClickOutside(dropdownRef, dropdownOpen, closeDropdown);

  const anyActive = newsImpactFilter.high || newsImpactFilter.medium || newsImpactFilter.low;

  const toggleMaster = () => {
    if (anyActive) {
      lastFilterRef.current = { ...newsImpactFilter };
      setNewsImpactFilter({ high: false, medium: false, low: false });
    } else {
      const last = lastFilterRef.current;
      setNewsImpactFilter(
        last.high || last.medium || last.low
          ? last
          : { high: true, medium: false, low: false }
      );
    }
  };

  const toggle = (level: 'high' | 'medium' | 'low') => {
    setNewsImpactFilter({ ...newsImpactFilter, [level]: !newsImpactFilter[level] });
  };

  const activeLabels = IMPACT_LEVELS.filter(({ key }) => newsImpactFilter[key]).map(({ label }) => label);
  const dropdownSummary = activeLabels.length === 0 ? 'None' : activeLabels.length === 3 ? 'All' : activeLabels.join(', ');

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', minHeight: 34, gap: 10, cursor: 'pointer',
  };

  const checkboxStyle = (checked: boolean): React.CSSProperties => ({
    width: 14, height: 14, borderRadius: 3,
    border: '1.5px solid var(--color-border)',
    background: checked ? '#ffffff' : 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'background var(--transition-fast)',
  });

  const labelStyle: React.CSSProperties = {
    color: 'var(--color-text)', fontSize: 13, whiteSpace: 'nowrap',
  };

  return (
    <>
      <SectionHeader>News Events</SectionHeader>

      {/* Master toggle row */}
      <div style={rowStyle} onClick={toggleMaster}>
        <span style={checkboxStyle(anyActive)}>
          {anyActive && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 5.5L3.5 8L9 2" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span style={labelStyle}>Show news events</span>
      </div>

      {/* Impact filter row with dropdown */}
      <div
        style={{
          display: 'flex', alignItems: 'center', minHeight: 34, gap: 10,
          opacity: anyActive ? 1 : 0.4,
          transition: 'opacity var(--transition-fast)',
          pointerEvents: anyActive ? 'auto' : 'none',
        }}
      >
        <span style={{ ...labelStyle, flexShrink: 0, width: 90 }}>Impact filter</span>
        <div ref={dropdownRef} style={{ position: 'relative', flex: 1 }}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className="focus:outline-none focus:ring-0 hover:border-(--color-text-dim) transition-colors"
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--color-surface)', color: 'var(--color-text)',
              border: '1px solid var(--color-border)', borderRadius: RADIUS.XL,
              padding: '4px 10px', fontSize: 13, cursor: 'pointer', fontFamily: FONT_FAMILY,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dropdownSummary}</span>
            <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0, marginLeft: 6, transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}>
              <path d="M0 0l4 5 4-5z" />
            </svg>
          </button>

          {dropdownOpen && (
            <div
              style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: RADIUS.LG, boxShadow: SHADOW.LG, zIndex: Z.DROPDOWN,
                padding: 4,
              }}
            >
              {IMPACT_LEVELS.map(({ key, label }) => (
                <div
                  key={key}
                  className="hover:bg-(--color-hover-row)"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer', borderRadius: RADIUS.MD }}
                  onClick={() => toggle(key)}
                >
                  <span style={checkboxStyle(newsImpactFilter[key])}>
                    {newsImpactFilter[key] && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M1 5.5L3.5 8L9 2" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--color-text)', userSelect: 'none', fontFamily: FONT_FAMILY }}>{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
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
        <CustomSelect
          value={settings.bgType}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient' },
          ]}
          onChange={(v) => onChange({ bgType: v as 'solid' | 'gradient' })}
          style={{ width: 110 }}
          dropdownBg="var(--color-surface)"
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
