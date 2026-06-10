import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';
import type { Bar, Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { marketDataService } from '../../../services/marketDataService';
import { realtimeService, type GatewayQuote, type MarketTick } from '../../../services/realtimeService';
import {
  barToCandle,
  sortBarsAscending,
  getCandlePeriodSeconds,
  floorToCandlePeriod,
} from '../barUtils';
import type { ChartRefs } from './types';
import { debugLog } from '../../../utils/debugLog';
import type { BacktestConfig } from '../CandlestickChart';
import { getSchedule } from '../../../utils/marketHours';

export function useRealtimeQuotes(
  refs: ChartRefs,
  contract: Contract | null,
  timeframe: Timeframe,
  backtestConfig: BacktestConfig | undefined,
  connected: boolean,
  tradeAnchorMapRef: MutableRefObject<Map<number, number>>,
  ticksRemainingRef: MutableRefObject<number>,
): void {
  useEffect(() => {
    if (backtestConfig) return; // no live data in backtest mode
    if (!connected || !contract || !refs.series.current) return;

    debugLog.enable();

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
    let isBackfilling = false;

    // Per-bar volume for FRVP range mode — accumulated from trade ticks, not quote volume.
    // Quote volume fields are unreliable (may include historical backfill batches on subscribe).
    let pendingBarVolume = 0;

    // Fetch closed bars from fromTimeSec to now and patch them into the series via setData.
    // Used by both the visibility handler and the gap-detection path in handleQuote.
    function triggerBackfill(fromTimeSec: number) {
      if (isBackfilling || !refs.series.current || cancelled) return;
      isBackfilling = true;

      const startTime = new Date(fromTimeSec * 1000).toISOString();
      const endTime = new Date().toISOString();
      debugLog.log('gap-backfill', { fromTimeSec, startTime, endTime });

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
        isBackfilling = false;
        if (cancelled || !refs.series.current) return;
        const sorted = sortBarsAscending(bars);
        if (sorted.length === 0) return;

        const fetchStartSec = Math.floor(new Date(sorted[0].t).getTime() / 1000);
        const existingBars = refs.bars.current.filter(
          b => Math.floor(new Date(b.t).getTime() / 1000) < fetchStartSec,
        );
        const mergedBars = [...existingBars, ...sorted];
        refs.bars.current = mergedBars;
        const mergedCandles = mergedBars.map(barToCandle);
        for (const c of mergedCandles) {
          refs.dataMap.current.set(c.time as number, c.close);
        }

        const visibleRange = refs.chart.current?.timeScale().getVisibleRange() ?? null;
        refs.series.current!.setData(mergedCandles);
        if (visibleRange) refs.chart.current?.timeScale().setVisibleRange(visibleRange);

        if (pendingBar) refs.series.current!.update(pendingBar);

        const fetchedLast = mergedCandles[mergedCandles.length - 1];
        if (!refs.lastBar.current || (fetchedLast.time as number) > (refs.lastBar.current.time as number)) {
          refs.lastBar.current = fetchedLast;
        }

        debugLog.log('gap-backfill-done', { fetched: sorted.length, merged: mergedBars.length, newLastBarTime: refs.lastBar.current?.time });
      }).catch(() => { isBackfilling = false; });
    }

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
          last.c = pendingBar.close;
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
        refs.drawingsPrimitive.current?.setCountdownPrice(pendingPrice, refs.countdown.current?.getTimerOffset() ?? 0);
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
      // Cap at current wall-clock minute: a server quote with a future timestamp
      // must not prematurely open the next bar and strand the current one.
      const candleTime = Math.min(realCandleTime, floorToCandlePeriod(Date.now() / 1000, periodSec)) as UTCTimestamp;

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
          // Sync final OHLC to refs.bars.current: the queued RAF for this bar may fire
          // after pendingBar is replaced by the new bar, leaving the cache with stale h/l/c.
          const bars = refs.bars.current;
          const last = bars.length > 0 ? bars[bars.length - 1] : null;
          if (last) {
            const lastSec = Math.floor(new Date(last.t).getTime() / 1000);
            if (lastSec === (pendingBar.time as number)) {
              if (pendingBar.high > last.h) last.h = pendingBar.high;
              if (pendingBar.low  < last.l) last.l = pendingBar.low;
              last.c = pendingBar.close;
            }
          }
        }
        // Log every bar transition so we can spot gaps (skipped periods) and
        // future-timestamp quotes that prematurely open the next bar.
        const wallClockCandleTime = floorToCandlePeriod(Date.now() / 1000, periodSec);
        const skipped = periodSec > 0 ? Math.round((candleTime - lastBar.time) / periodSec) - 1 : 0;
        debugLog.log('bar-transition', {
          from: lastBar.time,
          to: candleTime,
          skipped,
          wallClock: wallClockCandleTime,
          quoteFuture: candleTime > wallClockCandleTime,
          quoteSec: Math.round(quoteSec),
          tf: `${timeframe.unitNumber}${['','s','m','h','d','w','mo','tick'][timeframe.unit] ?? '?'}`,
        });
        // Bars were missed (reconnect, JS throttle, AFK) — backfill them from the server.
        if (skipped > 0) triggerBackfill(lastBar.time as number);
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

      // When the tab is hidden, RAF is throttled/suspended by the browser, so
      // series.update() never gets called. Flush immediately while hidden so
      // LWC stays current — on tab focus there is nothing to backfill and no
      // setData flash. When visible, keep the normal RAF coalescing for perf.
      if (document.hidden) {
        if (quoteRafId) { cancelAnimationFrame(quoteRafId); quoteRafId = 0; }
        flushQuote();
      } else if (!quoteRafId) {
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
            const newTimeSec = Math.floor(tick.timestampMs / 1000) as UTCTimestamp;
            // LWC requires strictly increasing timestamps
            const safeTime = Math.max(newTimeSec, (refs.lastBar.current.time as number) + 1) as UTCTimestamp;
            const newBar: CandlestickData<UTCTimestamp> = {
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
            const updated: CandlestickData<UTCTimestamp> = {
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
          refs.drawingsPrimitive.current?.setCountdownPrice(tick.price, refs.countdown.current?.getTimerOffset() ?? 0);
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

      if (pendingBar) {
        refs.series.current.update(pendingBar);
        refs.dataMap.current.set(pendingBar.time as number, pendingBar.close);
        pendingBar = null;
        pendingPrice = null;
      }

      const lastBar = refs.lastBar.current;
      if (!lastBar) return;

      // If lastBar is within the current candle period, flushQuote() kept LWC
      // in sync while the tab was hidden — no backfill or setData needed.
      const currentPeriodStart = floorToCandlePeriod(Date.now() / 1000, periodSec);
      if ((lastBar.time as number) >= currentPeriodStart - periodSec) return;

      debugLog.log('visibility-backfill', { lastBarTime: lastBar.time });
      triggerBackfill(lastBar.time as number);
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
}
