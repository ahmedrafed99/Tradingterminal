import { useEffect, useState } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { getCandlePeriodSeconds } from '../barUtils';
import { matchTrades } from '../TradeZonePrimitive';
import type { ChartRefs } from './types';
import { COLOR_TEXT_MUTED, COLOR_TEXT_MEDIUM } from '../../../constants/colors';

/**
 * Handles trade zones, OHLC tooltip, crosshair price label, and scroll-to-latest button.
 */
export function useChartWidgets(
  refs: ChartRefs,
  contract: Contract | null,
  timeframe: Timeframe,
): { showScrollBtn: boolean; scrollBtnPos: { right: number; bottom: number } } {

  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [scrollBtnPos, setScrollBtnPos] = useState({ right: 80, bottom: 40 });

  // -- Trade zones (entry/exit rectangles from "show on chart" clicks) --
  useEffect(() => {
    const primitive = refs.tradeZonePrimitive.current;
    if (!primitive) return;
    const contractId = contract?.id;
    const periodSec = getCandlePeriodSeconds(timeframe);
    const decimals = contract
      ? (contract.tickSize.toString().split('.')[1]?.length ?? 0)
      : 2;

    primitive.setPeriod(periodSec);
    primitive.setDecimals(decimals);
    primitive.setExtendRight(useStore.getState().chartSettings.extendTradeZoneRight);

    function rebuild() {
      if (!primitive || !contractId) {
        primitive?.setData([]);
        return;
      }
      const { visibleTradeIds, sessionTrades, displayTrades } = useStore.getState();
      if (visibleTradeIds.length === 0) {
        primitive.setData([]);
        return;
      }
      // Merge session + display trades (deduplicate by id) so clicks from
      // the Trades tab work regardless of which date preset is active.
      const merged = new Map<number, typeof sessionTrades[0]>();
      for (const t of sessionTrades) merged.set(t.id, t);
      for (const t of displayTrades) merged.set(t.id, t);
      const zones = matchTrades([...merged.values()], visibleTradeIds, String(contractId));
      primitive.setData(zones);
    }

    rebuild();
    const unsub = useStore.subscribe((s, prev) => {
      if (
        s.visibleTradeIds !== prev.visibleTradeIds ||
        s.sessionTrades !== prev.sessionTrades ||
        s.displayTrades !== prev.displayTrades
      ) {
        rebuild();
      }
      if (s.chartSettings.extendTradeZoneRight !== prev.chartSettings.extendTradeZoneRight) {
        primitive.setExtendRight(s.chartSettings.extendTradeZoneRight);
      }
    });
    return () => {
      unsub();
      primitive.setData([]);
    };
  }, [contract, timeframe]);

  // -- OHLC tooltip (crosshair hover → show candle values, default to last bar) --
  useEffect(() => {
    const chart = refs.chart.current;
    const series = refs.series.current;
    const el = refs.ohlc.current;
    if (!chart || !series || !el) return;

    const decimals = contract ? (contract.tickSize.toString().split('.')[1]?.length ?? 0) : 2;
    const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const fmt = (v: number) => nf.format(v);

    // Pre-create spans once instead of rebuilding DOM via innerHTML every frame
    const makeLabel = (text: string) => { const s = document.createElement('span'); s.style.color = COLOR_TEXT_MUTED; s.textContent = text; return s; };
    const makeVal = () => { const s = document.createElement('span'); return s; };
    const oSpan = makeVal(); const hSpan = makeVal(); const lSpan = makeVal(); const cSpan = makeVal(); const chgSpan = makeVal();
    el.textContent = '';
    el.append(makeLabel('O'), oSpan, document.createTextNode(' '), makeLabel('H'), hSpan, document.createTextNode(' '), makeLabel('L'), lSpan, document.createTextNode(' '), makeLabel('C'), cSpan, document.createTextNode(' '), chgSpan);

    let prevColor = '';
    let prevO = 0, prevH = 0, prevL = 0, prevC = 0;
    function render(o: number, h: number, l: number, c: number) {
      // Skip when hovering the same candle with unchanged values
      if (o === prevO && h === prevH && l === prevL && c === prevC) return;
      prevO = o; prevH = h; prevL = l; prevC = c;
      const bullish = c >= o;
      const valColor = bullish ? COLOR_TEXT_MEDIUM : '#0097a6';
      const change = c - o;
      const sign = change >= 0 ? '+' : '';
      oSpan.textContent = fmt(o);
      hSpan.textContent = fmt(h);
      lSpan.textContent = fmt(l);
      cSpan.textContent = fmt(c);
      chgSpan.textContent = `${sign}${fmt(change)}`;
      // Only touch .style.color when direction changes (avoids style recalc)
      if (valColor !== prevColor) {
        prevColor = valColor;
        oSpan.style.color = valColor;
        hSpan.style.color = valColor;
        lSpan.style.color = valColor;
        cSpan.style.color = valColor;
        chgSpan.style.color = valColor;
      }
    }

    // Show last bar initially
    const last = refs.lastBar.current;
    if (last) render(last.open, last.high, last.low, last.close);

    const onMove = (param: { time?: unknown; seriesData?: Map<unknown, unknown> }) => {
      if (param.time && param.seriesData) {
        const d = param.seriesData.get(series) as { open: number; high: number; low: number; close: number } | undefined;
        if (d) { render(d.open, d.high, d.low, d.close); return; }
      }
      // Fallback to last bar
      const lb = refs.lastBar.current;
      if (lb) render(lb.open, lb.high, lb.low, lb.close);
    };

    chart.subscribeCrosshairMove(onMove);
    return () => { chart.unsubscribeCrosshairMove(onMove); };
  }, [contract, timeframe]);

  // -- Feed crosshair price to CrosshairLabelPrimitive (always-on-top label) --
  useEffect(() => {
    const chart = refs.chart.current;
    const series = refs.series.current;
    const cl = refs.crosshairLabel.current;
    if (!chart || !series || !cl) return;

    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    const onMove = (param: { point?: { x: number; y: number } }) => {
      if (!param.point) {
        // Delay the clear by one frame so that if the mouse is transitioning
        // to the quick-order button overlay, onEnter has time to set the flag.
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(() => {
          if (!refs.qoHovered.current) cl.updateCrosshairPrice(null);
        }, 16);
        return;
      }
      if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
      const price = series.coordinateToPrice(param.point.y);
      cl.updateCrosshairPrice(price as number | null);
    };

    chart.subscribeCrosshairMove(onMove);
    return () => {
      if (clearTimer) clearTimeout(clearTimer);
      chart.unsubscribeCrosshairMove(onMove);
    };
  }, []);

  // -- Show/hide "scroll to latest" button when user scrolls away from latest candle --
  useEffect(() => {
    const chart = refs.chart.current;
    if (!chart) return;

    const handler = () => {
      const visibleRange = chart.timeScale().getVisibleRange();
      const lastTime = refs.lastBar.current?.time;
      if (!visibleRange || !lastTime) {
        if (refs.scrollBtnShown.current) {
          refs.scrollBtnShown.current = false;
          setShowScrollBtn(false);
        }
        return;
      }
      const shouldShow = (lastTime as number) > (visibleRange.to as number);
      if (shouldShow !== refs.scrollBtnShown.current) {
        refs.scrollBtnShown.current = shouldShow;
        setShowScrollBtn(shouldShow);
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
    };
  }, []);

  // -- Position scroll-to-latest button equidistant from price scale left border
  //    and time scale top border (sits just inside the candle area corner) --
  useEffect(() => {
    const chart = refs.chart.current;
    const container = refs.container.current;
    if (!chart || !container) return;

    const TS_HEIGHT = 26; // LWC time scale height at fontSize 12
    const GAP = 30;       // equal distance from both border lines to button edge

    const recompute = () => {
      // Guard: chart may have been disposed if this fires after unmount cleanup
      if (!refs.chart.current) return;
      const tsW = chart.timeScale().width();
      if (tsW <= 0) return;
      const P = container.clientWidth - tsW; // price scale width
      const r = P + GAP;
      const b = TS_HEIGHT + GAP;
      setScrollBtnPos(prev =>
        prev.right === r && prev.bottom === b ? prev : { right: r, bottom: b },
      );
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    chart.timeScale().subscribeVisibleLogicalRangeChange(recompute);

    return () => {
      ro.disconnect();
      // Chart may already be disposed (init effect cleanup runs before this one)
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(recompute); } catch { /* disposed */ }
    };
  }, []);

  return { showScrollBtn, scrollBtnPos };
}
