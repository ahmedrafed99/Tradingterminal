import { useState, useRef, useCallback, useEffect } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useStore } from '../../store/useStore';
import type { Contract } from '../../services/marketDataService';
import { CandlestickChart } from '../chart/CandlestickChart';
import { EquityCurveChart, type EquityCurveHandle } from './EquityCurveChart';
import { DateRangePicker } from './DateRangePicker';
import { SymbolPickerModal } from '../shared/SymbolPickerModal';
import { TimeframePicker } from '../shared/TimeframePicker';
import { backtestService, type BacktestResult, type SymbolEntry } from '../../services/backtestService';
import { Z, RADIUS, SHADOW, FONT_SIZE, FONT_FAMILY } from '../../constants/layout';
import { SECTION_LABEL } from '../../constants/styles';

// ---------------------------------------------------------------------------
// Contract lookup — add entries here when new symbols are extracted
// ---------------------------------------------------------------------------

const CONTRACT_MAP: Record<string, Contract> = {
  'BINANCE:BTCUSDT': {
    id: 'BTCUSDT', name: 'BTCUSDT',
    description: 'Bitcoin / USDT (Binance)',
    tickSize: 0.01, tickValue: 0.01,
    activeContract: true, marketType: 'crypto',
    ticksPerPoint: 100, quantityStep: 0.001,
    pricePrecision: 2, quantityPrecision: 3,
  },
  'BINANCE:ETHUSDT': {
    id: 'ETHUSDT', name: 'ETHUSDT',
    description: 'Ethereum / USDT (Binance)',
    tickSize: 0.01, tickValue: 0.01,
    activeContract: true, marketType: 'crypto',
    ticksPerPoint: 100, quantityStep: 0.001,
    pricePrecision: 2, quantityPrecision: 3,
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
  };
}

// ---------------------------------------------------------------------------

const INITIAL_EQUITY = 10_000;

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 100, padding: '10px 14px', background: 'var(--color-panel)', borderRadius: RADIUS.LG, border: '1px solid var(--color-border)' }}>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function TradeRow({ trade, index }: { trade: BacktestResult['trades'][number]; index: number }) {
  const pnlColor = trade.pnl >= 0 ? 'var(--color-buy)' : 'var(--color-sell)';
  return (
    <div
      className="flex items-center gap-3 hover:bg-(--color-hover-row) transition-colors"
      style={{ padding: '6px 12px', fontSize: 11, borderBottom: '1px solid var(--color-border)' }}
    >
      <span style={{ color: 'var(--color-text-muted)', width: 28, flexShrink: 0 }}>#{index + 1}</span>
      <span style={{ color: trade.side === 'long' ? 'var(--color-buy)' : 'var(--color-sell)', width: 36, flexShrink: 0 }}>{trade.side}</span>
      <span style={{ flex: 1, color: 'var(--color-text-muted)' }}>{new Date(trade.entryTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      <span style={{ width: 80, textAlign: 'right', color: 'var(--color-text)' }}>${trade.entryPrice.toFixed(2)}</span>
      <span style={{ width: 80, textAlign: 'right', color: 'var(--color-text)' }}>${trade.exitPrice.toFixed(2)}</span>
      <span style={{ width: 72, textAlign: 'right', color: pnlColor, fontWeight: 600 }}>
        {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
      </span>
      <span style={{ width: 56, textAlign: 'right', color: pnlColor }}>
        {trade.pnlPct >= 0 ? '+' : ''}{trade.pnlPct.toFixed(2)}%
      </span>
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
  const running             = useStore((s) => s.backtestRunning);
  const setRunning          = useStore((s) => s.setBacktestRunning);
  const status              = useStore((s) => s.backtestStatus);
  const setStatus           = useStore((s) => s.setBacktestStatus);
  const result              = useStore((s) => s.backtestResult);
  const setResult           = useStore((s) => s.setBacktestResult);

  const [datePickerOpen, setDatePickerOpen]         = useState(false);
  const [activeTab, setActiveTab]                   = useState<'curve' | 'trades'>('curve');
  const [editorOpen, setEditorOpen]                 = useState(false);
  const [isEmpty, setIsEmpty]                       = useState(true);
  const [symbols, setSymbols]                       = useState<SymbolEntry[]>([]);
  const [symbolMenuOpen, setSymbolMenuOpen]         = useState(false);
  const [availableRange, setAvailableRange]         = useState<{ from: string; to: string } | null>(null);
  const [strategyDropdownOpen, setStrategyDropdownOpen] = useState(false);

  const abortRef              = useRef<(() => void) | null>(null);
  const equityRef             = useRef<EquityCurveHandle | null>(null);
  const strategyDropdownRef   = useRef<HTMLDivElement>(null);

  useClickOutside(strategyDropdownRef, strategyDropdownOpen, () => setStrategyDropdownOpen(false));

  // Load available symbols on open
  useEffect(() => {
    if (!open) return;
    backtestService.getSymbols().then((list) => {
      setSymbols(list);
      // If current selection isn't in the list, default to first available
      if (list.length > 0 && !list.some(s => s.exchange === exchange && s.symbol === symbol)) {
        setInstrument(list[0].exchange, list[0].symbol);
      }
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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

    equityRef.current?.clear();
    setIsEmpty(false);
    setResult(null);
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
      },
      (point) => equityRef.current?.addPoint(point),
      (msg) => setStatus(msg),
    );

    abortRef.current = abort;

    try {
      const res = await promise;
      setResult(res);
      setStatus(`Done — ${res.totalTrades} trades`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Error');
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [running, exchange, symbol, timeframe, from, to, strategyCode, setRunning, setStatus, setResult]);

  if (!open) return null;

  const contract = getContract(exchange, symbol);

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
        <button
          onClick={() => setSymbolMenuOpen(true)}
          className="flex items-center gap-1.5 text-xs font-medium hover:bg-(--color-border) transition-colors rounded-md"
          style={{ padding: '5px 10px', background: 'var(--color-input)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
        >
          <span style={{ color: 'var(--color-text-muted)', marginRight: 2 }}>{exchange}</span>
          {symbol}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ opacity: 0.5 }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div className="w-px self-stretch bg-(--color-border)" style={{ margin: '0 4px' }} />

        {/* Date range button */}
        <button
          onClick={() => setDatePickerOpen(true)}
          className="flex items-center gap-1.5 text-xs text-(--color-text) hover:bg-(--color-border) transition-colors rounded-md"
          style={{ padding: '5px 10px', background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 2v2M11 2v2M2 7h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {from} → {to}
        </button>

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
        <div className="flex-1 flex flex-col min-h-0 min-w-0">

          {/* Chart */}
          <div style={{ flex: 1, minHeight: 300, position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <CandlestickChart
              chartId="backtest"
              contract={contract}
              timeframe={timeframe}
              backtestConfig={{ exchange, symbol, dateFrom: from, dateTo: to }}
            />
          </div>

          {/* ── Equity curve + results ── */}
          <div style={{ borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>

          {/* Stats row */}
          {result && (
            <div style={{ padding: '12px 16px 0' }}>
              <div className="flex gap-2 flex-wrap">
                <StatCard
                  label="Net P&L"
                  value={`${result.totalReturn >= 0 ? '+' : ''}$${(result.finalEquity - INITIAL_EQUITY).toFixed(2)}`}
                  sub={`${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn.toFixed(2)}%`}
                />
                <StatCard label="Win Rate"     value={`${result.winRate.toFixed(1)}%`} sub={`${result.totalTrades} trades`} />
                <StatCard label="Max DD"       value={`-${result.maxDrawdown.toFixed(2)}%`} />
                <StatCard label="Sharpe"       value={result.sharpe.toFixed(2)} />
                <StatCard label="Final Equity" value={`$${result.finalEquity.toFixed(2)}`} />
              </div>
            </div>
          )}

          {/* Tab selector */}
          <div className="flex items-center gap-4" style={{ padding: '8px 16px 0' }}>
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
                  borderBottomColor: activeTab === tab ? 'var(--color-accent)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                {tab === 'curve' ? 'Equity Curve' : `Trades${result ? ` (${result.totalTrades})` : ''}`}
              </button>
            ))}
          </div>

          {activeTab === 'curve' && (
            <div style={{ padding: '8px 16px 16px' }}>
              <EquityCurveChart ref={equityRef} initialEquity={INITIAL_EQUITY} isEmpty={isEmpty} />
            </div>
          )}

          {activeTab === 'trades' && result && (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              <div
                className="flex items-center gap-3 sticky top-0"
                style={{ padding: '5px 12px', fontSize: 10, background: 'var(--color-panel)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}
              >
                <span style={{ width: 28 }}>#</span>
                <span style={{ width: 36 }}>Side</span>
                <span style={{ flex: 1 }}>Entry Time</span>
                <span style={{ width: 80, textAlign: 'right' }}>Entry</span>
                <span style={{ width: 80, textAlign: 'right' }}>Exit</span>
                <span style={{ width: 72, textAlign: 'right' }}>P&L</span>
                <span style={{ width: 56, textAlign: 'right' }}>%</span>
              </div>
              {result.trades.map((trade, i) => (
                <TradeRow key={i} trade={trade} index={i} />
              ))}
            </div>
          )}

          {activeTab === 'trades' && !result && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
              Run a strategy to see the trade log
            </div>
          )}
          </div>
        </div>{/* end left column */}

        {/* ── Right sidebar: script editor ── */}
        {editorOpen && (
          <div style={{ width: 380, flexShrink: 0, borderLeft: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center gap-2" style={{ padding: '8px 16px', background: 'var(--color-panel)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              {/* Strategy name dropdown */}
              <div ref={strategyDropdownRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setStrategyDropdownOpen((o) => !o)}
                  className="flex items-center gap-1.5 text-xs font-medium hover:bg-(--color-border) transition-colors rounded-md"
                  style={{ padding: '5px 10px', background: 'var(--color-input)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                >
                  {strategyName}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ opacity: 0.5 }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {strategyDropdownOpen && (
                  <div
                    className="absolute top-full mt-1 rounded-lg border border-(--color-border) py-1"
                    style={{ background: 'var(--color-surface)', boxShadow: SHADOW.LG, minWidth: 180, zIndex: Z.DROPDOWN }}
                  >
                    {strategies.map((s) => {
                      const active = s.name === strategyName;
                      return (
                        <button
                          key={s.name}
                          onClick={() => { switchStrategy(s.name); setStrategyDropdownOpen(false); }}
                          className="w-full text-left flex items-center rounded-md mx-1.5 transition-colors hover:bg-(--color-hover-row)"
                          style={{
                            width: 'calc(100% - 12px)', padding: '6px 10px', fontSize: 12, border: 'none', cursor: 'pointer',
                            background: active ? 'var(--color-text)' : 'transparent',
                            color: active ? 'var(--color-surface)' : 'var(--color-text)',
                            fontWeight: active ? 500 : 400,
                          }}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                    <div className="mx-1.5 my-1" style={{ borderTop: '1px solid var(--color-border)' }} />
                    <button
                      onClick={() => { addStrategy(); setStrategyDropdownOpen(false); }}
                      className="w-full text-left flex items-center gap-1.5 rounded-md mx-1.5 transition-colors hover:bg-(--color-hover-row)"
                      style={{ width: 'calc(100% - 12px)', padding: '6px 10px', fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer', border: 'none', background: 'transparent' }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      New strategy
                    </button>
                  </div>
                )}
              </div>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                bar · prevBars · position · equity · state · setTrailingStop(dist)
              </span>
            </div>
            <textarea
              value={strategyCode}
              onChange={(e) => setStrategyCode(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1,
                width: '100%',
                background: 'var(--color-bg)',
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
