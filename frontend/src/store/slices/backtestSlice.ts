import type { Timeframe } from './instrumentSlice';
import type { BacktestResult, EquityPoint } from '../../services/backtestService';

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
  backtestStrategyCode: string;
  setBacktestStrategyCode: (code: string) => void;

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
}

const DEFAULT_STRATEGY = `// Called once per closed bar.
// Available: bar, prevBars, position, equity, state
// Actions: buy(qty), sell(qty), close(), setStop(price), setTarget(price)

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

    backtestStrategyCode: DEFAULT_STRATEGY,
    setBacktestStrategyCode: (code) => set(() => ({ backtestStrategyCode: code })),

    backtestRunning: false,
    backtestStatus: '',
    setBacktestRunning: (running) => set(() => ({ backtestRunning: running })),
    setBacktestStatus:  (status)  => set(() => ({ backtestStatus: status })),

    backtestResult: null,
    backtestEquityPoints: [],
    setBacktestResult:   (result) => set(() => ({ backtestResult: result })),
    appendBacktestEquity: (point) => set((s) => ({ backtestEquityPoints: [...s.backtestEquityPoints, point] })),
    clearBacktestEquity:  ()      => set(() => ({ backtestEquityPoints: [], backtestResult: null })),
  };
}
