import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { StrategyLabModal } from '../backtest/StrategyLabModal';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useStore } from '../../store/useStore';
import { SECTION_LABEL } from '../../constants/styles';
import { ChevronDown } from '../icons/ChevronDown';
import { TimeframePicker } from '../shared/TimeframePicker';
import { InstrumentSelectorPopover } from '../InstrumentSelectorPopover';
import { getChartEntry, type ChartEntry, type ScreenshotOptions } from './screenshot/chartRegistry';
import { addTimeBanner } from './screenshot/addTimeBanner';
import { ColorSwatch, COLOR_PALETTE, OpacitySlider, parseColorWithOpacity, toRgba } from './ColorPopover';
import { getSchedule, type MarketType } from '../../utils/marketHours';
import { COLOR_BG, COLOR_BORDER } from '../../constants/colors';
import { paintOverlays } from './screenshot/paintOverlays';
import { useRecording } from './recording/useRecording';
import { RecordingIndicator } from './recording/RecordingIndicator';
import { CHART_ICON_SIZE, RADIUS, SHADOW, Z } from '../../constants/layout';

const SnapshotPreview = lazy(() => import('./screenshot/SnapshotPreview').then(m => ({ default: m.SnapshotPreview })));


function useNYClock(marketType: MarketType = 'futures') {
  const schedule = getSchedule(marketType);
  const [time, setTime] = useState('');
  const [marketOpen, setMarketOpen] = useState(() => schedule.isOpen());
  useEffect(() => {
    function tick() {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });
      setTime(`${fmt.format(now)} New York`);
      setMarketOpen(schedule.isOpen());
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [schedule]);
  return { time, marketOpen, is24h: marketType === 'crypto' };
}

function IndicatorsDropdown() {
  const domEnabled = useStore((s) =>
    s.selectedChart === 'left' ? s.domEnabled : s.secondDomEnabled);
  const setDomEnabled = useStore((s) =>
    s.selectedChart === 'left' ? s.setDomEnabled : s.setSecondDomEnabled);
  const domColor = useStore((s) =>
    s.selectedChart === 'left' ? s.domColor : s.secondDomColor);
  const setDomColor = useStore((s) =>
    s.selectedChart === 'left' ? s.setDomColor : s.setSecondDomColor);
  const domHoverExpand = useStore((s) =>
    s.selectedChart === 'left' ? s.domHoverExpand : s.secondDomHoverExpand);
  const setDomHoverExpand = useStore((s) =>
    s.selectedChart === 'left' ? s.setDomHoverExpand : s.setSecondDomHoverExpand);
  const bidAskEnabled = useStore((s) =>
    s.selectedChart === 'left' ? s.bidAskEnabled : s.secondBidAskEnabled);
  const setBidAskEnabled = useStore((s) =>
    s.selectedChart === 'left' ? s.setBidAskEnabled : s.setSecondBidAskEnabled);
  const [open, setOpen] = useState(false);
  const [editingDom, setEditingDom] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  const closeIndicatorMenu = useCallback(() => { setOpen(false); setEditingDom(false); }, []);
  useClickOutside(ref, open, closeIndicatorMenu);

  return (
    <div ref={ref} className="relative self-stretch flex items-center">
      <button
        onClick={() => { setOpen((o) => !o); setEditingDom(false); }}
        className="h-full flex items-center gap-1 text-xs font-medium rounded text-(--color-text) hover:bg-(--color-border) transition-colors"
        style={{ paddingLeft: 12, paddingRight: 12 }}
        title="Indicators"
      >
        <svg width={CHART_ICON_SIZE} height={CHART_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'relative', top: -1 }}>
          <path d="M3 3v18h18" />
          <path d="M7 16l4-8 4 4 5-10" />
        </svg>
        Indicators
        <ChevronDown />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 bg-(--color-surface) border border-(--color-border) rounded-lg"
          style={{ zIndex: Z.DROPDOWN, boxShadow: SHADOW.LG, minWidth: 220 }}
        >
          {!editingDom ? (
            <div style={{ padding: 6 }}>
              {/* Market Depth row */}
              <div
                className="flex items-center hover:bg-(--color-hover-row) transition-colors rounded-lg"
                style={{ padding: '8px 10px' }}
              >
                {/* Checkbox */}
                <button
                  onClick={() => setDomEnabled(!domEnabled)}
                  style={{
                    width: 14, height: 14, borderRadius: RADIUS.MD, flexShrink: 0,
                    border: domEnabled ? 'none' : '1.5px solid var(--color-text-muted)',
                    background: domEnabled ? 'var(--color-accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {domEnabled && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5">
                      <path d="M2 5l2.5 2.5L8 3" />
                    </svg>
                  )}
                </button>

                {/* Label */}
                <span
                  className="flex-1 text-xs text-(--color-text) cursor-pointer select-none"
                  style={{ marginLeft: 10 }}
                  onClick={() => setDomEnabled(!domEnabled)}
                >
                  Market Depth
                </span>

                {/* Color swatch */}
                <div
                  style={{
                    width: 12, height: 12, borderRadius: RADIUS.SM, flexShrink: 0,
                    background: domColor, border: '1px solid var(--color-border)',
                    marginRight: 8,
                  }}
                />

                {/* Edit (pencil) button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingDom(true); }}
                  className="text-(--color-text-muted) hover:text-(--color-text) transition-colors"
                  title="Edit color"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>

              {/* Bid/Ask Footprint row */}
              <div
                className="flex items-center hover:bg-(--color-hover-row) transition-colors rounded-lg"
                style={{ padding: '8px 10px' }}
              >
                <button
                  onClick={() => setBidAskEnabled(!bidAskEnabled)}
                  style={{
                    width: 14, height: 14, borderRadius: RADIUS.MD, flexShrink: 0,
                    border: bidAskEnabled ? 'none' : '1.5px solid var(--color-text-muted)',
                    background: bidAskEnabled ? 'var(--color-accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {bidAskEnabled && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5">
                      <path d="M2 5l2.5 2.5L8 3" />
                    </svg>
                  )}
                </button>
                <span
                  className="flex-1 text-xs text-(--color-text) cursor-pointer select-none"
                  style={{ marginLeft: 10 }}
                  onClick={() => setBidAskEnabled(!bidAskEnabled)}
                >
                  Bid/Ask Footprint
                </span>
              </div>
            </div>
          ) : (
            (() => {
              const domParsed = parseColorWithOpacity(domColor);
              return (
                <div style={{ padding: 10, width: 252 }}>
                  {/* Back arrow + title */}
                  <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
                    <button
                      onClick={() => setEditingDom(false)}
                      className="text-(--color-text-muted) hover:text-(--color-text) transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="text-xs text-(--color-text) font-medium">Market Depth Settings</span>
                  </div>

                  {/* Color section */}
                  <div className={SECTION_LABEL} style={{ marginBottom: 6 }}>Color</div>

                  {/* Color palette grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3, marginBottom: 8 }}>
                    {COLOR_PALETTE.flat().map((c, i) => (
                      <ColorSwatch key={`${c}-${i}`} color={c} current={domParsed.hex} onClick={() => setDomColor(toRgba(c, domParsed.opacity))} />
                    ))}
                  </div>

                  {/* Custom color */}
                  <button
                    onClick={() => customInputRef.current?.click()}
                    style={{
                      width: 24, height: 24, borderRadius: RADIUS.MD,
                      border: '1px dashed var(--color-text-muted)', background: 'transparent',
                      color: 'var(--color-text-muted)', fontSize: 14, lineHeight: '22px',
                      cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    +
                  </button>
                  <input
                    ref={customInputRef}
                    type="color"
                    value={domParsed.hex}
                    onChange={(e) => setDomColor(toRgba(e.target.value, domParsed.opacity))}
                    style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                  />

                  {/* Opacity slider */}
                  <OpacitySlider
                    hex={domParsed.hex}
                    opacity={domParsed.opacity}
                    onChange={(op) => setDomColor(toRgba(domParsed.hex, op))}
                  />

                  {/* Divider */}
                  <div className="border-t border-(--color-border)" style={{ margin: '10px 0' }} />

                  {/* Hover Expand toggle */}
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => setDomHoverExpand(!domHoverExpand)}
                  >
                    <span className="text-xs text-(--color-text)">Hover Expand</span>
                    <div
                      style={{
                        width: 32, height: 18, borderRadius: RADIUS.PILL,
                        background: domHoverExpand ? 'var(--color-accent)' : 'var(--color-panel)',
                        border: '1px solid var(--color-border)',
                        position: 'relative',
                        transition: 'background var(--transition-fast)',
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        style={{
                          width: 14, height: 14, borderRadius: RADIUS.CIRCLE,
                          background: '#fff',
                          position: 'absolute', top: 1,
                          left: domHoverExpand ? 16 : 1,
                          transition: 'left var(--transition-fast)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
}


function StrategyButton() {
  const open    = useStore((s) => s.backtestOpen);
  const setOpen = useStore((s) => s.setBacktestOpen);
  return (
    <button
      onClick={() => setOpen(!open)}
      className={`h-full flex items-center gap-1 text-xs font-medium rounded transition-colors hover:bg-(--color-border) ${open ? 'text-(--color-accent)' : 'text-(--color-text)'}`}
      style={{ paddingLeft: 12, paddingRight: 12 }}
      title="Strategy Lab"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
      Strategy
    </button>
  );
}

export function ChartToolbar() {
  const pinnedTimeframes = useStore((s) => s.pinnedTimeframes);
  const customTimeframes = useStore((s) => s.customTimeframes);
  const pinTimeframe = useStore((s) => s.pinTimeframe);
  const unpinTimeframe = useStore((s) => s.unpinTimeframe);
  const addCustomTimeframe = useStore((s) => s.addCustomTimeframe);
  const removeCustomTimeframe = useStore((s) => s.removeCustomTimeframe);
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

  const marketType = useStore((s) => s.contract?.marketType ?? 'futures') as MarketType;
  const { time: nyClock, marketOpen, is24h } = useNYClock(marketType);

  // Screenshot state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const cameraRef = useRef<HTMLDivElement>(null);

  // Recording state
  const selectedChart = useStore((s) => s.selectedChart);
  const { isRecording, elapsed, start: startRecording, stop: stopRecording } = useRecording();

  // Click outside to close camera dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (cameraRef.current && !cameraRef.current.contains(e.target as Node)) {
        setCameraOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** Take a screenshot of a single chart entry, painting PriceLevelLine instances onto the canvas */
  function screenshotEntry(entry: ChartEntry, options: ScreenshotOptions): HTMLCanvasElement {
    if (entry.primitive && !options.showDrawings) entry.primitive.visible = false;
    if (entry.tradeZonePrimitive && !options.showTrades) entry.tradeZonePrimitive.visible = false;
    for (const e of entry.orderEntriesRef.current) {
      if (e.meta.kind === 'phantom-bracket' || !options.showPositions) e.line.visible = false;
    }
    for (const l of entry.previewLinesRef.current) l.visible = false;

    const canvas = entry.chart.takeScreenshot(true);

    if (entry.primitive && !options.showDrawings) entry.primitive.visible = true;
    if (entry.tradeZonePrimitive && !options.showTrades) entry.tradeZonePrimitive.visible = true;
    for (const e of entry.orderEntriesRef.current) {
      if (e.meta.kind === 'phantom-bracket' || !options.showPositions) e.line.visible = true;
    }
    for (const l of entry.previewLinesRef.current) l.visible = true;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      const plotWidth = entry.chart.timeScale().width();
      const cssWidth = entry.containerEl?.clientWidth ?? canvas.width;
      const dpr = canvas.width / cssWidth;
      if (dpr !== 1) ctx.scale(dpr, dpr);
      paintOverlays(ctx, entry, plotWidth, canvas.height / dpr, cssWidth);
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

  async function handleToggleRecording() {
    if (isRecording) {
      await stopRecording();
    } else {
      const withMic = localStorage.getItem('recording-mic-enabled') === 'true';
      await startRecording(selectedChart, { withMic });
    }
  }


  return (
    <div className="flex items-center gap-2 px-4 bg-(--color-panel) border-b border-(--color-border)" style={{ paddingTop: '7px', paddingBottom: '7px' }}>
      <InstrumentSelectorPopover />

      {/* Timeframe picker */}
      <TimeframePicker
        value={timeframe}
        onChange={setTimeframe}
        pinnedTimeframes={pinnedTimeframes}
        onPin={pinTimeframe}
        onUnpin={unpinTimeframe}
        customTimeframes={customTimeframes}
        onAddCustom={addCustomTimeframe}
        onRemoveCustom={removeCustomTimeframe}
      />


      {/* Indicators */}
      <IndicatorsDropdown />

      {/* Strategy */}
      <StrategyButton />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right icon group — flush hit areas */}
      <div className="flex items-stretch self-stretch">

      {/* Layout toggle */}
      <button
        onClick={() => {
          const next = !dualChart;
          setDualChart(next);
          if (next) setSelectedChart('left');
        }}
        className="self-stretch flex items-center rounded text-(--color-text) hover:bg-(--color-border) transition-colors"
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

      {/* Screenshot button */}
      <div ref={cameraRef} className="relative self-stretch flex items-center">
        <button
          onClick={() => setCameraOpen((o) => !o)}
          className={`h-full flex items-center justify-center rounded hover:bg-(--color-border) transition-colors ${copied ? 'text-green-400' : 'text-(--color-text)'}`}
          style={{ paddingLeft: 12, paddingRight: 12 }}
          title="Chart screenshot"
        >
          {copied ? (
            <svg width={CHART_ICON_SIZE} height={CHART_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width={CHART_ICON_SIZE} height={CHART_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          )}
        </button>

        {cameraOpen && (
          <div
            className="absolute top-full right-0 mt-1.5 bg-(--color-panel) border border-(--color-border)/60 rounded-xl animate-dropdown-in"
            style={{ zIndex: Z.DROPDOWN, boxShadow: SHADOW.XXL, padding: '6px' }}
          >
            <button
              onClick={handleCopyChartImage}
              className="w-full flex items-center gap-2.5 text-xs text-(--color-text) hover:bg-(--color-border) transition-colors rounded-lg"
              style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
            >
              <svg width={CHART_ICON_SIZE} height={CHART_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              Copy chart image
            </button>
            <div className="border-t border-(--color-border)/40 my-1 mx-2" />
            <button
              onClick={handleCustomSnapshot}
              className="w-full flex items-center gap-2.5 text-xs text-(--color-text) hover:bg-(--color-border) transition-colors rounded-lg"
              style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
            >
              <svg width={CHART_ICON_SIZE} height={CHART_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Custom snapshot
            </button>
          </div>
        )}
      </div>


      {/* Record button */}
      <button
        onClick={handleToggleRecording}
        className={`self-stretch flex items-center justify-center rounded transition-colors hover:bg-(--color-border) ${isRecording ? 'text-(--color-sell)' : 'text-(--color-text)'}`}
        style={{ paddingLeft: 12, paddingRight: 12 }}
        title={isRecording ? 'Stop recording' : 'Record chart'}
      >
        {isRecording ? (
          <RecordingIndicator elapsed={elapsed} />
        ) : (
          <svg width={CHART_ICON_SIZE} height={CHART_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="2" y="4" width="15" height="16" rx="2" />
            <path d="M17 9l5-3v12l-5-3V9z" />
          </svg>
        )}
      </button>

      </div>{/* end right icon group */}

      {/* NY clock + market status */}
      <div className="flex items-center gap-1.5" style={{ marginRight: '8px' }}>
        {!is24h && (
          <span
            title={marketOpen ? 'Market open' : 'Market closed'}
            style={{
              display: 'inline-block',
              width: 6, height: 6,
              borderRadius: RADIUS.CIRCLE,
              background: marketOpen ? 'var(--color-buy)' : 'var(--color-sell)',
              flexShrink: 0,
            }}
          />
        )}
        <span className="text-xs text-(--color-text)" style={{ fontVariantNumeric: 'tabular-nums' }}>
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
      <StrategyLabModal />
    </div>
  );
}
