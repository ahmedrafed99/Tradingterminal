import { useEffect, useRef, useState } from 'react';
import type { CandlestickData, UTCTimestamp, LogicalRange } from 'lightweight-charts';
import type { Bar, Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { marketDataService } from '../../../services/marketDataService';
import { realtimeService, type GatewayQuote, type DepthEntry, type MarketTick } from '../../../services/realtimeService';
import { DepthType } from '../../../types/enums';
import {
  aggregateBars,
  barToCandle,
  sortBarsAscending,
  computeStartTime,
  getCandlePeriodSeconds,
  floorToCandlePeriod,
  generateWhitespace,
} from '../barUtils';
import type { ChartRefs } from './types';
import type { BacktestConfig } from '../CandlestickChart';
import { backtestService } from '../../../services/backtestService';
import { getSchedule, isTimestampInCMETradingSession, getCurrentSessionStartSec } from '../../../utils/marketHours';


/**
 * Handles historical bar loading, real-time quote subscription, and volume profile.
 */
export function useChartBars(
  refs: ChartRefs,
  chartId: 'left' | 'right' | 'backtest',
  contract: Contract | null,
  timeframe: Timeframe,
  backtestConfig?: BacktestConfig,
): { loading: boolean; error: string | null } {

  const connected = useStore((s) => s.connected);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Accumulated trade volume map for anchor-mode FRVP drawings (price → contracts traded)
  const tradeAnchorMapRef = useRef(new Map<number, number>());
  const prevContractIdRef = useRef<string | null>(null);
  // Tracks which contract the depth primitive currently holds data for.
  // Used to distinguish a contract switch (must clear) from a reconnect (keep stale data).
  const domContractIdRef = useRef<string | null>(null);

  // Tick bar live state: how many more ticks until the current bar closes.
  // Initialised from the partial bar's tv field on load; decremented by handleMarketTick.
  const ticksRemainingRef = useRef<number>(0);

  // TF of the bars currently in refs.bars.current — used to derive a coarser TF
  // via client-side aggregation on switch (skips the network round-trip entirely).
  const previousTimeframeRef = useRef<Timeframe | null>(null);

  // Historical load-more state
  const earliestLoadedTimeRef = useRef<string | null>(null);
  const isLoadingMoreRef = useRef(false);
  const reachedHistoryStartRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const domEnabled = useStore((s) => chartId === 'left' ? s.domEnabled : chartId === 'right' ? s.secondDomEnabled : false);
  const domColor = useStore((s) => chartId === 'left' ? s.domColor : chartId === 'right' ? s.secondDomColor : '#2196f3');
  const domHoverExpand = useStore((s) => chartId === 'left' ? s.domHoverExpand : chartId === 'right' ? s.secondDomHoverExpand : false);
  const domRowLayout = useStore((s) => chartId === 'left' ? s.domRowLayout : chartId === 'right' ? s.secondDomRowLayout : 'price');
  const domRowSize = useStore((s) => chartId === 'left' ? s.domRowSize : chartId === 'right' ? s.secondDomRowSize : 1);
  const domBarPlacement = useStore((s) => chartId === 'left' ? s.domBarPlacement : chartId === 'right' ? s.secondDomBarPlacement : 'left');
  const domBarOffset = useStore((s) => chartId === 'left' ? s.domBarOffset : chartId === 'right' ? s.secondDomBarOffset : 0);
  const domBarLength = useStore((s) => chartId === 'left' ? s.domBarLength : chartId === 'right' ? s.secondDomBarLength : 30);
  const bidAskEnabled = useStore((s) => chartId === 'left' ? s.bidAskEnabled : chartId === 'right' ? s.secondBidAskEnabled : false);

  // Bump to force historical bar reload on market hub reconnect
  const [reconnectCount, setReconnectCount] = useState(0);
  useEffect(() => {
    const handler = () => setReconnectCount((c) => c + 1);
    realtimeService.onMarketReconnect(handler);
    return () => { realtimeService.offMarketReconnect(handler); };
  }, []);

  // -- Backtest bar loading: streams month by month, then renders a window of
  // the most recent bars. The full bar array is cached by backtestService so
  // re-visiting a timeframe is instant. Only VIEWPORT_BARS go to LWC initially;
  // scrolling toward the left edge expands the window backward in EXPAND_BARS
  // chunks so LWC's working set stays small even on multi-year backtests.
  useEffect(() => {
    if (!backtestConfig || !refs.series.current) return;

    const VIEWPORT_BARS = 500;
    const EXPAND_BARS   = 1000;

    const series = refs.series.current;
    let cancelled = false;
    const accumulated: CandlestickData<UTCTimestamp>[] = [];
    let windowStartIdx = 0;
    let autoScaleTimer: ReturnType<typeof setTimeout> | null = null;
    let rangeUnsub: (() => void) | null = null;

    setLoading(true);
    setError(null);
    refs.lastBar.current = null;
    series.setData([]);
    refs.chart.current?.priceScale('right').applyOptions({ autoScale: true });

    const cfg = backtestConfig!;
    const { promise, abort } = backtestService.streamBars(
      { exchange: cfg.exchange, symbol: cfg.symbol, unit: timeframe.unit, unitNumber: timeframe.unitNumber, from: cfg.dateFrom, to: cfg.dateTo },
      (chunk) => {
        if (cancelled) return;
        // Accumulate silently — rendering happens once at the end to avoid
        // O(N²) setData churn on long streams.
        for (let i = 0; i < chunk.length; i++) accumulated.push(barToCandle(chunk[i]));
      },
    );

    promise.then(() => {
      if (cancelled) return;
      if (accumulated.length === 0) { setLoading(false); return; }

      // Configure series / countdown / primitives for this contract+timeframe
      if (contract) {
        const dec = contract.tickSize.toString().split('.')[1]?.length ?? 2;
        series.applyOptions({ priceFormat: { type: 'price', minMove: contract.tickSize, precision: dec } });
        refs.countdown.current?.setDecimals(dec);
        refs.countdown.current?.setPeriod(getCandlePeriodSeconds(timeframe));
        refs.drawingsPrimitive.current?.setDecimals(dec);
        refs.drawingsPrimitive.current?.setTickSize(contract.tickSize);
        refs.crosshairLabel.current?.setDecimals(dec);
        refs.crosshairLabel.current?.setTickSize(contract.tickSize);
      }

      // Populate refs used by drawings, FRVP, crosshair — these need the full
      // dataset, independent of the chart's visible window.
      const bars = sortBarsAscending(accumulated.map((c) => ({
        t: new Date((c.time as number) * 1000).toISOString(),
        o: c.open, h: c.high, l: c.low, c: c.close, v: 0,
      })));
      refs.bars.current = bars;
      refs.dataMap.current.clear();
      for (const c of accumulated) refs.dataMap.current.set(c.time as number, c.close);

      const last = accumulated[accumulated.length - 1];
      refs.lastBar.current = last;
      refs.drawingsPrimitive.current?.setLastBarTime(last.time as number);
      refs.drawingsPrimitive.current?.setBarsRef(bars);
      refs.countdown.current?.updatePrice(last.close, false);
      refs.countdown.current?.setOpen(last.open);
      refs.drawingsPrimitive.current?.setCountdownPrice(last.close);

      // Initial window: only the most recent VIEWPORT_BARS go into LWC.
      windowStartIdx = Math.max(0, accumulated.length - VIEWPORT_BARS);
      series.setData(accumulated.slice(windowStartIdx));

      const visibleBars = accumulated.length - windowStartIdx;
      refs.chart.current?.timeScale().setVisibleLogicalRange({
        from: visibleBars - 200,
        to: visibleBars + 50,
      });

      // Expand window backward as the user scrolls toward its left edge.
      const chart = refs.chart.current;
      if (chart && windowStartIdx > 0) {
        const onRangeChange = (range: LogicalRange | null) => {
          if (!range || range.from > 50 || cancelled || windowStartIdx === 0) return;
          const newStart = Math.max(0, windowStartIdx - EXPAND_BARS);
          if (newStart === windowStartIdx) return;
          windowStartIdx = newStart;
          const visibleRange = chart.timeScale().getVisibleRange();
          series.setData(accumulated.slice(windowStartIdx));
          if (visibleRange) chart.timeScale().setVisibleRange(visibleRange);
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
        rangeUnsub = () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
      }

      // Defer disabling autoScale so it has a frame to fit the new viewport.
      autoScaleTimer = setTimeout(() => {
        refs.chart.current?.priceScale('right').applyOptions({ autoScale: false });
      }, 0);
      setLoading(false);
    }).catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Failed to load bars');
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      abort();
      rangeUnsub?.();
      if (autoScaleTimer != null) clearTimeout(autoScaleTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backtestConfig?.exchange, backtestConfig?.symbol, backtestConfig?.dateFrom, backtestConfig?.dateTo, timeframe, contract]);

  // -- Historical bars loading --
  useEffect(() => {
    if (backtestConfig) return; // handled by backtest effect above
    if (!connected || !contract || !refs.series.current) return;

    const series = refs.series.current;
    let cancelled = false;
    let autoScaleTimer: ReturnType<typeof setTimeout> | null = null;

    // Reset load-more state for this contract/timeframe
    earliestLoadedTimeRef.current = null;
    isLoadingMoreRef.current = false;
    reachedHistoryStartRef.current = false;
    const gen = ++loadGenerationRef.current;

    const isNewContract = prevContractIdRef.current !== contract.id;
    prevContractIdRef.current = contract.id;
    // Save horizontal scroll position so same-instrument timeframe changes can restore it
    const savedScrollPos = !isNewContract ? (refs.chart.current?.timeScale().scrollPosition() ?? null) : null;

    // Snapshot bars + TF from the previous load so loadBars can derive the new
    // (coarser) TF locally — no network call when the target is an integer
    // multiple of the source and both have uniform periods (sec/min/hr/day/week).
    const aggregationSource = ((): { bars: Bar[]; sourcePeriodSec: number; targetPeriodSec: number } | null => {
      if (isNewContract) return null;
      const sourceTf = previousTimeframeRef.current;
      if (!sourceTf) return null;
      if (sourceTf.unit < 1 || sourceTf.unit > 5) return null;
      if (timeframe.unit < 1 || timeframe.unit > 5) return null;
      const sourcePeriodSec = getCandlePeriodSeconds(sourceTf);
      const targetPeriodSec = getCandlePeriodSeconds(timeframe);
      if (sourcePeriodSec <= 0 || targetPeriodSec <= 0) return null;
      if (targetPeriodSec <= sourcePeriodSec) return null;
      if (targetPeriodSec % sourcePeriodSec !== 0) return null;
      const ratio = targetPeriodSec / sourcePeriodSec;
      // Require enough source bars for at least ~50 aggregated bars — below that,
      // a fresh fetch gives a more useful range.
      if (refs.bars.current.length < 50 * ratio) return null;
      return { bars: refs.bars.current, sourcePeriodSec, targetPeriodSec };
    })();

    let rangeUnsub: (() => void) | null = null;

    async function loadOlder() {
      if (isLoadingMoreRef.current || reachedHistoryStartRef.current || cancelled) return;
      const earliest = earliestLoadedTimeRef.current;
      if (!earliest || !refs.series.current || !refs.chart.current) return;

      isLoadingMoreRef.current = true;
      try {
        const periodSec = getCandlePeriodSeconds(timeframe);
        const MS_DAY = 86_400_000;
        // Tick bars: use a 3-day window (periodSec=0 so the normal formula gives 0)
        const lookbackMs = periodSec === 0
          ? 3 * MS_DAY
          : Math.min(Math.max(periodSec * 500 * 1000, 14 * MS_DAY), 365 * MS_DAY);
        const startTime = new Date(new Date(earliest).getTime() - lookbackMs).toISOString();

        const bars = await marketDataService.retrieveBars({
          contractId: contract!.id,
          live: false,
          unit: timeframe.unit,
          unitNumber: timeframe.unitNumber,
          startTime,
          endTime: earliest,
          limit: 20000,
          includePartialBar: false,
        });

        if (gen !== loadGenerationRef.current || cancelled) return;

        const sorted = sortBarsAscending(bars);
        // Exclude any bars at or after earliest (avoid duplicates at boundary)
        const filtered = sorted.filter((b) => b.t < earliest);

        // Tick bars: deduplicate second-level timestamps within this older batch
        if (timeframe.unit === 7) {
          for (let i = 1; i < filtered.length; i++) {
            const prevSec = Math.floor(new Date(filtered[i - 1].t).getTime() / 1000);
            const currSec = Math.floor(new Date(filtered[i].t).getTime() / 1000);
            if (currSec <= prevSec) {
              filtered[i] = { ...filtered[i], t: new Date((prevSec + 1) * 1000).toISOString() };
            }
          }
        }

        if (filtered.length === 0) {
          reachedHistoryStartRef.current = true;
          return;
        }

        const chart = refs.chart.current!;
        const visibleRange = chart.timeScale().getVisibleRange();

        const allBars = [...filtered, ...refs.bars.current];
        refs.bars.current = allBars;
        refs.drawingsPrimitive.current?.setBarsRef(allBars);
        earliestLoadedTimeRef.current = filtered[0].t;

        for (const c of filtered.map(barToCandle)) {
          refs.dataMap.current.set(c.time as number, c.close);
        }

        refs.series.current!.setData(allBars.map(barToCandle));

        if (visibleRange) {
          chart.timeScale().setVisibleRange(visibleRange);
        }
      } catch {
        // Silent — don't disrupt the user's session
      } finally {
        if (gen === loadGenerationRef.current && !cancelled) {
          isLoadingMoreRef.current = false;
        }
      }
    }

    async function loadBars() {
      setLoading(true);
      setError(null);
      refs.lastBar.current = null;
      try {
        let bars: Bar[];
        if (aggregationSource) {
          // Fast path: derive bars from the previous (finer) TF — instant, no network.
          // Source bars are live-updated by real-time ticks, so the trailing aggregated
          // bar reflects current price. If the source happens to be stale (e.g. tab was
          // backgrounded), the existing partial-bar topup below catches it.
          bars = aggregateBars(
            aggregationSource.bars,
            aggregationSource.sourcePeriodSec,
            aggregationSource.targetPeriodSec,
          );
        } else {
          const startTime = computeStartTime(timeframe);
          const endTime = new Date().toISOString();
          // Tick bars: cap at 500 bars (chartapi uses Countback; 20000 ticks would be days of data)
          const initialLimit = timeframe.unit === 7 ? 500 : 20000;
          bars = await marketDataService.retrieveBars({
            contractId: contract!.id,
            live: false,
            unit: timeframe.unit,
            unitNumber: timeframe.unitNumber,
            startTime,
            endTime,
            limit: initialLimit,
            includePartialBar: true,
          });
        }

        if (cancelled) return;

        // Re-enable autoScale for new instruments so the price axis resets to
        // the new instrument's range. Skip for same-instrument timeframe changes
        // to preserve the user's vertical scroll position.
        if (isNewContract) {
          refs.chart.current?.priceScale('right').applyOptions({ autoScale: true });
        }

        const sorted = sortBarsAscending(bars);

        // Tick bars: chartapi timestamps are millisecond-precise but LWC uses seconds.
        // Multiple bars can close within the same second — bump duplicates by 1s so
        // setData never gets two bars with identical timestamps.
        if (timeframe.unit === 7) {
          for (let i = 1; i < sorted.length; i++) {
            const prevSec = Math.floor(new Date(sorted[i - 1].t).getTime() / 1000);
            const currSec = Math.floor(new Date(sorted[i].t).getTime() / 1000);
            if (currSec <= prevSec) {
              sorted[i] = { ...sorted[i], t: new Date((prevSec + 1) * 1000).toISOString() };
            }
          }
        }

        refs.bars.current = sorted;
        previousTimeframeRef.current = timeframe;
        const candles = sorted.map(barToCandle);

        const periodSec = getCandlePeriodSeconds(timeframe);
        const TARGET_FUTURE_SECS = 90 * 86400;
        const wsCount = Math.min(2000, Math.max(50, Math.ceil(TARGET_FUTURE_SECS / periodSec)));

        const lastTime = candles.length > 0 ? (candles[candles.length - 1].time as number) : 0;
        // Tick bars have no fixed period — skip whitespace (bars don't land on regular intervals)
        if (periodSec > 0 && lastTime > 0 && refs.whitespaceSeries.current) {
          const wsFilter = contract?.marketType === 'futures' ? isTimestampInCMETradingSession : undefined;
          refs.whitespaceSeries.current.setData(generateWhitespace(lastTime, periodSec, wsCount, wsFilter));
        }

        series.setData(candles);
        earliestLoadedTimeRef.current = sorted.length > 0 ? sorted[0].t : null;
        refs.lastBar.current = candles.length > 0 ? candles[candles.length - 1] : null;

        // For tick bars: initialise tick counter from the partial bar's tv field.
        // tv tells us how many ticks are already in the forming bar; we need (unitNumber - tv) more.
        // If tv >= unitNumber the bar is already closed — set to 0 so the next live tick opens a new bar.
        if (timeframe.unit === 7 && sorted.length > 0) {
          const partialBar = sorted[sorted.length - 1];
          const tvSoFar = partialBar.tv ?? 0;
          ticksRemainingRef.current = tvSoFar >= timeframe.unitNumber ? 0 : Math.max(0, timeframe.unitNumber - tvSoFar);
          refs.countdown.current?.setTicksRemaining(ticksRemainingRef.current);
        }

        // If the last loaded bar is behind the current candle period (stale cache or API omission),
        // fetch the partial bar explicitly so there's no gap at the right edge on load.
        // Not applicable for tick bars — their bars close on tick count, not time.
        const currentPeriodStart = periodSec > 0 ? floorToCandlePeriod(Date.now() / 1000, periodSec) : Infinity;
        if (periodSec > 0 && refs.lastBar.current && (refs.lastBar.current.time as number) < currentPeriodStart) {
          try {
            const partialBars = await marketDataService.retrieveBars({
              contractId: contract!.id,
              live: false,
              unit: timeframe.unit,
              unitNumber: timeframe.unitNumber,
              startTime: new Date(currentPeriodStart * 1000).toISOString(),
              endTime: new Date().toISOString(),
              limit: 5,
              includePartialBar: true,
            });
            if (!cancelled && partialBars.length > 0) {
              const partialSorted = sortBarsAscending(partialBars);
              const partialCandles = partialSorted.map(barToCandle);
              for (let i = 0; i < partialCandles.length; i++) {
                series.update(partialCandles[i]);
                refs.bars.current.push(partialSorted[i]);
                refs.dataMap.current.set(partialCandles[i].time as number, partialCandles[i].close);
              }
              refs.lastBar.current = partialCandles[partialCandles.length - 1];
            }
          } catch { /* silent — real-time will fill */ }
        }

        if (refs.lastBar.current) {
          useStore.getState().setLastBarTime(refs.lastBar.current.time as number);
          refs.drawingsPrimitive.current?.setLastBarTime(refs.lastBar.current.time as number);
        }
        refs.bidAskPrimitive.current?.clear();
        refs.bidAskPrimitive.current?.setTickSize(contract!.tickSize);

        // Populate data map for crosshair sync
        refs.dataMap.current.clear();
        for (const c of candles) {
          refs.dataMap.current.set(c.time as number, c.close);
        }

        // If a drill-down target is pending, scroll to that candle's open time;
        // otherwise restore the user's view (same instrument) or show default last ~100 bars.
        const drillTarget = useStore.getState().pendingDrillTarget;
        if (drillTarget && drillTarget.chartId === chartId) {
          useStore.getState().clearPendingDrillTarget();
          // Find the bar index at or just after the drill target time
          const targetIdx = candles.findIndex((c) => (c.time as number) >= drillTarget.time);
          const fromIdx = targetIdx >= 0 ? targetIdx : Math.max(0, candles.length - 100);
          refs.chart.current?.timeScale().setVisibleLogicalRange({
            from: fromIdx,
            to: fromIdx + 100,
          });
        } else if (!isNewContract && savedScrollPos !== null && candles.length > 0) {
          // Same instrument, timeframe changed — restore saved horizontal scroll
          // so the current price stays at the same visual position.
          // Vertical scale is preserved automatically since autoScale stayed false.
          refs.chart.current?.timeScale().scrollToPosition(savedScrollPos, false);
        } else {
          const totalBars = candles.length;
          const visibleBars = Math.min(100, totalBars);
          refs.chart.current?.timeScale().setVisibleLogicalRange({
            from: totalBars - visibleBars,
            to: totalBars + 10,
          });
        }

        // Disable auto-scale so user can drag vertically immediately.
        // Only needed for new instruments (where we re-enabled it above).
        if (isNewContract) {
          autoScaleTimer = setTimeout(() => {
            refs.chart.current?.priceScale('right').applyOptions({ autoScale: false });
          }, 0);
        }

        // Configure series price format to snap crosshair label to tick size
        if (contract) {
          const dec = contract.tickSize.toString().split('.')[1]?.length ?? 0;
          series.applyOptions({
            priceFormat: { type: 'price', minMove: contract.tickSize, precision: dec },
          });
        }

        // Seed countdown primitive with initial price + config
        const cd = refs.countdown.current;
        if (cd) {
          const dec = contract ? (contract.tickSize.toString().split('.')[1]?.length ?? 0) : 2;
          cd.setDecimals(dec);
          if (periodSec > 0) cd.setPeriod(periodSec); // tick bars have no fixed period
          refs.drawingsPrimitive.current?.setDecimals(dec);
          refs.drawingsPrimitive.current?.setTickSize(contract?.tickSize ?? 0.01);
          refs.drawingsPrimitive.current?.setBarsRef(sorted);

          // Build trade volume map for anchor-mode FRVP drawings.
          // When market is open: restrict to current session. When closed: use all loaded bars.
          // Distributes each bar's volume evenly across its price range (low→high).
          const ts = contract?.tickSize ?? 0.01;
          const marketOpen = getSchedule(contract?.marketType).isOpen();
          const sessionStart = (contract?.marketType === 'futures' && marketOpen) ? getCurrentSessionStartSec() : 0;
          const tradeMap = new Map<number, number>();
          for (const bar of sorted) {
            if (sessionStart > 0 && Math.floor(new Date(bar.t).getTime() / 1000) < sessionStart) continue;
            if (bar.v <= 0 || bar.h < bar.l) continue;
            const lowIdx = Math.round(bar.l / ts);
            const highIdx = Math.round(bar.h / ts);
            const numTicks = Math.max(highIdx - lowIdx + 1, 1);
            const volPerTick = bar.v / numTicks;
            for (let i = lowIdx; i <= highIdx; i++) {
              const price = Math.round(i * ts * 1e10) / 1e10;
              tradeMap.set(price, (tradeMap.get(price) ?? 0) + volPerTick);
            }
          }
          tradeAnchorMapRef.current = tradeMap;
          refs.drawingsPrimitive.current?.setSharedVolumeMap(tradeAnchorMapRef.current);
          refs.crosshairLabel.current?.setDecimals(dec);
          refs.crosshairLabel.current?.setTickSize(contract?.tickSize ?? 0);
          if (refs.lastBar.current) {
            cd.updatePrice(refs.lastBar.current.close, false);
            cd.setOpen(refs.lastBar.current.open);
            refs.drawingsPrimitive.current?.setCountdownPrice(refs.lastBar.current.close);
          }
        }

        // Subscribe to left-edge scroll to fetch older batches on demand
        const chart = refs.chart.current;
        if (chart && earliestLoadedTimeRef.current) {
          const onRangeChange = (range: LogicalRange | null) => {
            if (!range || range.from > 50) return;
            loadOlder();
          };
          chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
          rangeUnsub = () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load bars');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBars();
    return () => {
      cancelled = true;
      rangeUnsub?.();
      rangeUnsub = null;
      if (autoScaleTimer != null) clearTimeout(autoScaleTimer);
    };
  }, [connected, contract, timeframe, reconnectCount]);

  // -- Real-time quote subscription --
  useEffect(() => {
    if (backtestConfig) return; // no live data in backtest mode
    if (!connected || !contract || !refs.series.current) return;

    const contractId = contract.id;
    const periodSec = getCandlePeriodSeconds(timeframe);
    let cancelled = false;

    async function startRealtime() {
      if (!realtimeService.isConnected()) {
        try {
          await realtimeService.connect();
        } catch (err) {
          if (import.meta.env.DEV) console.error('[chart] Failed to connect SignalR:', err);
          return;
        }
      }
      if (!cancelled) {
        realtimeService.subscribeQuotes(contractId);
      }
    }

    startRealtime();

    // RAF-batched chart update: accumulate tick data, flush once per frame
    let pendingBar: CandlestickData<UTCTimestamp> | null = null;
    let pendingPrice: number | null = null;
    let quoteRafId = 0;

    // Per-bar volume for FRVP range mode — accumulated from trade ticks, not quote volume.
    // Quote volume fields are unreliable (may include historical backfill batches on subscribe).
    let pendingBarVolume = 0;

    function flushQuote() {
      quoteRafId = 0;
      if (pendingBar && refs.series.current) {
        refs.series.current.update(pendingBar);
        refs.dataMap.current.set(pendingBar.time as number, pendingBar.close);

        // Keep refs.bars.current in sync (OHLCV) so range-mode FRVP builds correct volume maps.
        const bars = refs.bars.current;
        const barTimeSec = pendingBar.time as number;
        const last = bars.length > 0 ? bars[bars.length - 1] : null;
        const lastTimeSec = last ? Math.floor(new Date(last.t).getTime() / 1000) : -1;
        if (last && lastTimeSec === barTimeSec) {
          if (pendingBar.high > last.h) last.h = pendingBar.high;
          if (pendingBar.low < last.l) last.l = pendingBar.low;
          last.v = pendingBarVolume;
          refs.drawingsPrimitive.current?.setBarsRef(bars);
        } else if (lastTimeSec < barTimeSec) {
          bars.push({ t: new Date(barTimeSec * 1000).toISOString(), o: pendingBar.open, h: pendingBar.high, l: pendingBar.low, c: pendingBar.close, v: pendingBarVolume });
          refs.drawingsPrimitive.current?.setBarsRef(bars);
        }
      }
      if (pendingPrice != null) {
        refs.countdown.current?.updatePrice(pendingPrice, true);
        if (pendingBar) refs.countdown.current?.setOpen(pendingBar.open);
        refs.drawingsPrimitive.current?.setCountdownPrice(pendingPrice);
      }
      pendingBar = null;
      pendingPrice = null;
    }

    function handleQuote(quoteContractId: string, data: GatewayQuote) {
      if (quoteContractId !== contractId || !refs.series.current) return;

      // Tick bars update from individual trade ticks (handleMarketTick), not time-based quotes
      if (periodSec === 0) return;

      // Skip quotes while market is closed (e.g. CME maintenance/weekend)
      if (!getSchedule(contract?.marketType).isOpen()) return;

      const lastBar = refs.lastBar.current;
      // Don't process quotes until historical data has loaded
      if (!lastBar) return;

      const quoteSec = new Date(data.lastUpdated).getTime() / 1000;
      const realCandleTime = floorToCandlePeriod(quoteSec, periodSec);

      const candleTime = realCandleTime;

      // Skip quotes older than the current bar (lightweight-charts rejects these)
      if (candleTime < lastBar.time) return;

      // Track bid/ask footprint per candle (even if lastPrice is undefined)
      refs.bidAskPrimitive.current?.updateBidAsk(candleTime, data.bestBid, data.bestAsk);

      const price = data.lastPrice;
      if (price == null || !isFinite(price)) return;

      if (lastBar.time === candleTime) {
        // Update existing bar
        const updated: CandlestickData<UTCTimestamp> = {
          time: candleTime,
          open: lastBar.open,
          high: Math.max(lastBar.high, price),
          low: Math.min(lastBar.low, price),
          close: price,
        };
        refs.lastBar.current = updated;
        pendingBar = updated;
      } else {
        // New candle period — flush the previous pending bar immediately
        // so it isn't lost when RAF is throttled (e.g. tab backgrounded)
        if (pendingBar && refs.series.current) {
          refs.series.current.update(pendingBar);
          refs.dataMap.current.set(pendingBar.time as number, pendingBar.close);
        }
        pendingBarVolume = 0; // reset accumulator for the new bar
        const newBar: CandlestickData<UTCTimestamp> = {
          time: candleTime,
          open: price,
          high: price,
          low: price,
          close: price,
        };
        refs.lastBar.current = newBar;
        pendingBar = newBar;
        useStore.getState().setLastBarTime(candleTime);
        refs.drawingsPrimitive.current?.setLastBarTime(candleTime);
      }

      pendingPrice = price;

      // Schedule a single RAF flush (coalesces all ticks within one frame)
      if (!quoteRafId) {
        quoteRafId = requestAnimationFrame(flushQuote);
      }
    }

    realtimeService.onQuote(handleQuote);

    // Accumulate live GatewayTrade ticks into the anchor-mode FRVP volume map.
    // Also drives per-bar volume for range-mode FRVP — uses timestampMs to exclude
    // historical backfill batches that ProjectX sends on subscribe.
    function handleMarketTick(tickContractId: string, ticks: MarketTick[]) {
      if (tickContractId !== contractId) return;
      const ts = contract?.tickSize ?? 0.01;

      // FRVP anchor-mode volume map (all timeframes)
      for (const tick of ticks) {
        const key = Math.round(Math.round(tick.price / ts) * ts * 1e10) / 1e10;
        tradeAnchorMapRef.current.set(key, (tradeAnchorMapRef.current.get(key) ?? 0) + tick.size);
      }

      if (periodSec === 0) {
        // ── Tick bar live updates ─────────────────────────────────────────────
        // Each MarketTick is one trade. Decrement ticksRemainingRef; when it hits
        // 0 the current bar is complete and the next tick opens a new bar.
        for (const tick of ticks) {
          if (!refs.lastBar.current || !refs.series.current) continue;

          if (ticksRemainingRef.current <= 0) {
            // Flush any pending RAF update for the just-completed bar immediately
            if (pendingBar) {
              cancelAnimationFrame(quoteRafId);
              quoteRafId = 0;
              refs.series.current.update(pendingBar);
              refs.dataMap.current.set(pendingBar.time as number, pendingBar.close);
              const bars = refs.bars.current;
              const lastB = bars[bars.length - 1];
              if (lastB) { lastB.c = pendingBar.close; lastB.h = pendingBar.high; lastB.l = pendingBar.low; }
              pendingBar = null;
              pendingPrice = null;
            }

            // Open new bar with this tick
            const newTimeSec = Math.floor(tick.timestampMs / 1000) as import('lightweight-charts').UTCTimestamp;
            // LWC requires strictly increasing timestamps
            const safeTime = Math.max(newTimeSec, (refs.lastBar.current.time as number) + 1) as import('lightweight-charts').UTCTimestamp;
            const newBar: import('lightweight-charts').CandlestickData<import('lightweight-charts').UTCTimestamp> = {
              time: safeTime, open: tick.price, high: tick.price, low: tick.price, close: tick.price,
            };
            refs.lastBar.current = newBar;
            refs.series.current.update(newBar);
            refs.dataMap.current.set(safeTime, tick.price);
            refs.bars.current.push({ t: new Date(safeTime * 1000).toISOString(), o: tick.price, h: tick.price, l: tick.price, c: tick.price, v: 0 });
            refs.drawingsPrimitive.current?.setLastBarTime(safeTime);
            useStore.getState().setLastBarTime(safeTime);
            pendingBarVolume = tick.size; // first tick of the new bar
            ticksRemainingRef.current = timeframe.unitNumber - 1; // this tick already counted
            refs.countdown.current?.setTicksRemaining(ticksRemainingRef.current);
          } else {
            // Update the forming bar with this tick
            const lb = refs.lastBar.current;
            const updated: import('lightweight-charts').CandlestickData<import('lightweight-charts').UTCTimestamp> = {
              time: lb.time,
              open: lb.open,
              high: Math.max(lb.high, tick.price),
              low:  Math.min(lb.low,  tick.price),
              close: tick.price,
            };
            refs.lastBar.current = updated;
            pendingBarVolume += tick.size;
            ticksRemainingRef.current -= 1;
            refs.countdown.current?.setTicksRemaining(ticksRemainingRef.current);
            // Keep refs.bars.current in sync immediately so context-menu hit-testing
            // (isOverCandle) sees current h/l without waiting for the next RAF flush.
            const lastBarData = refs.bars.current[refs.bars.current.length - 1];
            if (lastBarData) {
              if (updated.high > lastBarData.h) lastBarData.h = updated.high;
              if (updated.low  < lastBarData.l) lastBarData.l = updated.low;
              lastBarData.c = tick.price;
            }
            pendingBar   = updated;
            pendingPrice = tick.price;
            if (!quoteRafId) quoteRafId = requestAnimationFrame(flushQuote);
          }

          refs.countdown.current?.updatePrice(tick.price, true);
          if (refs.lastBar.current) refs.countdown.current?.setOpen(refs.lastBar.current.open);
          refs.drawingsPrimitive.current?.setCountdownPrice(tick.price);
        }
        return;
      }

      // ── Time-based bars: accumulate per-bar volume for FRVP range mode ─────
      const lastBar = refs.lastBar.current;
      const barStartMs = lastBar ? (lastBar.time as number) * 1000 : null;
      for (const tick of ticks) {
        if (barStartMs !== null && tick.timestampMs >= barStartMs) {
          pendingBarVolume += tick.size;
        }
      }
    }
    realtimeService.onMarketTick(handleMarketTick);

    // When the tab regains visibility after being backgrounded, silently
    // backfill any candles that closed while RAF was throttled.
    // Tick bars skip this — they don't have time-aligned periods to backfill.
    function handleVisibilityChange() {
      if (periodSec === 0) return;
      if (document.hidden || !refs.series.current || cancelled || !getSchedule(contract?.marketType).isOpen()) return;

      // Flush any pending bar immediately
      if (pendingBar) {
        refs.series.current.update(pendingBar);
        refs.dataMap.current.set(pendingBar.time as number, pendingBar.close);
        pendingBar = null;
        pendingPrice = null;
      }

      // Fetch bars from the last known bar time to now and patch them in
      const lastBar = refs.lastBar.current;
      if (!lastBar) return;
      const startTime = new Date((lastBar.time as number) * 1000).toISOString();
      const endTime = new Date().toISOString();

      marketDataService.retrieveBars({
        contractId,
        live: false,
        unit: timeframe.unit,
        unitNumber: timeframe.unitNumber,
        startTime,
        endTime,
        limit: 500,
        includePartialBar: true,
      }).then((bars) => {
        if (cancelled || !refs.series.current) return;
        const sorted = sortBarsAscending(bars);
        const candles = sorted.map(barToCandle);
        for (const c of candles) {
          refs.series.current!.update(c);
          refs.dataMap.current.set(c.time as number, c.close);
        }
        if (candles.length > 0) {
          refs.lastBar.current = candles[candles.length - 1];
        }
      }).catch(() => { /* silent — next tick will update anyway */ });
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      cancelAnimationFrame(quoteRafId);
      refs.countdown.current?.setLive(false);
      refs.countdown.current?.setTicksRemaining(null); // revert to time-based mode
      realtimeService.offQuote(handleQuote);
      realtimeService.offMarketTick(handleMarketTick);
      realtimeService.unsubscribeQuotes(contractId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connected, contract, timeframe]);

  // -- Market depth subscription (always active when connected+contract) --
  // Depth data feeds both the Market Depth indicator and FRVP drawings — decouple from domEnabled.
  useEffect(() => {
    if (backtestConfig) return;
    const vp = refs.domPrimitive.current;
    if (!vp || !connected || !contract) {
      // Don't clear — stale depth data persists while disconnected so bars
      // don't vanish during a backend restart. The Reset entry on reconnect
      // will wipe and refill the map with fresh data.
      return;
    }

    const contractId = contract.id;
    const tickSize = contract.tickSize;
    vp.setTickSize(tickSize);

    // Clear only when the contract actually changes, not on mere reconnects.
    // On first load or contract switch: restore persisted depth from localStorage
    // so bars appear immediately even before the gateway sends its first update.
    if (domContractIdRef.current !== contractId) {
      const storageKey = `dom-depth-${contractId}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const entries: [number, number][] = JSON.parse(saved);
          vp.setVolumeMap(new Map(entries));
        } catch {
          vp.clear();
        }
      } else {
        vp.clear();
      }
      domContractIdRef.current = contractId;
    }

    function handleDepth(depthContractId: string, entries: DepthEntry[]) {
      if (depthContractId !== contractId || !vp) return;

      for (const entry of entries) {
        if (entry.type === DepthType.Reset) {
          vp.clear();
          continue;
        }
        if (entry.type === DepthType.VolumeAtPrice) {
          vp.updateLevel(entry.price, entry.volume);
        }
      }
    }

    // Save depth map to localStorage so it survives page refresh and backend restarts.
    function saveDepth() {
      const map = vp.getVolumeMap();
      if (map.size > 0) {
        localStorage.setItem(`dom-depth-${contractId}`, JSON.stringify([...map.entries()]));
      }
    }
    window.addEventListener('beforeunload', saveDepth);

    realtimeService.onDepth(handleDepth);
    realtimeService.subscribeDepth(contractId);

    return () => {
      realtimeService.offDepth(handleDepth);
      realtimeService.unsubscribeDepth(contractId);
      window.removeEventListener('beforeunload', saveDepth);
      // Save on disconnect too (backend restart case — no page unload fires).
      saveDepth();
    };
  }, [connected, contract]);

  // -- Market depth rendering toggle (separate from data so toggling doesn't re-subscribe) --
  useEffect(() => {
    refs.domPrimitive.current?.setEnabled(domEnabled);
  }, [domEnabled]);

  // -- Market depth color sync --
  useEffect(() => {
    refs.domPrimitive.current?.setColor(domColor);
  }, [domColor]);

  // -- Market depth hover expand sync --
  useEffect(() => {
    refs.domPrimitive.current?.setHoverExpand(domHoverExpand);
  }, [domHoverExpand]);

  // -- Market depth row layout sync --
  useEffect(() => {
    refs.domPrimitive.current?.setRowLayout(domRowLayout, domRowSize);
  }, [domRowLayout, domRowSize]);

  // -- Market depth bar placement sync --
  useEffect(() => {
    refs.domPrimitive.current?.setBarPlacement(domBarPlacement);
  }, [domBarPlacement]);

  // -- Market depth bar offset sync --
  useEffect(() => {
    refs.domPrimitive.current?.setBarOffset(domBarOffset);
  }, [domBarOffset]);

  // -- Market depth bar length sync --
  useEffect(() => {
    refs.domPrimitive.current?.setBarLength(domBarLength);
  }, [domBarLength]);

  // -- Bid/Ask footprint enabled sync --
  useEffect(() => {
    refs.bidAskPrimitive.current?.setEnabled(bidAskEnabled);
  }, [bidAskEnabled]);

  // -- Market depth hover tracking (crosshair move feeds hover price to primitive) --
  useEffect(() => {
    const chart = refs.chart.current;
    const vp = refs.domPrimitive.current;
    if (!chart || !vp || !domEnabled) return;

    let rafId = 0;
    let lastMouseX = 0;

    function onCrosshairMove(param: import('lightweight-charts').MouseEventParams) {
      if (!vp) return;
      if (!param.point || !refs.series.current) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        vp.setHoverPrice(null);
        return;
      }
      const x = param.point.x;
      const y = param.point.y;
      lastMouseX = x;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          const price = refs.series.current?.coordinateToPrice(y) ?? null;
          vp.setHoverPrice(price);
        });
      }
    }

    function onDblClick() {
      if (!vp || !refs.container.current) return;
      const chartWidth = refs.container.current.clientWidth;
      if (vp.isHoveringBar(lastMouseX, chartWidth)) {
        window.dispatchEvent(new CustomEvent('open-dom-settings'));
      }
    }

    const container = refs.container.current;
    chart.subscribeCrosshairMove(onCrosshairMove);
    container?.addEventListener('dblclick', onDblClick);
    return () => {
      cancelAnimationFrame(rafId);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      container?.removeEventListener('dblclick', onDblClick);
      vp.setHoverPrice(null);
    };
  }, [domEnabled]);

  // -- Candlestick double-click: open chart settings popover --
  useEffect(() => {
    const container = refs.container.current;
    const chart = refs.chart.current;
    if (!container || !chart) return;

    // Track last crosshair position so the dblclick handler knows if we're over a candle
    let lastCrosshairTime: number | null = null;
    let lastCrosshairY: number | null = null;
    const onCrosshairMove = (param: import('lightweight-charts').MouseEventParams) => {
      lastCrosshairTime = param.time != null ? (param.time as number) : null;
      lastCrosshairY    = param.point?.y ?? null;
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    function isOverCandle(utcSeconds: number, pointY: number): boolean {
      const bar = refs.bars.current.find(b => Math.floor(new Date(b.t).getTime() / 1000) === utcSeconds) ?? null;
      if (!bar) return false;
      const highY = refs.series.current?.priceToCoordinate(bar.h) ?? null;
      const lowY  = refs.series.current?.priceToCoordinate(bar.l) ?? null;
      if (highY == null || lowY == null) return false;
      return pointY >= highY && pointY <= lowY;
    }

    function onDblClick(e: MouseEvent) {
      // Only fire when the crosshair is over an actual candle body/wick
      if (lastCrosshairTime == null || lastCrosshairY == null) return;
      if (!isOverCandle(lastCrosshairTime, lastCrosshairY)) return;

      // If hovering a market depth bar, let that handler take priority
      const vp = refs.domPrimitive.current;
      if (vp && vp.isHoveringBar(e.offsetX, container.clientWidth)) return;

      window.dispatchEvent(new CustomEvent('open-chart-settings'));
    }

    container.addEventListener('dblclick', onDblClick);
    return () => {
      container.removeEventListener('dblclick', onDblClick);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { loading, error };
}
