import api from './api';

export interface BacktestBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface BacktestTrade {
  entryTime:  string;
  exitTime:   string;
  side:       'long' | 'short';
  entryPrice: number;
  exitPrice:  number;
  qty:        number;
  pnl:        number;     // net of fees
  pnlPct:     number;     // net of fees, % of entry notional
  fees:       number;     // total round-trip taker fees
  tradeId?:   number;     // groups partial closes from the same entry
  isPartial?: boolean;    // true when this row is a partial close
}

export interface EquityPoint {
  t:      string;
  equity: number;
}

export interface BacktestResult {
  trades:       BacktestTrade[];
  equityCurve:  EquityPoint[];
  finalEquity:  number;
  totalReturn:  number;
  winRate:      number;
  totalTrades:  number;
  maxDrawdown:  number;
  sharpe:       number;
}

export interface BacktestRunParams {
  exchange:      string;
  symbol:        string;
  unit:          number;
  unitNumber:    number;
  from:          string;
  to:            string;
  initialEquity: number;
  strategyCode:  string;
  takerFee:      number;   // per-side fraction, e.g. 0.00055 = 0.055%
}

export interface SymbolEntry {
  exchange: string;
  symbol:   string;
}

// In-memory cache for bars — avoid re-fetching same range/timeframe.
// Shared by getBars (limit-suffixed keys) and streamBars (no suffix).
// LRU eviction: bumped to end on read, oldest removed when MAX exceeded.
const barsCache = new Map<string, BacktestBar[]>();
const MAX_BARS_CACHE = 20;

function barsCacheKey(exchange: string, symbol: string, unit: number, unitNumber: number, from: string, to: string) {
  return `${exchange}:${symbol}:${unit}:${unitNumber}:${from}:${to}`;
}

function barsCacheGet(key: string): BacktestBar[] | undefined {
  const cached = barsCache.get(key);
  if (cached) { barsCache.delete(key); barsCache.set(key, cached); }
  return cached;
}

function barsCacheSet(key: string, bars: BacktestBar[]): void {
  while (barsCache.size >= MAX_BARS_CACHE) {
    const oldest = barsCache.keys().next().value;
    if (oldest === undefined) break;
    barsCache.delete(oldest);
  }
  barsCache.set(key, bars);
}

export const backtestService = {
  async getSymbols(): Promise<SymbolEntry[]> {
    try {
      const res = await api.get<{ success: boolean; symbols: SymbolEntry[] }>('/backtest/symbols');
      return res.data.symbols ?? [];
    } catch {
      return [];
    }
  },

  async getBars(
    exchange: string,
    symbol: string,
    unit: number,
    unitNumber: number,
    from: string,
    to: string,
    limit?: number,
  ): Promise<BacktestBar[]> {
    const key = barsCacheKey(exchange, symbol, unit, unitNumber, from, to) + (limit ? `:tail${limit}` : '');
    const cached = barsCacheGet(key);
    if (cached) return cached;

    const res = await api.get<{ success: boolean; bars: BacktestBar[] }>('/backtest/bars', {
      params: { exchange, symbol, unit, unitNumber, from, to, ...(limit ? { limit } : {}) },
      timeout: 0,
    });

    const bars = res.data.bars ?? [];
    barsCacheSet(key, bars);
    return bars;
  },

  async getAvailableRange(exchange: string, symbol: string): Promise<{ from: string; to: string } | null> {
    try {
      const res = await api.get<{ success: boolean; from?: string; to?: string }>('/backtest/range', {
        params: { exchange, symbol },
      });
      if (res.data.success && res.data.from && res.data.to) {
        return { from: res.data.from, to: res.data.to };
      }
      return null;
    } catch {
      return null;
    }
  },

  /** Stream bars month by month via SSE — chart can render each chunk immediately.
   *  Cached results are delivered as a single synthetic chunk via microtask. */
  streamBars(
    params: { exchange: string; symbol: string; unit: number; unitNumber: number; from: string; to: string },
    onChunk: (bars: BacktestBar[]) => void,
  ): { promise: Promise<void>; abort: () => void } {
    const key = barsCacheKey(params.exchange, params.symbol, params.unit, params.unitNumber, params.from, params.to);
    const cached = barsCacheGet(key);
    if (cached) {
      let aborted = false;
      return {
        promise: Promise.resolve().then(() => { if (!aborted) onChunk(cached); }),
        abort: () => { aborted = true; },
      };
    }

    const controller = new AbortController();
    const accumulated: BacktestBar[] = [];

    const promise = new Promise<void>((resolve, reject) => {
      const url = `/backtest/bars/stream?exchange=${encodeURIComponent(params.exchange)}&symbol=${encodeURIComponent(params.symbol)}&unit=${params.unit}&unitNumber=${params.unitNumber}&from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}`;

      fetch(url, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) { reject(new Error(`Server error: ${response.status}`)); return; }

          const reader  = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let event = '';

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                event = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (event === 'chunk') {
                    const chunk = data as BacktestBar[];
                    for (let i = 0; i < chunk.length; i++) accumulated.push(chunk[i]);
                    onChunk(chunk);
                  } else if (event === 'done') {
                    if (accumulated.length > 0) barsCacheSet(key, accumulated);
                    resolve();
                  } else if (event === 'error') {
                    reject(new Error(data.message ?? 'Stream error'));
                  }
                } catch { /* malformed line */ }
                event = '';
              }
            }
          }
        })
        .catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return;
          reject(err);
        });
    });

    return { promise, abort: () => controller.abort() };
  },

  async listStrategies(): Promise<Array<{ name: string; code: string }>> {
    try {
      const res = await api.get<{ success: boolean; strategies: Array<{ name: string; code: string }> }>('/backtest/strategies');
      return res.data.strategies ?? [];
    } catch {
      return [];
    }
  },

  async saveStrategy(name: string, code: string): Promise<void> {
    await api.put(`/backtest/strategies/${encodeURIComponent(name)}`, { code });
  },

  async renameStrategy(oldName: string, newName: string): Promise<void> {
    await api.patch(`/backtest/strategies/${encodeURIComponent(oldName)}`, { newName });
  },

  async deleteStrategy(name: string): Promise<void> {
    await api.delete(`/backtest/strategies/${encodeURIComponent(name)}`);
  },

  async saveResult(
    name: string,
    result: BacktestResult,
    meta: { exchange: string; symbol: string; from: string; to: string; timeframe: string; initialEquity: number },
  ): Promise<void> {
    await api.put(`/backtest/strategies/${encodeURIComponent(name)}/result`, { result, meta });
  },

  async loadResult(name: string): Promise<BacktestResult | null> {
    try {
      const res = await api.get<{ success: boolean; result?: BacktestResult }>(`/backtest/strategies/${encodeURIComponent(name)}/result`);
      return res.data.success ? (res.data.result ?? null) : null;
    } catch {
      return null;
    }
  },

  /** Run strategy via SSE — onEquity is called with a batch of points per server flush. */
  runStrategy(
    params: BacktestRunParams,
    onEquity: (points: EquityPoint[]) => void,
    onStatus: (msg: string) => void,
  ): { promise: Promise<BacktestResult>; abort: () => void } {
    const controller = new AbortController();

    // Accumulate equity points from streamed batches so the 'done' event
    // doesn't need to re-send the full curve (which caused multi-MB JSON parses).
    const accEquity: EquityPoint[] = [];

    const promise = new Promise<BacktestResult>((resolve, reject) => {
      fetch('/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) {
          reject(new Error(`Server error: ${response.status}`));
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let event = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              event = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (event === 'equity') {
                  const pts = data as EquityPoint[];
                  for (const p of pts) accEquity.push(p);
                  onEquity(pts);
                } else if (event === 'status') {
                  onStatus(data.message ?? '');
                } else if (event === 'done') {
                  resolve({ ...(data as Omit<BacktestResult, 'equityCurve'>), equityCurve: accEquity });
                } else if (event === 'error') {
                  reject(new Error(data.message ?? 'Unknown error'));
                }
              } catch { /* malformed line */ }
              event = '';
            }
          }
        }
      }).catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        reject(err);
      });
    });

    return { promise, abort: () => controller.abort() };
  },
};
