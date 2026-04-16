import { useEffect, useRef, useState } from 'react';
import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';
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
import { getSchedule, isTimestampInCMETradingSession, getCurrentSessionStartSec } from '../../../utils/marketHours';

/**
 * Handles historical bar loading, real-time quote subscription, and volume profile.
 */
export function useChartBars(
  refs: ChartRefs,
  chartId: 'left' | 'right',
  contract: Contract | null,
  timeframe: Timeframe,
): { loading: boolean; error: string | null } {

  const connected = useStore((s) => s.connected);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Accumulated trade volume map for anchor-mode FRVP drawings (price → contracts traded)
  const tradeAnchorMapRef = useRef(new Map<number, number>());

  const domEnabled = useStore((s) => chartId === 'left' ? s.domEnabled : s.secondDomEnabled);
  const domColor = useStore((s) => chartId === 'left' ? s.domColor : s.secondDomColor);
  const domHoverExpand = useStore((s) => chartId === 'left' ? s.domHoverExpand : s.secondDomHoverExpand);
  const bidAskEnabled = useStore((s) => chartId === 'left' ? s.bidAskEnabled : s.secondBidAskEnabled);

  // Bump to force historical bar reload on market hub reconnect
  const [reconnectCount, setReconnectCount] = useState(0);
  useEffect(() => {
    const handler = () => setReconnectCount((c) => c + 1);
    realtimeService.onMarketReconnect(handler);
    return () => { realtimeService.offMarketReconnect(handler); };
  }, []);

  // -- Historical bars loading --
  useEffect(() => {
    if (!connected || !contract || !refs.series.current) return;

    const series = refs.series.current;
    let cancelled = false;
    let autoScaleTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadBars() {
      setLoading(true);
      setError(null);
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

        // Re-enable autoScale before loading new data so the price axis
        // resets to the new instrument's range (it may still be locked to
        // the previous instrument's scale from the last load).
        refs.chart.current?.priceScale('right').applyOptions({ autoScale: true });

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
        refs.lastBar.current = candles.length > 0 ? candles[candles.length - 1] : null;
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

        // Show the last ~100 bars zoomed in, with some right padding
        const totalBars = candles.length;
        const visibleBars = Math.min(100, totalBars);
        refs.chart.current?.timeScale().setVisibleLogicalRange({
          from: totalBars - visibleBars,
          to: totalBars + 10,
        });

        // Disable auto-scale so user can drag vertically immediately
        // (must happen after data load so the chart knows the initial price range)
        autoScaleTimer = setTimeout(() => {
          refs.chart.current?.priceScale('right').applyOptions({ autoScale: false });
        }, 0);

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

          // Build trade volume map from current-session bars only for anchor-mode FRVP drawings.
          // Distributes each bar's volume evenly across its price range (low→high).
          const ts = contract?.tickSize ?? 0.01;
          const sessionStart = contract?.marketType === 'futures' ? getCurrentSessionStartSec() : 0;
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
            refs.drawingsPrimitive.current?.setCountdownPrice(refs.lastBar.current.close);
          }
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
      if (autoScaleTimer != null) clearTimeout(autoScaleTimer);
    };
  }, [connected, contract, timeframe, reconnectCount]);

  // -- Real-time quote subscription --
  useEffect(() => {
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

    // Volume tracking: cumulative quote volume → per-bar volume for FRVP range mode
    let prevCumulativeVolume: number | null = null;
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

      // Compute per-tick volume delta from cumulative quote volume
      const tickVol = prevCumulativeVolume !== null && data.volume > prevCumulativeVolume
        ? data.volume - prevCumulativeVolume
        : 0;
      prevCumulativeVolume = data.volume;

      if (lastBar.time === candleTime) {
        // Update existing bar
        pendingBarVolume += tickVol;
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
        pendingBarVolume = tickVol; // reset accumulator for the new bar
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

    // Accumulate live GatewayTrade ticks into the anchor-mode FRVP volume map
    function handleMarketTick(tickContractId: string, ticks: MarketTick[]) {
      if (tickContractId !== contractId) return;
      const ts = contract?.tickSize ?? 0.01;
      for (const tick of ticks) {
        const key = Math.round(Math.round(tick.price / ts) * ts * 1e10) / 1e10;
        tradeAnchorMapRef.current.set(key, (tradeAnchorMapRef.current.get(key) ?? 0) + tick.size);
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
