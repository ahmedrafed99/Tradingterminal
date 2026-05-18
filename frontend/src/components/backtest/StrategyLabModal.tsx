import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import type { Contract } from '../../services/marketDataService';
import { CandlestickChart } from '../chart/CandlestickChart';
import { EquityCurveChart } from './EquityCurveChart';
import { BacktestTradesTable } from './BacktestTradesTable';
import { DateRangePicker } from './DateRangePicker';
import { SymbolPickerModal } from '../shared/SymbolPickerModal';
import { TimeframePicker } from '../shared/TimeframePicker';
import { ToolbarPillButton } from '../shared/ToolbarPillButton';
import { CustomSelect } from '../shared/CustomSelect';
import { VerticalSeparator } from '../shared/VerticalSeparator';
import { ChevronDown } from '../icons/ChevronDown';
import { backtestService, type EquityPoint, type SymbolEntry } from '../../services/backtestService';
import { Z, RADIUS, FONT_FAMILY } from '../../constants/layout';

// ---------------------------------------------------------------------------
// Contract lookup — add entries here when new symbols are extracted
// ---------------------------------------------------------------------------

// Worst-case taker fee across Binance / Bybit / MEXC / Hyperliquid perps.
const WORST_CASE_TAKER_FEE = 0.00055; // 0.055% per side (Bybit)

const CONTRACT_MAP: Record<string, Contract> = {
  'BINANCE:BTCUSDT': {
    id: 'BTCUSDT', name: 'BTCUSDT',
    description: 'Bitcoin / USDT (Binance)',
    tickSize: 0.01, tickValue: 0.01,
    activeContract: true, marketType: 'crypto',
    ticksPerPoint: 100, quantityStep: 0.001,
    pricePrecision: 2, quantityPrecision: 3,
    takerFee: WORST_CASE_TAKER_FEE,
  },
  'BINANCE:ETHUSDT': {
    id: 'ETHUSDT', name: 'ETHUSDT',
    description: 'Ethereum / USDT (Binance)',
    tickSize: 0.01, tickValue: 0.01,
    activeContract: true, marketType: 'crypto',
    ticksPerPoint: 100, quantityStep: 0.001,
    pricePrecision: 2, quantityPrecision: 3,
    takerFee: WORST_CASE_TAKER_FEE,
  },
};

function getContract(exchange: string, symbol: string): Contract {
  return CONTRACT_MAP[`${exchange}:${symbol}`] ?? {
    id: symbol, name: symbol,
    description: `${symbol} (${exchange})`,
    tickSize: 0.01, tickValue: 0.01,
    activeContract: true, marketType: 'crypto',
    ticksPerPoint: 100, quantityStep: 0.001,
    pricePrecision: 2, quantityPrecision: 3,
    takerFee: WORST_CASE_TAKER_FEE,
  };
}

// ---------------------------------------------------------------------------

const INITIAL_EQUITY = 1_000;

function MetricTile({ label, value, sub, valueColor, subColor }: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  subColor?: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 110, padding: '2px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</span>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
          <circle cx="8" cy="8" r="6.5" stroke="var(--color-text-muted)" strokeWidth="1" />
          <path d="M8 7v4" stroke="var(--color-text-muted)" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="8" cy="5" r="0.6" fill="var(--color-text-muted)" />
        </svg>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, lineHeight: 1.1 }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: valueColor ?? 'var(--color-text)', fontFeatureSettings: '"tnum"' }}>{value}</span>
        {sub && (
          <span style={{ fontSize: 12, color: subColor ?? 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}>{sub}</span>
        )}
      </div>
    </div>
  );
}

export function StrategyLabModal() {
  const open                = useStore((s) => s.backtestOpen);
  const setOpen             = useStore((s) => s.setBacktestOpen);
  const exchange            = useStore((s) => s.backtestExchange);
  const symbol              = useStore((s) => s.backtestSymbol);
  const setInstrument       = useStore((s) => s.setBacktestInstrument);
  const from                = useStore((s) => s.backtestFrom);
  const to                  = useStore((s) => s.backtestTo);
  const setDateRange        = useStore((s) => s.setBacktestDateRange);
  const timeframe           = useStore((s) => s.backtestTimeframe);
  const setTimeframe        = useStore((s) => s.setBacktestTimeframe);
  const pinnedTimeframes    = useStore((s) => s.pinnedTimeframes);
  const customTimeframes    = useStore((s) => s.customTimeframes);
  const pinTimeframe        = useStore((s) => s.pinTimeframe);
  const unpinTimeframe      = useStore((s) => s.unpinTimeframe);
  const addCustomTimeframe  = useStore((s) => s.addCustomTimeframe);
  const removeCustomTimeframe = useStore((s) => s.removeCustomTimeframe);
  const strategyName        = useStore((s) => s.backtestStrategyName);
  const strategyCode        = useStore((s) => s.backtestStrategyCode);
  const strategies          = useStore((s) => s.backtestStrategies);
  const setStrategyCode     = useStore((s) => s.setBacktestStrategyCode);
  const switchStrategy      = useStore((s) => s.switchBacktestStrategy);
  const addStrategy         = useStore((s) => s.addBacktestStrategy);
  const deleteStrategy      = useStore((s) => s.deleteBacktestStrategy);
  const renameStrategy      = useStore((s) => s.renameBacktestStrategy);
  const running             = useStore((s) => s.backtestRunning);
  const setRunning          = useStore((s) => s.setBacktestRunning);
  const status              = useStore((s) => s.backtestStatus);
  const setStatus           = useStore((s) => s.setBacktestStatus);
  const result              = useStore((s) => s.backtestResult);
  const setResult                   = useStore((s) => s.setBacktestResult);
  const setSelectedTradeIndex       = useStore((s) => s.setBacktestSelectedTradeIndex);
  const bottomRatio                 = useStore((s) => s.backtestBottomRatio);
  const setBottomRatio              = useStore((s) => s.setBacktestBottomRatio);
  const setBottomPreviousRatio      = useStore((s) => s.setBacktestBottomPreviousRatio);
  const toggleBottom                = useStore((s) => s.toggleBacktestBottom);

  const [datePickerOpen, setDatePickerOpen]         = useState(false);
  const [activeTab, setActiveTab]                   = useState<'curve' | 'trades'>('curve');
  const [editorOpen, setEditorOpen]                 = useState(false);
  const [equityPoints, setEquityPoints]             = useState<EquityPoint[]>([]);
  const [symbols, setSymbols]                       = useState<SymbolEntry[]>([]);
  const [symbolMenuOpen, setSymbolMenuOpen]         = useState(false);
  const [availableRange, setAvailableRange]         = useState<{ from: string; to: string } | null>(null);
  const [renamingStrategy, setRenamingStrategy]     = useState<string | null>(null);
  const [renameValue, setRenameValue]               = useState('');

  const commitRename = useCallback((oldName: string) => {
    const trimmed = renameValue.trim();
    setRenamingStrategy(null);
    if (!trimmed || trimmed === oldName) return;
    if (strategies.some(s => s.name === trimmed)) return;
    renameStrategy(oldName, trimmed);
    backtestService.renameStrategy(oldName, trimmed);
  }, [renameValue, strategies, renameStrategy]);

  const initStrategies        = useStore((s) => s.initBacktestStrategies);

  const abortRef                  = useRef<(() => void) | null>(null);
  const saveCodeTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitContainerRef         = useRef<HTMLDivElement>(null);

  // Load available symbols + strategies from disk on open
  useEffect(() => {
    if (!open) return;

    backtestService.getSymbols().then((list) => {
      setSymbols(list);
      if (list.length > 0 && !list.some(s => s.exchange === exchange && s.symbol === symbol)) {
        setInstrument(list[0].exchange, list[0].symbol);
      }
    });

    backtestService.listStrategies().then(async (diskStrategies) => {
      if (diskStrategies.length === 0) {
        // First run — seed disk with current store strategies
        for (const st of strategies) {
          await backtestService.saveStrategy(st.name, st.code);
        }
      } else {
        initStrategies(diskStrategies);
      }
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved result whenever the active strategy changes
  useEffect(() => {
    if (!open || !strategyName) return;
    backtestService.loadResult(strategyName).then((saved) => {
      setResult(saved);
      setEquityPoints(saved?.equityCurve ?? []);
    });
  }, [open, strategyName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced save of strategy code to disk
  useEffect(() => {
    if (!open) return;
    if (saveCodeTimerRef.current) clearTimeout(saveCodeTimerRef.current);
    saveCodeTimerRef.current = setTimeout(() => {
      backtestService.saveStrategy(strategyName, strategyCode);
    }, 800);
    return () => { if (saveCodeTimerRef.current) clearTimeout(saveCodeTimerRef.current); };
  }, [strategyCode, strategyName, open]);

  // Fetch available date range whenever the symbol changes
  useEffect(() => {
    if (!open || !exchange || !symbol) return;
    backtestService.getAvailableRange(exchange, symbol).then(setAvailableRange);
  }, [open, exchange, symbol]);

  const handleRun = useCallback(async () => {
    if (running) {
      abortRef.current?.();
      setRunning(false);
      setStatus('Stopped');
      return;
    }

    setEquityPoints([]);
    setResult(null);
    setSelectedTradeIndex(null);
    setRunning(true);
    setStatus('Starting...');

    const { promise, abort } = backtestService.runStrategy(
      {
        exchange,
        symbol,
        unit: timeframe.unit,
        unitNumber: timeframe.unitNumber,
        from,
        to,
        initialEquity: INITIAL_EQUITY,
        strategyCode,
        takerFee: getContract(exchange, symbol).takerFee ?? WORST_CASE_TAKER_FEE,
      },
      () => {},
      (msg) => setStatus(msg),
    );

    abortRef.current = abort;

    try {
      const res = await promise;
      setEquityPoints(res.equityCurve);
      setResult(res);
      setStatus(`Done — ${res.totalTrades} trades`);
      backtestService.saveResult(strategyName, res, {
        exchange,
        symbol,
        from,
        to,
        timeframe: timeframe.label,
        initialEquity: INITIAL_EQUITY,
      });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Error');
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [running, exchange, symbol, timeframe, from, to, strategyCode, setRunning, setStatus, setResult]);

  const contract = useMemo(() => getContract(exchange, symbol), [exchange, symbol]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ zIndex: Z.MODAL, background: 'var(--color-bg)' }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 border-b border-(--color-border) shrink-0"
        style={{ padding: '10px 16px', background: 'var(--color-panel)' }}
      >
        {/* Symbol selector */}
        <ToolbarPillButton onClick={() => setSymbolMenuOpen(true)} className="font-medium">
          <span style={{ color: 'var(--color-text-muted)', marginRight: 2 }}>{exchange}</span>
          {symbol}
          <ChevronDown className="opacity-50" />
        </ToolbarPillButton>

        <div className="w-px self-stretch bg-(--color-border)" style={{ margin: '0 4px' }} />

        {/* Date range button */}
        <ToolbarPillButton onClick={() => setDatePickerOpen(true)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 2v2M11 2v2M2 7h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {from} → {to}
        </ToolbarPillButton>

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

        <div className="flex-1" />

        {/* Status */}
        {status && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {status}
          </span>
        )}

        {/* Script editor toggle */}
        <button
          onClick={() => setEditorOpen((o) => !o)}
          className={`flex items-center gap-1.5 text-xs font-medium transition-colors rounded-md hover:bg-(--color-border) ${editorOpen ? 'text-(--color-accent)' : 'text-(--color-text)'}`}
          style={{ padding: '5px 10px' }}
          title="Toggle strategy editor"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
          </svg>
          Script
        </button>

        {/* Run / Stop */}
        <button
          onClick={handleRun}
          style={{
            background: running ? 'var(--color-sell)' : 'var(--color-label-close)',
            border: 'none',
            color: running ? '#fff' : 'var(--color-label-text)',
            fontSize: 13,
            fontFamily: FONT_FAMILY,
            cursor: 'pointer',
            padding: '6px 20px',
            borderRadius: RADIUS.LG,
            fontWeight: 500,
            transition: 'background var(--transition-fast)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = running ? 'var(--color-sell)' : 'var(--color-label-close-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = running ? 'var(--color-sell)' : 'var(--color-label-close)'; }}
        >
          {running ? (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>Stop</>
          ) : (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>Run</>
          )}
        </button>

        {/* Close */}
        <button
          onClick={() => setOpen(false)}
          className="flex items-center justify-center text-(--color-text-muted) hover:text-(--color-text) hover:bg-(--color-border) transition-colors rounded-md"
          style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-row min-h-0">

        {/* ── Left: chart + results ── */}
        <div ref={splitContainerRef} className="flex-1 flex flex-col min-h-0 min-w-0">

          {/* Chart */}
          <div
            style={{ flex: 1 - bottomRatio, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}
          >
            <CandlestickChart
              chartId="backtest"
              contract={contract}
              timeframe={timeframe}
              backtestConfig={{ exchange, symbol, dateFrom: from, dateTo: to }}
            />
          </div>

          <VerticalSeparator
            containerRef={splitContainerRef}
            collapsed={bottomRatio <= 0.05}
            onToggle={toggleBottom}
            onDrag={(mouseRatio) => {
              const newRatio = 1 - mouseRatio;
              setBottomRatio(newRatio);
              if (newRatio >= 0.05) setBottomPreviousRatio(newRatio);
            }}
          />

          {/* ── Equity curve + results ── */}
          <div
            style={{ flex: bottomRatio, minHeight: bottomRatio <= 0.05 ? 0 : 40, background: 'var(--color-panel)' }}
            className="flex flex-col overflow-hidden"
          >

          {/* Stats row */}
          {result && (() => {
            const pnl = result.finalEquity - INITIAL_EQUITY;
            const pnlPositive = result.totalReturn >= 0;
            const pnlColor = pnlPositive ? 'var(--color-buy)' : 'var(--color-sell)';
            return (
              <div style={{ padding: '14px 20px 4px', flexShrink: 0 }}>
                <div className="flex flex-wrap" style={{ gap: 28 }}>
                  <MetricTile
                    label="Net P&L"
                    value={`${pnlPositive ? '+' : ''}$${pnl.toFixed(2)}`}
                    sub={`${pnlPositive ? '+' : ''}${result.totalReturn.toFixed(2)}%`}
                    valueColor={pnlColor}
                    subColor={pnlColor}
                  />
                  <MetricTile
                    label="Max drawdown"
                    value={`-${result.maxDrawdown.toFixed(2)}%`}
                    valueColor="var(--color-sell)"
                  />
                  <MetricTile
                    label="Win rate"
                    value={`${result.winRate.toFixed(1)}%`}
                    sub={`${result.totalTrades} trades`}
                  />
                  <MetricTile label="Sharpe"       value={result.sharpe.toFixed(2)} />
                  <MetricTile label="Final equity" value={`$${result.finalEquity.toFixed(2)}`} />
                </div>
              </div>
            );
          })()}

          {/* Tab selector */}
          <div className="flex items-center gap-4" style={{ padding: '8px 16px 0', flexShrink: 0 }}>
            {(['curve', 'trades'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="text-xs font-medium transition-colors"
                style={{
                  padding: '4px 0',
                  color: activeTab === tab ? 'var(--color-text)' : 'var(--color-text-muted)',
                  background: 'transparent', border: 'none',
                  borderBottomStyle: 'solid',
                  borderBottomWidth: 2,
                  borderBottomColor: activeTab === tab ? 'var(--color-text)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                {tab === 'curve' ? 'Equity Curve' : `Trades${result ? ` (${result.totalTrades})` : ''}`}
              </button>
            ))}
          </div>

          {/* Always mounted — display:none keeps LWC chart alive and prevents
              "Object is disposed" from a queued ResizeObserver firing after unmount */}
          <div style={{ padding: '8px 0 0', flex: 1, minHeight: 0, display: activeTab === 'curve' ? undefined : 'none' }}>
            <EquityCurveChart
              points={equityPoints}
              initialEquity={INITIAL_EQUITY}
              isEmpty={!running && equityPoints.length === 0}
              height="100%"
            />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: activeTab === 'trades' ? undefined : 'none' }}>
            {result
              ? <BacktestTradesTable trades={result.trades} />
              : <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>Run a strategy to see the trade log</div>
            }
          </div>
          </div>
        </div>{/* end left column */}

        {/* ── Right sidebar: script editor ── */}
        {editorOpen && (
          <div style={{ width: 380, flexShrink: 0, borderLeft: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center gap-2" style={{ padding: '8px 16px', background: 'var(--color-panel)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              {/* Strategy name dropdown */}
              <CustomSelect
                value={strategyName}
                options={strategies.map((s) => ({ value: s.name, label: s.name }))}
                onChange={(name) => { switchStrategy(name); setResult(null); setEquityPoints([]); setSelectedTradeIndex(null); }}
                fontSize={12}
                padding="5px 10px"
                dropdownMinWidth={200}
                renderItem={(o) => renamingStrategy === o.value ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') commitRename(o.value);
                      else if (e.key === 'Escape') setRenamingStrategy(null);
                    }}
                    onBlur={() => commitRename(o.value)}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      background: 'transparent',
                      color: 'inherit',
                      border: 'none',
                      outline: 'none',
                      fontSize: 12,
                      fontFamily: FONT_FAMILY,
                    }}
                  />
                ) : null}
                renderItemAction={(o) => (
                  <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenameValue(o.value);
                        setRenamingStrategy(o.value);
                      }}
                      title="Rename strategy"
                      style={{ padding: '4px 6px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', opacity: 0.4, display: 'flex', alignItems: 'center' }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </button>
                    {strategies.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteStrategy(o.value);
                          backtestService.deleteStrategy(o.value);
                        }}
                        title="Delete strategy"
                        style={{ padding: '4px 8px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', opacity: 0.4, display: 'flex', alignItems: 'center' }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--color-sell)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.color = 'inherit'; }}
                      >
                        <svg width="17" height="17" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor">
                          <path d="M18 7h5v1h-2.01l-1.33 14.64a1.5 1.5 0 0 1-1.5 1.36H9.84a1.5 1.5 0 0 1-1.49-1.36L7.01 8H5V7h5V6c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v1Zm-6-2a1 1 0 0 0-1 1v1h6V6a1 1 0 0 0-1-1h-4ZM8.02 8l1.32 14.54a.5.5 0 0 0 .5.46h8.33a.5.5 0 0 0 .5-.46L19.99 8H8.02Z" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
                footer={
                  <button
                    onClick={() => {
                      addStrategy();
                      let n = 1;
                      while (strategies.some(st => st.name === `Strategy ${n}`)) n++;
                      backtestService.saveStrategy(`Strategy ${n}`, '');
                    }}
                    className="w-full text-left flex items-center gap-1.5 transition-colors hover:bg-(--color-hover-row)"
                    style={{ padding: '6px 10px', fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer', border: 'none', background: 'transparent' }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    New strategy
                  </button>
                }
              />
            </div>
            <textarea
              value={strategyCode}
              onChange={(e) => setStrategyCode(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1,
                width: '100%',
                background: 'var(--color-panel)',
                color: 'var(--color-text)',
                border: 'none',
                outline: 'none',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 12,
                padding: '12px 16px',
                resize: 'none',
                lineHeight: 1.6,
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}
      </div>

      {/* Symbol picker modal */}
      {symbolMenuOpen && (
        <SymbolPickerModal
          items={symbols.map((s) => ({
            key: `${s.exchange}:${s.symbol}`,
            name: s.symbol,
            exchange: s.exchange,
          }))}
          selectedKey={`${exchange}:${symbol}`}
          onSelect={(item) => {
            const [ex, sym] = item.key.split(':');
            setInstrument(ex, sym);
          }}
          onClose={() => setSymbolMenuOpen(false)}
          emptyMessage="No data extracted yet. Run: npm run extract-ticks"
        />
      )}

      {/* Date range picker modal */}
      {datePickerOpen && (
        <DateRangePicker
          from={from}
          to={to}
          minDate={availableRange?.from}
          maxDate={availableRange?.to}
          onChange={(f, t) => setDateRange(f, t)}
          onClose={() => setDatePickerOpen(false)}
        />
      )}
    </div>
  );
}
