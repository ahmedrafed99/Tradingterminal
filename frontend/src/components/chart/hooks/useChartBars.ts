import { useEffect, useRef, useState } from 'react';
import type { CandlestickData, UTCTimestamp, LogicalRange } from 'lightweight-charts';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { marketDataService } from '../../../services/marketDataService';
import { realtimeService, type GatewayQuote, type DepthEntry, type MarketTick } from '../../../services/realtimeService';
import { DepthType } from '../../../types/enums';
import {
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
  const prevContractIdRef = useRef<number | null>(null);

  // Historical load-more state
  const earliestLoadedTimeRef = useRef<string | null>(null);
  const isLoadingMoreRef = useRef(false);
  const reachedHistoryStartRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const domEnabled = useStore((s) => chartId === 'left' ? s.domEnabled : chartId === 'right' ? s.secondDomEnabled : false);
  const domColor = useStore((s) => chartId === 'left' ? s.domColor : chartId === 'right' ? s.secondDomColor : '#2196f3');
  const domHoverExpand = useStore((s) => chartId === 'left' ? s.domHoverExpand : chartId === 'right' ? s.secondDomHoverExpand : false);
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

    let rangeUnsub: (() => void) | null = null;

    async function loadOlder() {
      if (isLoadingMoreRef.current || reachedHistoryStartRef.current || cancelled) return;
      const earliest = earliestLoadedTimeRef.current;
      if (!earliest || !refs.series.current || !refs.chart.current) return;

      isLoadingMoreRef.current = true;
      try {
        const periodSec = getCandlePeriodSeconds(timeframe);
        const MS_DAY = 86_400_000;
        const lookbackMs = Math.min(Math.max(periodSec * 500 * 1000, 14 * MS_DAY), 365 * MS_DAY);
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
        const startTime = computeStartTime(timeframe);
        const endTime = new Date().toISOString();
        const bars = await marketDataService.retrieveBars({
          contractId: contract!.id,
          live: false,
          unit: timeframe.unit,
          unitNumber: timeframe.unitNumber,
          startTime,
          endTime,
          limit: 20000,
          includePartialBar: true,
        });

        if (cancelled) return;

        // Re-enable autoScale for new instruments so the price axis resets to
        // the new instrument's range. Skip for same-instrument timeframe changes
        // to preserve the user's vertical scroll position.
        if (isNewContract) {
          refs.chart.current?.priceScale('right').applyOptions({ autoScale: true });
        }

        const sorted = sortBarsAscending(bars);
        refs.bars.current = sorted;
        const candles = sorted.map(barToCandle);

        const periodSec = getCandlePeriodSeconds(timeframe);
        const TARGET_FUTURE_SECS = 90 * 86400;
        const wsCount = Math.min(2000, Math.max(50, Math.ceil(TARGET_FUTURE_SECS / periodSec)));

        const lastTime = candles.length > 0 ? (candles[candles.length - 1].time as number) : 0;
        if (lastTime > 0 && refs.whitespaceSeries.current) {
          const wsFilter = contract?.marketType === 'futures' ? isTimestampInCMETradingSession : undefined;
          refs.whitespaceSeries.current.setData(generateWhitespace(lastTime, periodSec, wsCount, wsFilter));
        }

        series.setData(candles);
        earliestLoadedTimeRef.current = sorted.length > 0 ? sorted[0].t : null;
        refs.lastBar.current = candles.length > 0 ? candles[candles.length - 1] : null;

        // If the last loaded bar is behind the current candle period (stale cache or API omission),
        // fetch the partial bar explicitly so there's no gap at the right edge on load.
        const currentPeriodStart = floorToCandlePeriod(Date.now() / 1000, periodSec);
        if (refs.lastBar.current && (refs.lastBar.current.time as number) < currentPeriodStart) {
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
          cd.setPeriod(periodSec);
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
      const lastBar = refs.lastBar.current;
      const barStartMs = lastBar ? (lastBar.time as number) * 1000 : null;
      for (const tick of ticks) {
        const key = Math.round(Math.round(tick.price / ts) * ts * 1e10) / 1e10;
        tradeAnchorMapRef.current.set(key, (tradeAnchorMapRef.current.get(key) ?? 0) + tick.size);
        if (barStartMs !== null && tick.timestampMs >= barStartMs) {
          pendingBarVolume += tick.size;
        }
      }
    }
    realtimeService.onMarketTick(handleMarketTick);

    // When the tab regains visibility after being backgrounded, silently
    // backfill any candles that closed while RAF was throttled.
    function handleVisibilityChange() {
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
      refs.domPrimitive.current?.clear();
      return;
    }

    const contractId = contract.id;
    const tickSize = contract.tickSize;
    vp.setTickSize(tickSize);
    vp.clear();

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

    realtimeService.onDepth(handleDepth);
    realtimeService.subscribeDepth(contractId);

    return () => {
      realtimeService.offDepth(handleDepth);
      realtimeService.unsubscribeDepth(contractId);
      vp.clear();
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

    function onCrosshairMove(param: import('lightweight-charts').MouseEventParams) {
      if (!vp) return;
      if (!param.point || !refs.series.current) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        vp.setHoverPrice(null);
        return;
      }
      const y = param.point.y;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          const p = refs.series.current?.coordinateToPrice(y) ?? null;
          vp.setHoverPrice(p);
        });
      }
    }

    chart.subscribeCrosshairMove(onCrosshairMove);
    return () => {
      cancelAnimationFrame(rafId);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      vp.setHoverPrice(null);
    };
  }, [domEnabled]);

  return { loading, error };
}
