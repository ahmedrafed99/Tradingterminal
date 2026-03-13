import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { useStore, TIMEFRAMES, type Timeframe } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';
import { ChevronDown } from '../icons/ChevronDown';
import { InstrumentSelectorPopover } from '../InstrumentSelectorPopover';
import { getChartEntry, type ChartEntry, type ScreenshotOptions } from './screenshot/chartRegistry';
import { addTimeBanner } from './screenshot/addTimeBanner';
import { COLOR_PALETTE } from './ColorPopover';
import { isFuturesMarketOpen } from '../../utils/marketHours';
import { COLOR_TEXT_MUTED, COLOR_TEXT, COLOR_BG, COLOR_BORDER } from '../../constants/colors';

const SnapshotPreview = lazy(() => import('./screenshot/SnapshotPreview').then(m => ({ default: m.SnapshotPreview })));

const UNIT_OPTIONS = [
  { value: 1, label: 'Seconds', suffix: 's' },
  { value: 2, label: 'Minutes', suffix: 'm' },
  { value: 3, label: 'Hours',   suffix: 'h' },
  { value: 4, label: 'Days',    suffix: 'D' },
] as const;


function StarIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-yellow-400">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-(--color-text-muted)">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function UnitDropdown({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = UNIT_OPTIONS.find((u) => u.value === value);

  return (
    <div ref={ref} className="relative flex-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-center gap-1 bg-(--color-panel) border border-(--color-border) rounded-md text-xs text-(--color-text) focus:outline-none hover:border-(--color-text-dim) transition-colors"
        style={{ padding: '5px 6px' }}
      >
        <span>{current?.label ?? 'Minutes'}</span>
        <ChevronDown />
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 mb-1 w-full bg-(--color-panel) border border-(--color-border) rounded-md shadow-lg z-50 py-1 animate-dropdown-in"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}
        >
          {UNIT_OPTIONS.map((u) => (
            <button
              key={u.value}
              onClick={() => { onChange(u.value); setOpen(false); }}
              className={`w-full text-center text-xs font-medium px-2 py-1 transition-colors rounded-sm mx-0 hover:bg-(--color-surface) ${
                u.value === value ? 'text-(--color-warning)' : 'text-(--color-text)'
              }`}
            >
              {u.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function useNYClock() {
  const [time, setTime] = useState('');
  const [marketOpen, setMarketOpen] = useState(() => isFuturesMarketOpen());
  useEffect(() => {
    function tick() {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });
      setTime(`${fmt.format(now)} New York`);
      setMarketOpen(isFuturesMarketOpen());
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return { time, marketOpen };
}

function IndicatorsDropdown() {
  const vpEnabled = useStore((s) =>
    s.selectedChart === 'left' ? s.vpEnabled : s.secondVpEnabled);
  const setVpEnabled = useStore((s) =>
    s.selectedChart === 'left' ? s.setVpEnabled : s.setSecondVpEnabled);
  const vpColor = useStore((s) =>
    s.selectedChart === 'left' ? s.vpColor : s.secondVpColor);
  const setVpColor = useStore((s) =>
    s.selectedChart === 'left' ? s.setVpColor : s.setSecondVpColor);
  const [open, setOpen] = useState(false);
  const [editingVp, setEditingVp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingVp(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative self-stretch flex items-center">
      <button
        onClick={() => { setOpen((o) => !o); setEditingVp(false); }}
        className={`h-full flex items-center gap-1 text-xs font-medium rounded hover:bg-(--color-surface) transition-colors ${
          open ? 'text-(--color-text)' : 'text-(--color-text-muted) hover:text-(--color-text)'
        }`}
        style={{ paddingLeft: 12, paddingRight: 12 }}
        title="Indicators"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'relative', top: -1 }}>
          <path d="M3 3v18h18" />
          <path d="M7 16l4-8 4 4 5-10" />
        </svg>
        Indicators
        <ChevronDown />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 bg-(--color-panel) border border-(--color-border) rounded-lg shadow-lg z-50 animate-dropdown-in"
          style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.5)', minWidth: 220 }}
        >
          {!editingVp ? (
            <div style={{ padding: 6 }}>
              {/* Volume Profile row */}
              <div
                className="flex items-center hover:bg-(--color-surface) transition-colors rounded-lg"
                style={{ padding: '8px 10px' }}
              >
                {/* Checkbox */}
                <button
                  onClick={() => setVpEnabled(!vpEnabled)}
                  style={{
                    width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                    border: vpEnabled ? 'none' : '1.5px solid var(--color-text-muted)',
                    background: vpEnabled ? 'var(--color-accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {vpEnabled && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5">
                      <path d="M2 5l2.5 2.5L8 3" />
                    </svg>
                  )}
                </button>

                {/* Label */}
                <span
                  className="flex-1 text-xs text-(--color-text) cursor-pointer select-none"
                  style={{ marginLeft: 10 }}
                  onClick={() => setVpEnabled(!vpEnabled)}
                >
                  Volume Profile
                </span>

                {/* Color swatch */}
                <div
                  style={{
                    width: 12, height: 12, borderRadius: 2, flexShrink: 0,
                    background: vpColor, border: '1px solid var(--color-border)',
                    marginRight: 8,
                  }}
                />

                {/* Edit (pencil) button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingVp(true); }}
                  className="text-(--color-text-muted) hover:text-(--color-text) transition-colors"
                  title="Edit color"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: 10, width: 252 }}>
              {/* Back arrow + title */}
              <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
                <button
                  onClick={() => setEditingVp(false)}
                  className="text-(--color-text-muted) hover:text-(--color-text) transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-xs text-(--color-text) font-medium">Volume Profile Color</span>
              </div>

              {/* Color palette grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3, marginBottom: 8 }}>
                {COLOR_PALETTE.flat().map((c, i) => (
                  <button
                    key={`${c}-${i}`}
                    onClick={() => setVpColor(c)}
                    style={{
                      width: 20, height: 20, background: c, borderRadius: 3,
                      border: c === vpColor ? '2px solid #fff' : '1px solid var(--color-border)',
                      cursor: 'pointer',
                      boxShadow: c === vpColor ? '0 0 0 1px var(--color-surface)' : 'none',
                    }}
                  />
                ))}
              </div>

              {/* Custom color */}
              <button
                onClick={() => customInputRef.current?.click()}
                style={{
                  width: 20, height: 20, borderRadius: 3,
                  border: '1px dashed var(--color-text-muted)', background: 'transparent',
                  color: 'var(--color-text-muted)', fontSize: 14, lineHeight: '18px',
                  cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                +
              </button>
              <input
                ref={customInputRef}
                type="color"
                value={vpColor}
                onChange={(e) => setVpColor(e.target.value)}
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewsToggle() {
  const newsVisible = useStore((s) => s.newsVisible);
  const setNewsVisible = useStore((s) => s.setNewsVisible);

  return (
    <button
      onClick={() => setNewsVisible(!newsVisible)}
      className={`self-stretch flex items-center gap-1.5 text-xs font-medium rounded hover:bg-(--color-surface) transition-colors ${
        newsVisible ? 'text-(--color-warning)' : 'text-(--color-text-muted) hover:text-(--color-text)'
      }`}
      style={{ paddingLeft: 12, paddingRight: 12 }}
      title={newsVisible ? 'Hide economic calendar' : 'Show economic calendar'}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'relative', top: -1 }}>
        <path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9h4" />
        <path d="M10 7h6" />
        <path d="M10 11h6" />
        <path d="M10 15h4" />
      </svg>
      News
    </button>
  );
}

export function ChartToolbar() {
  const pinnedTimeframes = useStore((s) => s.pinnedTimeframes);
  const pinTimeframe = useStore((s) => s.pinTimeframe);
  const unpinTimeframe = useStore((s) => s.unpinTimeframe);
  const dualChart = useStore((s) => s.dualChart);
  const setDualChart = useStore((s) => s.setDualChart);
  const setSelectedChart = useStore((s) => s.setSelectedChart);

  // Selection-aware timeframe: route to left or right chart
  const timeframe = useStore((s) =>
    s.selectedChart === 'left' ? s.timeframe : s.secondTimeframe,
  );
  const setTimeframe = useStore((s) => {
    const setLeft = s.setTimeframe;
    const setRight = s.setSecondTimeframe;
    return s.selectedChart === 'left' ? setLeft : setRight;
  });

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [customNumber, setCustomNumber] = useState('1');
  const [customUnit, setCustomUnit] = useState<number>(2); // default: Minutes
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { time: nyClock, marketOpen } = useNYClock();

  // Screenshot state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const cameraRef = useRef<HTMLDivElement>(null);

  // Click outside to close dropdowns
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (cameraRef.current && !cameraRef.current.contains(e.target as Node)) {
        setCameraOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** Take a screenshot of a single chart entry, painting PriceLevelLine instances onto the canvas */
  function screenshotEntry(entry: ChartEntry, options: ScreenshotOptions): HTMLCanvasElement {
    // Toggle drawings visibility
    if (entry.primitive && !options.showDrawings) entry.primitive.visible = false;
    // Toggle trade zones visibility
    if (entry.tradeZonePrimitive && !options.showTrades) entry.tradeZonePrimitive.visible = false;

    // Lines are HTML (not canvas), so takeScreenshot won't capture them — no need to hide
    const canvas = entry.chart.takeScreenshot(true);

    // Restore
    if (entry.primitive && !options.showDrawings) entry.primitive.visible = true;
    if (entry.tradeZonePrimitive && !options.showTrades) entry.tradeZonePrimitive.visible = true;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      const plotWidth = entry.chart.timeScale().width();

      // Paint instrument label + OHLC, clipped to the plot area
      // so text doesn't overshoot into the price scale on narrow charts (dual mode)
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, plotWidth, canvas.height);
      ctx.clip();

      const font = "12px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
      const instrText = entry.instrumentEl?.textContent || '';
      const ohlcText = entry.ohlcEl?.textContent || '';

      ctx.font = `500 ${font}`;
      let x = 10;
      const y = 18;

      if (instrText) {
        ctx.fillStyle = COLOR_TEXT_MUTED;
        ctx.fillText(instrText, x, y);
        x += ctx.measureText(instrText).width + 10;
      }
      if (ohlcText) {
        const metrics = ctx.measureText(ohlcText);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - 3, y - 12, metrics.width + 6, 16);
        ctx.fillStyle = COLOR_TEXT;
        ctx.fillText(ohlcText, x, y);
      }

      ctx.restore();

      // Paint position entry + its associated orders (SL/TP), but not preview brackets
      if (options.showPositions) {
        const lines = entry.orderLinesRef.current;
        for (const line of lines) {
          line.paintToCanvas(ctx, plotWidth);
        }
      }
    }

    return canvas;
  }

  const captureChartCanvas = useCallback((options: ScreenshotOptions): HTMLCanvasElement | null => {
    const leftEntry = getChartEntry('left');
    if (!leftEntry) return null;

    let chartCanvas: HTMLCanvasElement;

    if (!dualChart) {
      chartCanvas = screenshotEntry(leftEntry, options);
    } else {
      // Dual mode: composite both charts side-by-side
      const rightEntry = getChartEntry('right');
      if (!rightEntry) {
        chartCanvas = screenshotEntry(leftEntry, options);
      } else {
        const leftCanvas = screenshotEntry(leftEntry, options);
        const rightCanvas = screenshotEntry(rightEntry, options);
        const gap = 2;
        const w = leftCanvas.width + gap + rightCanvas.width;
        const h = Math.max(leftCanvas.height, rightCanvas.height);

        chartCanvas = document.createElement('canvas');
        chartCanvas.width = w;
        chartCanvas.height = h;
        const ctx = chartCanvas.getContext('2d')!;
        ctx.fillStyle = COLOR_BG;
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(leftCanvas, 0, 0);
        ctx.fillStyle = COLOR_BORDER;
        ctx.fillRect(leftCanvas.width, 0, gap, h);
        ctx.drawImage(rightCanvas, leftCanvas.width + gap, 0);
      }
    }

    return chartCanvas;
  }, [dualChart]);

  async function handleCopyChartImage() {
    const canvas = captureChartCanvas({ showDrawings: true, showPositions: true, showTrades: true });
    if (!canvas) return;
    setCameraOpen(false);
    try {
      const final = addTimeBanner(canvas);
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': new Promise((resolve) => {
            final.toBlob((blob) => resolve(blob!), 'image/png');
          }),
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be blocked — non-critical
    }
  }

  function handleCustomSnapshot() {
    setCameraOpen(false);
    setSnapshotOpen(true);
  }

  const isPinned = (tf: Timeframe) =>
    pinnedTimeframes.some((p) => p.unit === tf.unit && p.unitNumber === tf.unitNumber);

  const isActivePinned = pinnedTimeframes.some(
    (p) => p.unit === timeframe.unit && p.unitNumber === timeframe.unitNumber,
  );

  function handleSelectMore(tf: Timeframe) {
    setTimeframe(tf);
    setDropdownOpen(false);
  }

  function handleApplyCustom() {
    const num = parseInt(customNumber, 10);
    if (!num || num < 1) return;
    const unitOpt = UNIT_OPTIONS.find((u) => u.value === customUnit);
    if (!unitOpt) return;
    const label = `${num}${unitOpt.suffix}`;
    const tf: Timeframe = { unit: customUnit as Timeframe['unit'], unitNumber: num, label };
    setTimeframe(tf);
    setDropdownOpen(false);
  }

  return (
    <div className="flex items-center gap-2 px-4 bg-(--color-panel) border-b border-(--color-border)" style={{ paddingTop: '7px', paddingBottom: '7px' }}>
      <InstrumentSelectorPopover />
      <div className="w-px h-4 bg-(--color-border) mx-1" />

      {/* Pinned timeframe buttons */}
      {pinnedTimeframes.map((tf) => (
        <button
          key={tf.label}
          onClick={() => setTimeframe(tf)}
          className={`px-2 py-1 text-xs font-medium transition-colors ${
            timeframe.unit === tf.unit && timeframe.unitNumber === tf.unitNumber
              ? 'text-(--color-warning)'
              : 'text-(--color-text-muted) hover:text-(--color-text)'
          }`}
        >
          {tf.label}
        </button>
      ))}

      {/* Dropdown trigger */}
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          className={`flex items-center gap-1 px-2 py-1 text-xs font-medium transition-colors ${
            !isActivePinned
              ? 'text-(--color-warning)'
              : 'text-(--color-text-muted) hover:text-(--color-text)'
          }`}
        >
          {!isActivePinned && <span>{timeframe.label}</span>}
          <ChevronDown />
        </button>

        {/* Dropdown menu */}
        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-(--color-panel) border border-(--color-border) rounded-lg shadow-lg z-50 py-2 animate-dropdown-in"
            style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
          >
            {/* Preset timeframes */}
            {TIMEFRAMES.map((tf) => {
              const pinned = isPinned(tf);
              const active = timeframe.unit === tf.unit && timeframe.unitNumber === tf.unitNumber;
              return (
                <div
                  key={tf.label}
                  className={`flex items-center hover:bg-(--color-surface) transition-colors rounded-md mx-1.5 ${
                    active ? 'bg-(--color-surface)' : ''
                  }`}
                  style={{ padding: '8px 10px' }}
                >
                  <button
                    onClick={() => handleSelectMore(tf)}
                    className={`text-xs flex-1 text-center font-medium ${
                      active ? 'text-(--color-warning)' : 'text-(--color-text)'
                    }`}
                  >
                    {tf.label}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      pinned ? unpinTimeframe(tf) : pinTimeframe(tf);
                    }}
                    className="ml-2 p-0.5 hover:opacity-80 transition-opacity"
                  >
                    <StarIcon filled={pinned} />
                  </button>
                </div>
              );
            })}

            {/* Divider */}
            <div className="border-t border-(--color-border) my-2 mx-3" />

            {/* Custom timeframe */}
            <div style={{ padding: '4px 14px 8px' }}>
              <div className={SECTION_LABEL} style={{ marginBottom: '8px' }}>Custom</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  value={customNumber}
                  onChange={(e) => setCustomNumber(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleApplyCustom(); }}
                  className="w-10 bg-(--color-panel) border border-(--color-border) rounded-md text-xs text-(--color-text) text-center focus:outline-none focus:border-(--color-text-dim)"
                  style={{ padding: '5px 4px' }}
                />
                <UnitDropdown value={customUnit} onChange={setCustomUnit} />
                <button
                  onClick={handleApplyCustom}
                  className="flex items-center justify-center rounded-md bg-(--color-surface) hover:bg-(--color-border) text-(--color-text-muted) hover:text-white transition-colors shrink-0"
                  style={{ width: '24px', height: '24px' }}
                  title="Add custom timeframe"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M6 2v8M2 6h8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-(--color-border) mx-1" />

      {/* Indicators */}
      <IndicatorsDropdown />

      {/* News calendar toggle */}
      <NewsToggle />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Layout toggle */}
      <button
        onClick={() => {
          const next = !dualChart;
          setDualChart(next);
          if (next) setSelectedChart('left');
        }}
        className={`self-stretch flex items-center rounded hover:bg-(--color-surface) transition-colors ${
          dualChart
            ? 'text-(--color-text)'
            : 'text-(--color-text-muted) hover:text-(--color-text)'
        }`}
        style={{ paddingLeft: 12, paddingRight: 12 }}
        title={dualChart ? 'Single chart' : 'Dual chart'}
      >
        {dualChart ? (
          <svg width="16" height="12" viewBox="0 0 16 12" stroke="currentColor" strokeWidth="1.2">
            <rect x="0.6" y="0.6" width="14.8" height="10.8" rx="1.5" fill="none" />
            <line x1="8" y1="0.6" x2="8" y2="11.4" />
          </svg>
        ) : (
          <svg width="16" height="12" viewBox="0 0 16 12" stroke="currentColor" strokeWidth="1.2">
            <rect x="0.6" y="0.6" width="14.8" height="10.8" rx="1.5" fill="none" />
          </svg>
        )}
      </button>

      <div className="w-px h-4 bg-(--color-border) mx-1" />

      {/* Screenshot button */}
      <div ref={cameraRef} className="relative self-stretch flex items-center">
        <button
          onClick={() => setCameraOpen((o) => !o)}
          className={`h-full flex items-center justify-center rounded hover:bg-(--color-surface) transition-colors ${
            copied
              ? 'text-green-400'
              : cameraOpen
                ? 'text-(--color-text)'
                : 'text-(--color-text-muted) hover:text-(--color-text)'
          }`}
          style={{ paddingLeft: 12, paddingRight: 12 }}
          title="Chart screenshot"
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          )}
        </button>

        {cameraOpen && (
          <div
            className="absolute top-full right-0 mt-1.5 bg-(--color-panel) border border-(--color-border)/60 rounded-xl z-50 animate-dropdown-in"
            style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.06)', padding: '6px' }}
          >
            <button
              onClick={handleCopyChartImage}
              className="w-full flex items-center gap-2.5 text-xs text-(--color-text) hover:bg-(--color-surface) transition-colors rounded-lg"
              style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              Copy chart image
            </button>
            <div className="border-t border-(--color-border)/40 my-1 mx-2" />
            <button
              onClick={handleCustomSnapshot}
              className="w-full flex items-center gap-2.5 text-xs text-(--color-text) hover:bg-(--color-surface) transition-colors rounded-lg"
              style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.8">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Custom snapshot
            </button>
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-(--color-border) mx-1" />

      {/* NY clock + market status */}
      <div className="flex items-center gap-1.5" style={{ marginRight: '8px' }}>
        <span
          title={marketOpen ? 'Futures market open' : 'Futures market closed'}
          style={{
            display: 'inline-block',
            width: 6, height: 6,
            borderRadius: '50%',
            background: marketOpen ? 'var(--color-buy)' : 'var(--color-sell)',
            flexShrink: 0,
          }}
        />
        <span className="text-xs text-(--color-text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {nyClock}
        </span>
      </div>

      {snapshotOpen && (
        <Suspense fallback={null}>
          <SnapshotPreview
            captureChartCanvas={captureChartCanvas}
            onClose={() => setSnapshotOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
