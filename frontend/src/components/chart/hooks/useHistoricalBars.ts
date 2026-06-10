import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { CandlestickData, UTCTimestamp, LogicalRange } from 'lightweight-charts';
import type { Bar, Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { marketDataService } from '../../../services/marketDataService';
import { backtestService } from '../../../services/backtestService';
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
import { debugLog } from '../../../utils/debugLog';
import type { BacktestConfig } from '../CandlestickChart';
import { getSchedule, isTimestampInCMETradingSession, getCurrentSessionStartSec } from '../../../utils/marketHours';

export function useHistoricalBars(
  refs: ChartRefs,
  chartId: 'left' | 'right' | 'backtest',
  contract: Contract | null,
  timeframe: Timeframe,
  backtestConfig: BacktestConfig | undefined,
  connected: boolean,
  reconnectCount: number,
  tradeAnchorMapRef: MutableRefObject<Map<number, number>>,
  ticksRemainingRef: MutableRefObject<number>,
): { loading: boolean; error: string | null } {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prevContractIdRef = useRef<string | null>(null);
  // TF of the bars currently in refs.bars.current — used to derive a coarser TF
  // via client-side aggregation on switch (skips the network round-trip entirely).
  const previousTimeframeRef = useRef<Timeframe | null>(null);
  // Per-(contract, TF) bar cache — persists across TF switches so revisiting a TF
  // only needs a small incremental fetch instead of re-requesting all 20 k bars.
  // Keyed as `${contractId}:${unit}:${unitNumber}`. Updated (via snapshot) whenever
  // we leave a TF so the stored array is always live at time of departure.
  // cachedAt is wall-clock time (ms) when the entry was written — used for freshness
  // so weekends/overnight closures don't expire the cache (last bar time is stale then).
  const barsCacheRef = useRef<Map<string, { bars: Bar[]; cachedAt: number }>>(new Map());
  // Historical load-more state
  const earliestLoadedTimeRef = useRef<string | null>(null);
  const isLoadingMoreRef = useRef(false);
  const reachedHistoryStartRef = useRef(false);
  const loadGenerationRef = useRef(0);

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
      refs.drawingsPrimitive.current?.setCountdownPrice(last.close, refs.countdown.current?.getTimerOffset() ?? 0);

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

    // Persist the outgoing TF's live bars into the cache so switch-back only needs
    // a tiny incremental fetch instead of a full 20 k-bar request.
    if (!isNewContract && previousTimeframeRef.current && refs.bars.current.length > 0) {
      const prevTf = previousTimeframeRef.current;
      barsCacheRef.current.set(
        `${contract.id}:${prevTf.unit}:${prevTf.unitNumber}`,
        { bars: refs.bars.current, cachedAt: Date.now() },
      );
    }

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
      // If the target TF is already cached, skip aggregation: the source (finer) TF
      // covers less history, so aggregating it would produce fewer bars than the cache.
      const tfKey = `${contract!.id}:${timeframe.unit}:${timeframe.unitNumber}`;
      if (barsCacheRef.current.has(tfKey)) return null;
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
          const periodSec = getCandlePeriodSeconds(timeframe);
          const tfKey = `${contract!.id}:${timeframe.unit}:${timeframe.unitNumber}`;
          const cacheEntry = barsCacheRef.current.get(tfKey);
          const cachedBars = cacheEntry?.bars ?? null;
          const lastCached = cachedBars && cachedBars.length > 0
            ? cachedBars[cachedBars.length - 1]
            : null;
          // Use incremental fetch when: bars are cached, TF is time-based, and
          // the cache was written less than 12 h ago (keyed on write-time, not last
          // bar time — last bar can be days old during weekends/overnight closures).
          const cacheAgeMs = cacheEntry
            ? Date.now() - cacheEntry.cachedAt
            : Infinity;

          if (lastCached && periodSec > 0 && cacheAgeMs < 12 * 3_600_000) {
            // Fetch only the bars we missed since leaving this TF.
            // Go back 2 periods so the previously-partial bar is refreshed with its
            // final closed OHLC rather than the stale snapshot we left with.
            // Scale the limit to cover the full gap: API returns newest-first so a
            // fixed 500 would truncate the oldest end and leave a hole in the merge.
            const fromMs = new Date(lastCached.t).getTime() - 2 * periodSec * 1000;
            const requiredBars = Math.ceil(cacheAgeMs / 1000 / periodSec) + 50;
            const fetchLimit = Math.min(Math.max(500, requiredBars), 20000);
            const deltaBars = await marketDataService.retrieveBars({
              contractId: contract!.id,
              live: false,
              unit: timeframe.unit,
              unitNumber: timeframe.unitNumber,
              startTime: new Date(fromMs).toISOString(),
              endTime: new Date().toISOString(),
              limit: fetchLimit,
              includePartialBar: true,
            });
            if (cancelled) return;
            const sortedDelta = sortBarsAscending(deltaBars);
            // Merge: keep cached bars that pre-date the delta window, then append delta.
            // Deduplicate by second-level timestamp (ISO format can vary: .000Z vs Z),
            // keeping the delta bar when there's a clash (it has the freshest OHLC).
            const deltaStartSec = sortedDelta.length > 0
              ? Math.floor(new Date(sortedDelta[0].t).getTime() / 1000)
              : Infinity;
            const lastCachedSec = Math.floor(new Date(lastCached.t).getTime() / 1000);
            const gapDetected = sortedDelta.length > 0 && deltaStartSec > lastCachedSec + 2 * periodSec;
            // Defense-in-depth: if the limit was still exhausted (e.g. ultra-fine TF),
            // the delta won't connect to the cache — use delta only to avoid a gap.
            const baseArr = gapDetected
              ? sortedDelta
              : [
                  ...cachedBars!.filter(b => Math.floor(new Date(b.t).getTime() / 1000) < deltaStartSec),
                  ...sortedDelta,
                ];
            const bySecond = new Map<number, Bar>();
            for (const bar of baseArr) {
              bySecond.set(Math.floor(new Date(bar.t).getTime() / 1000), bar);
            }
            bars = Array.from(bySecond.values())
              .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
          } else {
            // No usable cache — full fetch.
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
        }

        if (cancelled) return;

        // Re-enable autoScale for new instruments so the price axis resets to
        // the new instrument's range. Skip for same-instrument timeframe changes
        // to preserve the user's vertical scroll position.
        if (isNewContract) {
          refs.chart.current?.priceScale('right').applyOptions({ autoScale: true });
        }

        const sorted = sortBarsAscending(bars);
        const countBeforeDedup = sorted.length;

        // Floor daily bar timestamps to midnight UTC — primary API returns 05:00 UTC
        // (midnight ET), chartapi returns 00:00 UTC; normalizing here makes both share
        // the same second so the dedup below collapses same-day bars from either source.
        if (timeframe.unit === 4) {
          for (let i = 0; i < sorted.length; i++) {
            const ms = new Date(sorted[i].t).getTime();
            const floored = Math.floor(ms / 86_400_000) * 86_400_000;
            if (floored !== ms) sorted[i] = { ...sorted[i], t: new Date(floored).toISOString() };
          }
        }

        // LWC uses integer second timestamps. For tick bars, sub-second collisions are
        // common so we bump duplicates by 1s. For all other timeframes (including daily),
        // the API can occasionally return two bars with the same second-level timestamp
        // (e.g. at session boundaries or contract rollovers) — drop the earlier duplicate.
        if (timeframe.unit === 7) {
          for (let i = 1; i < sorted.length; i++) {
            const prevSec = Math.floor(new Date(sorted[i - 1].t).getTime() / 1000);
            const currSec = Math.floor(new Date(sorted[i].t).getTime() / 1000);
            if (currSec <= prevSec) {
              sorted[i] = { ...sorted[i], t: new Date((prevSec + 1) * 1000).toISOString() };
            }
          }
        } else {
          // Deduplicate by second — keep the last bar for any colliding second.
          const bySecond = new Map<number, Bar>();
          for (const bar of sorted) {
            bySecond.set(Math.floor(new Date(bar.t).getTime() / 1000), bar);
          }
          if (bySecond.size < sorted.length) {
            debugLog.log('load-bars-dedup', {
              before: sorted.length,
              after: bySecond.size,
              dropped: sorted.length - bySecond.size,
              tf: `${timeframe.unitNumber}${['','s','m','h','d','w','mo','tick'][timeframe.unit] ?? '?'}`,
            });
            sorted.length = 0;
            bySecond.forEach((bar) => sorted.push(bar));
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

        debugLog.log('load-bars-setData', {
          tf: `${timeframe.unitNumber}${['','s','m','h','d','w','mo','tick'][timeframe.unit] ?? '?'}`,
          count: candles.length,
          firstTime: candles[0]?.time,
          lastTime: candles[candles.length - 1]?.time,
          firstISO: candles[0] ? new Date((candles[0].time as number) * 1000).toISOString() : null,
          lastISO: candles[candles.length - 1] ? new Date(((candles[candles.length - 1].time) as number) * 1000).toISOString() : null,
          dedupFired: sorted.length < countBeforeDedup,
          rawCount: bars.length,
        });

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
        debugLog.log('load-bars-topup-check', {
          periodSec,
          lastBarTime: refs.lastBar.current?.time,
          lastBarISO: refs.lastBar.current ? new Date((refs.lastBar.current.time as number) * 1000).toISOString() : null,
          currentPeriodStart,
          currentPeriodISO: currentPeriodStart !== Infinity ? new Date(currentPeriodStart * 1000).toISOString() : null,
          topupWillFire: periodSec > 0 && !!refs.lastBar.current && (refs.lastBar.current.time as number) < currentPeriodStart,
        });
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
            debugLog.log('load-bars-topup-result', {
              fetched: partialBars.length,
              bars: partialBars.map(b => ({ t: b.t, tSec: Math.floor(new Date(b.t).getTime() / 1000) })),
            });
            if (!cancelled && partialBars.length > 0) {
              const partialSorted = sortBarsAscending(partialBars);
              if (timeframe.unit === 4) {
                for (let i = 0; i < partialSorted.length; i++) {
                  const ms = new Date(partialSorted[i].t).getTime();
                  const floored = Math.floor(ms / 86_400_000) * 86_400_000;
                  if (floored !== ms) partialSorted[i] = { ...partialSorted[i], t: new Date(floored).toISOString() };
                }
              }
              const partialCandles = partialSorted.map(barToCandle);
              for (let i = 0; i < partialCandles.length; i++) {
                const alreadyInSeries = candles.some(c => c.time === partialCandles[i].time);
                debugLog.log('load-bars-topup-update', {
                  time: partialCandles[i].time,
                  iso: new Date((partialCandles[i].time as number) * 1000).toISOString(),
                  alreadyInMainFetch: alreadyInSeries,
                });
                series.update(partialCandles[i]);
                refs.bars.current.push(partialSorted[i]);
                refs.dataMap.current.set(partialCandles[i].time as number, partialCandles[i].close);
              }
              refs.lastBar.current = partialCandles[partialCandles.length - 1];
            }
          } catch { /* silent — real-time will fill */ }
        }

        if (cancelled) return;

        if (refs.lastBar.current) {
          useStore.getState().setLastBarTime(refs.lastBar.current.time as number);
          refs.drawingsPrimitive.current?.setLastBarTime(refs.lastBar.current.time as number);
        }
        refs.bidAskPrimitive.current?.clear();
        refs.bidAskPrimitive.current?.setTickSize(contract!.tickSize);

        // Populate data map for crosshair sync (includes partial bars pushed above)
        refs.dataMap.current.clear();
        for (const bar of refs.bars.current) {
          const c = barToCandle(bar);
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

  return { loading, error };
}
