import type { Timeframe } from './instrumentSlice';
import type { BacktestResult, EquityPoint } from '../../services/backtestService';

export interface StrategyEntry {
  name: string;
  code: string;
}

export interface BacktestSlice {
  backtestOpen: boolean;
  setBacktestOpen: (open: boolean) => void;

  // Selected instrument
  backtestExchange: string;
  backtestSymbol: string;
  setBacktestInstrument: (exchange: string, symbol: string) => void;

  // Date range
  backtestFrom: string;
  backtestTo: string;
  setBacktestDateRange: (from: string, to: string) => void;

  // Timeframe for the backtest chart
  backtestTimeframe: Timeframe;
  setBacktestTimeframe: (tf: Timeframe) => void;

  // Strategy
  backtestStrategyName: string;
  backtestStrategyCode: string;
  backtestStrategies: StrategyEntry[];
  setBacktestStrategyCode: (code: string) => void;
  switchBacktestStrategy: (name: string) => void;
  addBacktestStrategy: () => void;
  deleteBacktestStrategy: (name: string) => void;
  renameBacktestStrategy: (oldName: string, newName: string) => void;
  initBacktestStrategies: (strategies: StrategyEntry[]) => void;

  // Execution state
  backtestRunning: boolean;
  backtestStatus: string;
  setBacktestRunning: (running: boolean) => void;
  setBacktestStatus: (status: string) => void;

  // Results
  backtestResult: BacktestResult | null;
  backtestEquityPoints: EquityPoint[];
  setBacktestResult: (result: BacktestResult | null) => void;
  appendBacktestEquity: (point: EquityPoint) => void;
  clearBacktestEquity: () => void;

  // Selected trade index (drives chart markers)
  backtestSelectedTradeIndex: number | null;
  setBacktestSelectedTradeIndex: (index: number | null) => void;

  // Bottom panel (equity + stats) height ratio inside the modal — TradingView-style
  // vertical resize between chart and results.
  backtestBottomRatio: number;
  backtestBottomPreviousRatio: number;
  setBacktestBottomRatio: (ratio: number) => void;
  setBacktestBottomPreviousRatio: (ratio: number) => void;
  toggleBacktestBottom: () => void;
}

const DEFAULT_STRATEGY = `// Called once per closed bar.
// Available: bar, prevBars, position, equity, state
// Actions: buy(qty), sell(qty), close(), setStop(price), setTarget(price), setTrailingStop(dist)
//          setPartialTargets([{price, fraction, moveSLTo?}])  — scale out at multiple levels
//          closePartial(fraction)  — manually close fraction of original qty at bar close
// Note: setStop() clears any active trailing stop; fraction is portion of original entry qty

const period = 20;
const mult   = 2;

if (prevBars.length < period) return;

const closes = [...prevBars.slice(-period).map(b => b.close), bar.close];
const mean   = closes.reduce((a, b) => a + b, 0) / closes.length;
const std    = Math.sqrt(closes.reduce((a, b) => a + (b - mean) ** 2, 0) / closes.length);

const upper = mean + mult * std;
const lower = mean - mult * std;

if (position === 0) {
  if (bar.close <= lower) buy(0.001);
  else if (bar.close >= upper) sell(0.001);
} else if (position > 0 && bar.close >= mean) {
  close();
} else if (position < 0 && bar.close <= mean) {
  close();
}
`;

const DEFAULT_STRATEGY_NAME = 'Bollinger Bands';

export function createBacktestSlice(set: (fn: (s: BacktestSlice) => Partial<BacktestSlice>) => void): BacktestSlice {
  return {
    backtestOpen: false,
    setBacktestOpen: (open) => set(() => ({ backtestOpen: open })),

    backtestExchange: 'BINANCE',
    backtestSymbol:   'BTCUSDT',
    setBacktestInstrument: (exchange, symbol) => set(() => ({ backtestExchange: exchange, backtestSymbol: symbol })),

    backtestFrom: '2025-05-01',
    backtestTo:   '2025-08-31',
    setBacktestDateRange: (from, to) => set(() => ({ backtestFrom: from, backtestTo: to })),

    backtestTimeframe: { unit: 2, unitNumber: 5, label: '5m' },
    setBacktestTimeframe: (tf) => set(() => ({ backtestTimeframe: tf })),

    backtestStrategyName: DEFAULT_STRATEGY_NAME,
    backtestStrategyCode: DEFAULT_STRATEGY,
    backtestStrategies: [{ name: DEFAULT_STRATEGY_NAME, code: DEFAULT_STRATEGY }],

    setBacktestStrategyCode: (code) => set((s) => ({
      backtestStrategyCode: code,
      backtestStrategies: s.backtestStrategies.map((st) =>
        st.name === s.backtestStrategyName ? { ...st, code } : st
      ),
    })),

    switchBacktestStrategy: (name) => set((s) => {
      const target = s.backtestStrategies.find((st) => st.name === name);
      if (!target) return {};
      return { backtestStrategyName: name, backtestStrategyCode: target.code };
    }),

    addBacktestStrategy: () => set((s) => {
      let n = 1;
      while (s.backtestStrategies.some((st) => st.name === `Strategy ${n}`)) n++;
      const name = `Strategy ${n}`;
      return {
        backtestStrategies: [...s.backtestStrategies, { name, code: '' }],
        backtestStrategyName: name,
        backtestStrategyCode: '',
      };
    }),

    deleteBacktestStrategy: (name) => set((s) => {
      if (s.backtestStrategies.length <= 1) return {};
      const filtered = s.backtestStrategies.filter((st) => st.name !== name);
      if (s.backtestStrategyName !== name) return { backtestStrategies: filtered };
      return {
        backtestStrategies: filtered,
        backtestStrategyName: filtered[0].name,
        backtestStrategyCode: filtered[0].code,
      };
    }),

    renameBacktestStrategy: (oldName, newName) => set((s) => ({
      backtestStrategies: s.backtestStrategies.map((st) =>
        st.name === oldName ? { ...st, name: newName } : st
      ),
      backtestStrategyName: s.backtestStrategyName === oldName ? newName : s.backtestStrategyName,
    })),

    initBacktestStrategies: (strategies) => set((s) => {
      if (strategies.length === 0) return {};
      const active = strategies.find(st => st.name === s.backtestStrategyName) ?? strategies[0];
      return {
        backtestStrategies: strategies,
        backtestStrategyName: active.name,
        backtestStrategyCode: active.code,
      };
    }),

    backtestRunning: false,
    backtestStatus: '',
    setBacktestRunning: (running) => set(() => ({ backtestRunning: running })),
    setBacktestStatus:  (status)  => set(() => ({ backtestStatus: status })),

    backtestResult: null,
    backtestEquityPoints: [],
    setBacktestResult:   (result) => set(() => ({ backtestResult: result })),
    appendBacktestEquity: (point) => set((s) => ({ backtestEquityPoints: [...s.backtestEquityPoints, point] })),
    clearBacktestEquity:  ()      => set(() => ({ backtestEquityPoints: [], backtestResult: null })),

    backtestSelectedTradeIndex: null,
    setBacktestSelectedTradeIndex: (index) => set(() => ({ backtestSelectedTradeIndex: index })),

    backtestBottomRatio: 0.3,
    backtestBottomPreviousRatio: 0.3,
    setBacktestBottomRatio: (ratio) => set(() => ({ backtestBottomRatio: Math.max(0, Math.min(0.85, ratio)) })),
    setBacktestBottomPreviousRatio: (ratio) => set(() => ({ backtestBottomPreviousRatio: ratio })),
    toggleBacktestBottom: () => set((s) => {
      if (s.backtestBottomRatio > 0.05) {
        return { backtestBottomPreviousRatio: s.backtestBottomRatio, backtestBottomRatio: 0 };
      }
      const ratio = s.backtestBottomPreviousRatio >= 0.05 ? s.backtestBottomPreviousRatio : 0.3;
      return { backtestBottomRatio: ratio };
    }),
  };
}
