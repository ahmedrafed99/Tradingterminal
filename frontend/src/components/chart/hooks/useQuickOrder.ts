import { useEffect } from 'react';
import { LineStyle } from 'lightweight-charts';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { TICKS_PER_POINT } from '../../../types/bracket';
import type { BracketConfig } from '../../../types/bracket';
import { orderService } from '../../../services/orderService';
import type { PlaceOrderParams } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { showToast, errorMessage } from '../../../utils/toast';
import type { ChartRefs } from './types';

export function useQuickOrder(
  refs: ChartRefs,
  contract: Contract | null,
  timeframe: Timeframe,
  isOrderChart: boolean,
): void {
  useEffect(() => {
    const chart = refs.chart.current;
    const series = refs.series.current;
    const el = refs.quickOrder.current;
    if (!chart || !series || !el || !isOrderChart || !contract) {
      if (el) el.style.display = 'none';
      return;
    }

    const wrap = el.querySelector('[data-qo-wrap]') as HTMLDivElement;
    const label = el.querySelector('[data-qo-label]') as HTMLDivElement;
    const plusEl = el.querySelector('[data-qo-plus]') as HTMLDivElement;
    if (!wrap || !label || !plusEl) return;

    let snappedPrice: number | null = null;
    let lastCrosshairTime: unknown = null;
    let lastValidTime: unknown = null; // fallback — always stores the most recent non-null time
    let isBuy = true;
    let isHovered = false;
    let hideTimer: number | null = null;
    let qoPreviewLines: ReturnType<typeof series.createPriceLine>[] = [];
    let pendingFillUnsub: (() => void) | null = null;
    let qoHoverLabels: HTMLDivElement[] = [];
    let qoComputedPrices: {
      entryPrice: number; slPrice: number | null;
      tpPrices: number[]; tpSizes: number[];
      side: 0 | 1; orderSize: number;
    } | null = null;

    function removePreviewLines() {
      qoPreviewLines.forEach((l) => series!.removePriceLine(l));
      qoPreviewLines = [];
      refs.qoPreviewLines.current = { sl: null, tps: [] };
    }

    function removeHoverLabels() {
      qoHoverLabels.forEach((r) => r.remove());
      qoHoverLabels = [];
    }

    function createPreviewLines() {
      removePreviewLines();
      qoComputedPrices = null;
      if (snappedPrice == null) return;
      const st = useStore.getState();
      const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      if (!activePreset) return;
      const bc = activePreset.config;
      const tickSize = contract!.tickSize;
      const toPrice = (points: number) => points * tickSize * TICKS_PER_POINT;
      const ep = snappedPrice;
      const side = isBuy ? 0 : 1;

      // Entry reference line
      qoPreviewLines.push(series!.createPriceLine({
        price: ep, color: '#787b86', lineWidth: 1,
        lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
      }));

      // SL line
      let computedSlPrice: number | null = null;
      refs.qoPreviewLines.current = { sl: null, tps: [] };
      if (bc.stopLoss.points > 0) {
        computedSlPrice = side === 0 ? ep - toPrice(bc.stopLoss.points) : ep + toPrice(bc.stopLoss.points);
        const slLine = series!.createPriceLine({
          price: computedSlPrice, color: '#ff444480', lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
        });
        qoPreviewLines.push(slLine);
        refs.qoPreviewLines.current.sl = slLine;
      }

      // TP lines
      const computedTpPrices: number[] = [];
      const computedTpSizes: number[] = [];
      bc.takeProfits.forEach((tp) => {
        const tpPrice = side === 0 ? ep + toPrice(tp.points) : ep - toPrice(tp.points);
        computedTpPrices.push(tpPrice);
        computedTpSizes.push(tp.size);
        const tpLine = series!.createPriceLine({
          price: tpPrice, color: '#00c805', lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
        });
        qoPreviewLines.push(tpLine);
        refs.qoPreviewLines.current.tps.push(tpLine);
      });

      qoComputedPrices = {
        entryPrice: ep, slPrice: computedSlPrice,
        tpPrices: computedTpPrices, tpSizes: computedTpSizes,
        side: side as 0 | 1, orderSize: st.orderSize,
      };
    }

    function createHoverLabels() {
      removeHoverLabels();
      if (!qoComputedPrices) return;
      const overlay = refs.overlay.current;
      if (!overlay) return;

      const qo = qoComputedPrices;
      const tk = contract!.tickSize;
      const tv = contract!.tickValue || 0.50;

      function makeRow(pnlText: string, pnlBg: string, sizeText: string, sizeBg: string, price: number) {
        const row = document.createElement('div');
        row.style.cssText = 'position:absolute;left:50%;display:flex;height:20px;font-size:11px;font-weight:bold;font-family:-apple-system,BlinkMacSystemFont,Trebuchet MS,Roboto,Ubuntu,sans-serif;line-height:20px;transform:translate(-50%,-50%);white-space:nowrap;border-radius:3px;overflow:hidden;';
        const c1 = document.createElement('div');
        c1.style.cssText = `background:${pnlBg};color:#000;padding:0 6px;`;
        c1.textContent = pnlText;
        row.appendChild(c1);
        const c2 = document.createElement('div');
        c2.style.cssText = `background:${sizeBg};color:#000;padding:0 6px;border-left:1px solid #000;`;
        c2.textContent = sizeText;
        row.appendChild(c2);
        const y = series!.priceToCoordinate(price);
        if (y !== null) row.style.top = `${y}px`;
        overlay!.appendChild(row);
        qoHoverLabels.push(row);
      }

      // SL label
      if (qo.slPrice != null) {
        const slDiff = qo.side === 0 ? qo.entryPrice - qo.slPrice : qo.slPrice - qo.entryPrice;
        const slPnl = (slDiff / tk) * tv * qo.orderSize;
        makeRow(`-$${Math.abs(slPnl).toFixed(2)}`, '#ff0000', String(qo.orderSize), '#ff0000', qo.slPrice);
      }

      // TP labels
      for (let i = 0; i < qo.tpPrices.length; i++) {
        const tpPrice = qo.tpPrices[i];
        const tpSize = qo.tpSizes[i] ?? qo.orderSize;
        const tpDiff = qo.side === 0 ? tpPrice - qo.entryPrice : qo.entryPrice - tpPrice;
        const tpPnl = (tpDiff / tk) * tv * tpSize;
        makeRow(`+$${Math.abs(tpPnl).toFixed(2)}`, '#00c805', String(tpSize), '#00c805', tpPrice);
      }
    }

    function refreshLabel() {
      const sz = useStore.getState().orderSize;
      label.textContent = isBuy ? `Buy Limit ${sz}` : `Sell Limit ${sz}`;
      label.style.background = isBuy ? '#00c805' : '#ff0000';
      label.style.color = isBuy ? '#000' : '#fff';
    }

    const onMove = (param: { point?: { x: number; y: number }; time?: unknown }) => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

      if (!param.point) {
        hideTimer = window.setTimeout(() => {
          if (!isHovered) el.style.display = 'none';
        }, 50);
        return;
      }

      const rawPrice = series.coordinateToPrice(param.point.y);
      if (rawPrice === null) {
        if (!isHovered) el.style.display = 'none';
        return;
      }

      const lastP = useStore.getState().lastPrice ?? refs.lastBar.current?.close ?? null;
      snappedPrice = Math.round((rawPrice as number) / contract.tickSize) * contract.tickSize;
      lastCrosshairTime = param.time ?? null;
      if (param.time) lastValidTime = param.time;
      isBuy = lastP != null ? snappedPrice < lastP : true;

      let psWidth = 56;
      try { psWidth = chart.priceScale('right').width(); } catch (_) { psWidth = 56; }

      el.style.display = 'flex';
      el.style.top = `${param.point.y}px`;
      el.style.right = `${psWidth}px`;

      if (isHovered) refreshLabel();
    };

    const onEnter = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      isHovered = true;
      refs.qoHovered.current = true;
      label.style.display = 'block';
      plusEl.style.borderRadius = '0 2px 2px 0';
      plusEl.style.background = '#434651';
      refreshLabel();
      // Keep crosshair visible while hovering the + button
      const timeToUse = lastCrosshairTime ?? lastValidTime;
      if (snappedPrice != null && timeToUse != null) {
        chart.setCrosshairPosition(snappedPrice, timeToUse as Parameters<typeof chart.setCrosshairPosition>[1], series);
      }
      if (!pendingFillUnsub) {
        createPreviewLines();
        createHoverLabels();
      }
    };

    const onLeave = () => {
      isHovered = false;
      refs.qoHovered.current = false;
      label.style.display = 'none';
      plusEl.style.borderRadius = '2px';
      plusEl.style.background = '#2a2e39';
      chart.clearCrosshairPosition();
      if (!pendingFillUnsub) {
        removePreviewLines();
        removeHoverLabels();
      }
      hideTimer = window.setTimeout(() => {
        if (!isHovered) el.style.display = 'none';
      }, 100);
    };

    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (snappedPrice == null) return;
      const st = useStore.getState();
      if (!st.activeAccountId) return;

      const side: 0 | 1 = isBuy ? 0 : 1;
      const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      let bracketsArmed = false;

      if (activePreset) {
        const bc = activePreset.config;
        const bracketsActive = bc.stopLoss.points >= 1 || bc.takeProfits.length >= 1;
        if (bracketsActive) {
          bracketEngine.armForEntry({
            accountId: st.activeAccountId,
            contractId: contract!.id,
            entrySide: side,
            entrySize: st.orderSize,
            config: bc,
            tickSize: contract!.tickSize || 0.25,
          });
          bracketsArmed = true;

          // Publish pending preview for overlay labels
          const tickSize = contract!.tickSize;
          const toP = (points: number) => points * tickSize * TICKS_PER_POINT;
          const ep = snappedPrice;
          st.setQoPendingPreview({
            entryPrice: ep,
            slPrice: bc.stopLoss.points > 0
              ? (side === 0 ? ep - toP(bc.stopLoss.points) : ep + toP(bc.stopLoss.points))
              : null,
            tpPrices: bc.takeProfits.map((tp) =>
              side === 0 ? ep + toP(tp.points) : ep - toP(tp.points),
            ),
            side,
            orderSize: st.orderSize,
            tpSizes: bc.takeProfits.map((tp) => tp.size),
          });
        }
      }

      removeHoverLabels();
      if (!bracketsArmed) removePreviewLines();

      // Set placeholder immediately so onLeave won't remove preview lines
      // before the async .then() replaces it with the real subscription
      if (bracketsArmed) pendingFillUnsub = () => {};

      orderService.placeOrder({
        accountId: st.activeAccountId,
        contractId: contract!.id,
        type: 1,
        side,
        size: st.orderSize,
        limitPrice: snappedPrice,
      }).then(({ orderId }) => {
        if (bracketsArmed) {
          bracketEngine.confirmEntryOrderId(orderId);
          // Keep preview lines until entry fills/cancels, then remove
          pendingFillUnsub = useStore.subscribe((state) => {
            const o = state.openOrders.find((ord) => ord.id === orderId);
            if (!o || o.status === 2 || o.status === 3) {
              // Unsubscribe FIRST to prevent recursive re-entry from setQoPendingPreview
              pendingFillUnsub?.();
              pendingFillUnsub = null;
              removePreviewLines();
              useStore.getState().setQoPendingPreview(null);
            }
          });
        }
      }).catch((err) => {
        console.error('[Chart] Quick order failed:', err);
        showToast('error', 'Quick order failed', errorMessage(err));
        // Cleanup: remove stale preview state
        if (pendingFillUnsub) {
          pendingFillUnsub();
          pendingFillUnsub = null;
        }
        if (bracketsArmed) {
          bracketEngine.clearSession();
        }
        useStore.getState().setQoPendingPreview(null);
        removePreviewLines();
        removeHoverLabels();
      });
    };

    wrap.addEventListener('mouseenter', onEnter);
    wrap.addEventListener('mouseleave', onLeave);
    wrap.addEventListener('click', onClick);
    chart.subscribeCrosshairMove(onMove);

    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      refs.qoHovered.current = false;
      if (pendingFillUnsub) {
        pendingFillUnsub(); pendingFillUnsub = null;
        useStore.getState().setQoPendingPreview(null);
      }
      removePreviewLines();
      removeHoverLabels();
      chart.unsubscribeCrosshairMove(onMove);
      wrap.removeEventListener('mouseenter', onEnter);
      wrap.removeEventListener('mouseleave', onLeave);
      wrap.removeEventListener('click', onClick);
      el.style.display = 'none';
    };
  }, [contract, timeframe, isOrderChart]);
}
