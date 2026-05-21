import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { getAdapter, isConnected } from '../adapters/registry';
import { OrderType, OrderSide } from '../types/enums';
import type { ILiveStrategy, LiveStrategyConfig, LiveStrategyInfo, StrategyState } from './ILiveStrategy';
import { debugLog } from '../utils/debugLog';

const RESULTS_FILE = path.resolve(process.cwd(), 'log', 'strategy-results.json');

const ML_SERVER_BASE = process.env.ML_SERVICE_URL ?? 'http://127.0.0.1:17654';
const ML_SERVER_DIR = process.env.ML_TRADING_DIR ?? 'C:\\Users\\ahmed\\projects\\MLTrading';
const WARMUP_BARS = 220;      // atr_z needs 2×ZSCORE_WINDOW (200) bars; buffer max = 251
const POLL_INTERVAL_MS = 30_000; // tick bars have no fixed boundary — poll every 30 s
const WARMUP_LOOKBACK_MS = 8 * 60 * 60_000;  // 8 h — enough for 220 tick bars in any session
const LIVE_LOOKBACK_MS   = 10 * 60_000;      // last 10 min to fetch the latest completed tick bar
const TF_UNIT = 7;            // tick bars
const TF_UNIT_NUMBER = 100;   // 100-tick bars — matches model training data

type NormalizedBar = { t: string; o: number; h: number; l: number; c: number; v: number };

type MLSignal = 'long' | 'short' | 'flat';

interface MLBarResponse {
  ready: boolean;
  bars: number;
  signal: MLSignal;
  confidence: number;
  long_prob: number;
  short_prob: number;
  flat_prob: number;
  atr: number | null;
  threshold: number;
  trade_config: {
    sl_pts: number;
    tp_pts?: number;
    targets: null | Array<{ tp_pts: number; contracts: number }>;
    total_contracts: number;
    trailing_stop: boolean;
    trailing_dist_pts: number;
    daily_stop_loss: number;
    max_daily_trades: number;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}


export class MLNQStrategy implements ILiveStrategy {
  readonly id = 'ml-nq';
  readonly name = 'ML NQ';
  readonly description = 'Machine learning signal-based live trading on NQ via Python ML server';

  onBroadcast: ((info: LiveStrategyInfo) => void) | undefined;

  private state: StrategyState = 'stopped';
  private config: LiveStrategyConfig | null = null;
  private startedAt: string | null = null;
  private error: string | null = null;
  private lastSignal: MLSignal = 'flat';
  private lastConfidence = 0;
  private lastBarCount = 0;
  private warmedUp = false;
  private proc: ChildProcess | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private activeTrade: { entryTime: string; signal: MLSignal; contracts: number; orderId?: string } | null = null;

  getInfo(): LiveStrategyInfo {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      state: this.state,
      config: this.config ?? undefined,
      startedAt: this.startedAt ?? undefined,
      error: this.error ?? undefined,
      metadata: {
        signal: this.lastSignal,
        confidence: this.lastConfidence,
        barCount: this.lastBarCount,
        warmedUp: this.warmedUp,
      },
    };
  }

  async start(config: LiveStrategyConfig): Promise<void> {
    if (this.state === 'starting' || this.state === 'warming_up' || this.state === 'running') {
      throw new Error('Strategy already running');
    }
    this.config = config;
    this.stopped = false;
    this.error = null;
    this.lastSignal = 'flat';
    this.lastConfidence = 0;
    this.lastBarCount = 0;
    this.warmedUp = false;
    this.startedAt = new Date().toISOString();
    this._setState('starting');

    try {
      await this._ensureMLServer();
      if (this.stopped) return;

      await axios.post(`${ML_SERVER_BASE}/reset`, {}, { timeout: 5000 }).catch(() => {});
      if (this.stopped) return;

      this._setState('warming_up');
      await this._warmUp();
      if (this.stopped) return;

      this._setState('running');
      this._schedulePoll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error = msg;
      this._setState('error');
      debugLog.log('[ml-nq]', { error: msg });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this._setState('stopped');
    debugLog.log('[ml-nq]', 'stopped');
  }

  private _setState(state: StrategyState): void {
    this.state = state;
    this.onBroadcast?.(this.getInfo());
  }

  private async _ensureMLServer(): Promise<void> {
    console.log('[ml-nq] checking ML server health at', ML_SERVER_BASE);
    if (await this._isHealthy()) {
      console.log('[ml-nq] ML server already running');
      return;
    }

    console.log('[ml-nq] spawning ML server from', ML_SERVER_DIR);
    let spawnError = '';
    const pythonExe = path.join(ML_SERVER_DIR, 'venv', 'Scripts', 'python.exe');
    this.proc = spawn(pythonExe, ['live_server.py'], {
      cwd: ML_SERVER_DIR,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Capture stderr for error detection only — don't print to console (ML server has its own log)
    this.proc.stderr?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n').map((l) => l.trim()).filter(Boolean)) {
        debugLog.log('[ml-nq python]', line);
        if (/error|traceback|exception/i.test(line)) spawnError = line;
      }
    });
    this.proc.on('error', (err) => {
      spawnError = err.message;
      console.error('[ml-nq] spawn error:', err.message);
    });
    this.proc.on('exit', (code) => {
      if (code !== 0) console.error('[ml-nq] process exited with code', code);
    });

    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      if (this.stopped) return;
      if (await this._isHealthy()) {
        console.log('[ml-nq] ML server ready');
        return;
      }
    }
    throw new Error(spawnError || 'ML server failed to start within 30 seconds');
  }

  private async _isHealthy(): Promise<boolean> {
    try {
      const res = await axios.get(`${ML_SERVER_BASE}/health`, { timeout: 2000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  private async _warmUp(): Promise<void> {
    if (!this.config) return;
    const { contractId, tickSize } = this.config;

    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - WARMUP_LOOKBACK_MS).toISOString();

    debugLog.log('[ml-nq]', `fetching ${WARMUP_BARS} warm-up bars`);

    const adapter = getAdapter();
    const result = await adapter.marketData.retrieveBars({
      contractId,
      unit: TF_UNIT,
      unitNumber: TF_UNIT_NUMBER,
      startTime,
      endTime,
      limit: WARMUP_BARS,
    }) as { success: boolean; bars: NormalizedBar[] };

    if (!result.success || !result.bars?.length) {
      throw new Error('Failed to retrieve warm-up bars');
    }

    // Defensive slice — chartApi may ignore Countback for tick resolutions
    const warmupBars = result.bars.slice(-WARMUP_BARS);
    debugLog.log('[ml-nq]', `replaying ${warmupBars.length} bars (fetched ${result.bars.length})`);

    for (const bar of warmupBars) {
      if (this.stopped) return;
      try {
        const resp = await this._postBar(bar, tickSize);
        this.lastBarCount = resp.bars;
        this.warmedUp = resp.ready;
        this.onBroadcast?.(this.getInfo());
      } catch (err) {
        debugLog.log('[ml-nq]', { warmupBarError: err instanceof Error ? err.message : String(err) });
      }
    }

    debugLog.log('[ml-nq]', `warm-up done, ready=${this.warmedUp}`);
  }

  private async _postBar(bar: NormalizedBar, tickSize: number): Promise<MLBarResponse> {
    const half = tickSize / 2;
    const body = {
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      bid_open: bar.o - half,
      ask_open: bar.o + half,
      bid_close: bar.c - half,
      ask_close: bar.c + half,
    };
    const res = await axios.post<MLBarResponse>(`${ML_SERVER_BASE}/bar`, body, { timeout: 5000 });
    return res.data;
  }

  private _schedulePoll(): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => void this._poll(), POLL_INTERVAL_MS);
  }

  private async _poll(): Promise<void> {
    if (this.stopped || !this.config) return;
    const { contractId, accountId, tickSize } = this.config;

    try {
      if (!isConnected()) {
        debugLog.log('[ml-nq]', 'not connected, skipping poll');
        this._schedulePoll();
        return;
      }

      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - LIVE_LOOKBACK_MS).toISOString();
      const adapter = getAdapter();
      const result = await adapter.marketData.retrieveBars({
        contractId,
        unit: TF_UNIT,
        unitNumber: TF_UNIT_NUMBER,
        startTime,
        endTime,
        limit: 2,
      }) as { success: boolean; bars: NormalizedBar[] };

      if (!result.success || !result.bars?.length) {
        debugLog.log('[ml-nq]', 'no bars from poll');
        this._schedulePoll();
        return;
      }

      const bar = result.bars[result.bars.length - 1];
      const resp = await this._postBar(bar, tickSize);

      this.lastBarCount = resp.bars;
      this.warmedUp = resp.ready;
      this.lastSignal = resp.signal;
      this.lastConfidence = resp.confidence;
      this.onBroadcast?.(this.getInfo());

      // File log every bar
      debugLog.log('[ml-nq] bar', {
        signal: resp.signal,
        confidence: Math.round(resp.confidence * 100) + '%',
        ready: resp.ready,
        bars: resp.bars,
      });

      // Detect trade exit: had an active trade but position is now flat
      if (this.activeTrade) {
        const posResult2 = await adapter.positions.searchOpen(accountId) as any;
        const posList2: Array<{ contractId: string; size: number }> =
          Array.isArray(posResult2) ? posResult2 : (posResult2?.positions ?? []);
        const stillOpen = posList2.some((p: any) => p.contractId === contractId && p.size !== 0);
        if (!stillOpen) {
          await this._recordTradeResult(accountId, contractId);
        }
      }

      // Console: only non-flat signals
      if (resp.ready && resp.signal !== 'flat') {
        console.log(`[ml-nq] signal=${resp.signal.toUpperCase()} confidence=${Math.round(resp.confidence * 100)}% bars=${resp.bars}`);
        await this._maybeExecute(resp, accountId, contractId, tickSize);
      }
    } catch (err) {
      debugLog.log('[ml-nq]', { pollError: err instanceof Error ? err.message : String(err) });
    }

    this._schedulePoll();
  }

  private async _maybeExecute(
    resp: MLBarResponse,
    accountId: string,
    contractId: string,
    tickSize: number,
  ): Promise<void> {
    const adapter = getAdapter();

    const posResult = await adapter.positions.searchOpen(accountId) as
      Array<{ contractId: string; size: number }> |
      { positions?: Array<{ contractId: string; size: number }> } |
      { success: boolean; positions?: Array<{ contractId: string; size: number }> };

    const posList: Array<{ contractId: string; size: number }> =
      Array.isArray(posResult) ? posResult : ((posResult as any).positions ?? []);

    const hasPosition = posList.some(
      (p) => p.contractId === contractId && p.size !== 0,
    );

    if (hasPosition) {
      debugLog.log('[ml-nq] skip', `signal=${resp.signal} — position already open`);
      console.log(`[ml-nq] signal=${resp.signal.toUpperCase()} skipped — already in position`);
      return;
    }

    const isBuy = resp.signal === 'long';
    const dir = isBuy ? 1 : -1;
    const slTicks = Math.round(resp.trade_config.sl_pts / tickSize) * -dir;
    const side = isBuy ? 'BUY' : 'SELL';
    const useTrailing = resp.trade_config.trailing_stop && resp.trade_config.trailing_dist_pts > 0;

    // Build TP brackets from targets array; fall back to tp_pts if no targets
    const targets = resp.trade_config.targets;
    const takeProfitBrackets = (targets && targets.length > 0)
      ? targets.map((t) => ({
          ticks: Math.round(t.tp_pts / tickSize) * dir,
          type: OrderType.Limit,
        }))
      : resp.trade_config.tp_pts
        ? [{ ticks: Math.round(resp.trade_config.tp_pts / tickSize) * dir, type: OrderType.Limit }]
        : undefined;

    const tpSummary = takeProfitBrackets
      ? takeProfitBrackets.map((t) => `${t.ticks}ticks`).join(', ')
      : 'none';
    const slDesc = useTrailing
      ? `trail=${resp.trade_config.trailing_dist_pts}pts`
      : `sl=${slTicks}ticks`;
    console.log(`[ml-nq] placing ${side} x${resp.trade_config.total_contracts} ${slDesc} tp=[${tpSummary}]`);
    debugLog.log('[ml-nq] order', { side, size: resp.trade_config.total_contracts, slDesc, tpSummary });

    try {
      // When trailing: entry has no SL bracket — trailing stop placed as a standalone order after fill
      const orderResult = await adapter.orders.place({
        accountId,
        contractId,
        type: OrderType.Market,
        side: isBuy ? OrderSide.Buy : OrderSide.Sell,
        size: resp.trade_config.total_contracts,
        ...(useTrailing ? {} : {
          stopLossBracket: { ticks: slTicks, type: OrderType.Stop },
        }),
        ...(takeProfitBrackets ? { takeProfitBrackets } : {}),
      }) as { success?: boolean; errorMessage?: string; orderId?: string | number };

      if (orderResult.success === false) {
        console.error(`[ml-nq] order rejected: ${orderResult.errorMessage}`);
        debugLog.log('[ml-nq] order rejected', { error: orderResult.errorMessage });
        return;
      }

      const orderId = orderResult.orderId != null ? String(orderResult.orderId) : undefined;
      console.log(`[ml-nq] order placed — id=${orderId}`);
      debugLog.log('[ml-nq] order placed', { orderId });
      this.activeTrade = { entryTime: new Date().toISOString(), signal: resp.signal, contracts: resp.trade_config.total_contracts, orderId };

      // Place standalone trailing stop after entry (opposite side to close the position)
      if (useTrailing) {
        try {
          const trailResult = await adapter.orders.place({
            accountId,
            contractId,
            type: OrderType.TrailingStop,
            side: isBuy ? OrderSide.Sell : OrderSide.Buy,
            size: resp.trade_config.total_contracts,
            trailPrice: resp.trade_config.trailing_dist_pts,
          }) as { success?: boolean; errorMessage?: string; orderId?: string | number };

          if (trailResult.success === false) {
            console.error(`[ml-nq] trailing stop rejected: ${trailResult.errorMessage}`);
            debugLog.log('[ml-nq] trailing stop rejected', { error: trailResult.errorMessage });
          } else {
            const trailId = trailResult.orderId != null ? String(trailResult.orderId) : undefined;
            console.log(`[ml-nq] trailing stop placed — id=${trailId} dist=${resp.trade_config.trailing_dist_pts}pts`);
            debugLog.log('[ml-nq] trailing stop placed', { trailId, dist: resp.trade_config.trailing_dist_pts });
          }
        } catch (trailErr: unknown) {
          debugLog.log('[ml-nq]', { trailStopError: trailErr instanceof Error ? trailErr.message : String(trailErr) });
        }
      }

      await axios.post(`${ML_SERVER_BASE}/trade_event`, {
        ts: Date.now() / 1000,
        side: 'entry',
        price: null,
        size: resp.trade_config.total_contracts,
        signal: resp.signal,
        order_id: orderId,
      }, { timeout: 3000 }).catch(() => {});
    } catch (err: unknown) {
      debugLog.log('[ml-nq]', { executeError: err instanceof Error ? err.message : String(err) });
    }
  }

  private async _recordTradeResult(accountId: string, contractId: string): Promise<void> {
    const trade = this.activeTrade!;
    this.activeTrade = null;
    const exitTime = new Date().toISOString();

    try {
      const adapter = getAdapter();
      const fillsRaw = await adapter.trades.search({
        accountId,
        startTimestamp: trade.entryTime,
      }) as { trades?: Array<{ contractId: string; price: number; size: number; side: number; createdAt: string }> };

      const fills = (fillsRaw?.trades ?? []).filter((f) => f.contractId === contractId);

      // Entry fills match the signal direction; exit fills are the opposite side.
      // Use size-weighted average (VWAP) to handle partial TP fills correctly.
      const entrySide = trade.signal === 'long' ? 0 : 1; // OrderSide.Buy=0, Sell=1
      const exitSide  = trade.signal === 'long' ? 1 : 0;

      const entryFills = fills.filter((f) => f.side === entrySide);
      const exitFills  = fills.filter((f) => f.side === exitSide);
      const entryTotal = entryFills.reduce((s, f) => s + f.size, 0);
      const exitTotal  = exitFills.reduce((s, f) => s + f.size, 0);
      const entryPrice = entryTotal > 0
        ? entryFills.reduce((s, f) => s + f.price * f.size, 0) / entryTotal
        : null;
      const exitPrice = exitTotal > 0
        ? exitFills.reduce((s, f) => s + f.price * f.size, 0) / exitTotal
        : null;

      let pnl: number | null = null;
      if (entryPrice !== null && exitPrice !== null) {
        const dir = trade.signal === 'long' ? 1 : -1;
        pnl = (exitPrice - entryPrice) * dir * trade.contracts;
      }

      const record = {
        date:        exitTime.slice(0, 10),
        entryTime:   trade.entryTime,
        exitTime,
        signal:      trade.signal,
        contracts:   trade.contracts,
        orderId:     trade.orderId ?? null,
        entryPrice,
        exitPrice,
        pnl,
        outcome:     pnl === null ? 'unknown' : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
      };

      debugLog.log('[ml-nq] trade closed', record);
      console.log(`[ml-nq] trade closed — ${record.outcome} pnl=${pnl !== null ? pnl.toFixed(2) : '?'}`);

      this._appendResult(record);
    } catch (err) {
      debugLog.log('[ml-nq]', { recordTradeError: err instanceof Error ? err.message : String(err) });
      // Still save what we know even if fill query failed
      this._appendResult({ date: exitTime.slice(0, 10), entryTime: trade.entryTime, exitTime, signal: trade.signal, contracts: trade.contracts, orderId: trade.orderId ?? null, entryPrice: null, exitPrice: null, pnl: null, outcome: 'unknown' });
    }
  }

  private _appendResult(record: Record<string, unknown>): void {
    try {
      let data: { trades: typeof record[]; stats: Record<string, unknown> } = { trades: [], stats: {} };
      if (fs.existsSync(RESULTS_FILE)) {
        data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
      }
      data.trades.push(record);

      // Recompute stats
      const known = data.trades.filter((t) => t['pnl'] !== null);
      const wins   = known.filter((t) => t['outcome'] === 'win').length;
      const losses = known.filter((t) => t['outcome'] === 'loss').length;
      const pnls   = known.map((t) => t['pnl'] as number);
      const winPnls  = known.filter((t) => t['outcome'] === 'win').map((t)  => t['pnl'] as number);
      const lossPnls = known.filter((t) => t['outcome'] === 'loss').map((t) => t['pnl'] as number);

      data.stats = {
        total:      data.trades.length,
        wins,
        losses,
        unknown:    data.trades.length - known.length,
        winRate:    known.length > 0 ? +(wins / known.length * 100).toFixed(1) : null,
        totalPnl:   +pnls.reduce((a, b) => a + b, 0).toFixed(2),
        avgWin:     winPnls.length  > 0 ? +(winPnls.reduce((a, b)  => a + b, 0) / winPnls.length).toFixed(2)  : null,
        avgLoss:    lossPnls.length > 0 ? +(lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length).toFixed(2) : null,
        lastUpdated: new Date().toISOString(),
      };

      fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
      fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
      debugLog.log('[ml-nq] results saved', { file: RESULTS_FILE, stats: data.stats });
    } catch (err) {
      debugLog.log('[ml-nq]', { saveResultsError: err instanceof Error ? err.message : String(err) });
    }
  }
}
