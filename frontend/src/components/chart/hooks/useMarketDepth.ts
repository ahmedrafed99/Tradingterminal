import { useEffect, useRef } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { realtimeService, type DepthEntry } from '../../../services/realtimeService';
import { DepthType } from '../../../types/enums';
import type { ChartRefs } from './types';
import type { BacktestConfig } from '../CandlestickChart';

export function useMarketDepth(
  refs: ChartRefs,
  contract: Contract | null,
  backtestConfig: BacktestConfig | undefined,
  connected: boolean,
  chartId: 'left' | 'right' | 'backtest',
): void {
  // Tracks which contract the depth primitive currently holds data for.
  // Used to distinguish a contract switch (must clear) from a reconnect (keep stale data).
  const domContractIdRef = useRef<string | null>(null);

  const domEnabled = useStore((s) => chartId === 'left' ? s.domEnabled : chartId === 'right' ? s.secondDomEnabled : false);
  const domColor = useStore((s) => chartId === 'left' ? s.domColor : chartId === 'right' ? s.secondDomColor : '#2196f3');
  const domHoverExpand = useStore((s) => chartId === 'left' ? s.domHoverExpand : chartId === 'right' ? s.secondDomHoverExpand : false);
  const domRowLayout = useStore((s) => chartId === 'left' ? s.domRowLayout : chartId === 'right' ? s.secondDomRowLayout : 'price');
  const domRowSize = useStore((s) => chartId === 'left' ? s.domRowSize : chartId === 'right' ? s.secondDomRowSize : 1);
  const domBarPlacement = useStore((s) => chartId === 'left' ? s.domBarPlacement : chartId === 'right' ? s.secondDomBarPlacement : 'left');
  const domBarOffset = useStore((s) => chartId === 'left' ? s.domBarOffset : chartId === 'right' ? s.secondDomBarOffset : 0);
  const domBarLength = useStore((s) => chartId === 'left' ? s.domBarLength : chartId === 'right' ? s.secondDomBarLength : 30);
  const bidAskEnabled = useStore((s) => chartId === 'left' ? s.bidAskEnabled : chartId === 'right' ? s.secondBidAskEnabled : false);

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
}
