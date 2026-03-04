import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { buildNativeBracketParams } from '../../../types/bracket';
import { OrderType, OrderSide, OrderStatus } from '../../../types/enums';
import { orderService } from '../../../services/orderService';
import type { PlaceOrderParams } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { pointsToPrice, calcPnl } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import { PriceLevelLine } from '../PriceLevelLine';
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
    const overlay = refs.overlay.current;
    const el = refs.quickOrder.current;
    if (!chart || !series || !overlay || !el || !isOrderChart || !contract) {
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
    let qoPreviewLines: PriceLevelLine[] = [];
    let pendingFillUnsub: (() => void) | null = null;
    let qoComputedPrices: {
      entryPrice: number; slPrice: number | null;
      tpPrices: number[]; tpSizes: number[];
      side: 0 | 1; orderSize: number;
    } | null = null;
    let isDragging = false;
    let awaitingClick = false;
    let cancelAwaitHandler: ((e: MouseEvent) => void) | null = null;

    function removePreviewLines() {
      qoPreviewLines.forEach((l) => l.destroy());
      qoPreviewLines = [];
      refs.qoPreviewLines.current = { sl: null, tps: [] };
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
      const toPrice = (points: number) => pointsToPrice(points, contract!);
      const ep = snappedPrice;
      const side = isBuy ? OrderSide.Buy : OrderSide.Sell;

      // Entry reference line (no label)
      const entryLine = new PriceLevelLine({
        price: ep, series, overlay, chartApi: chart,
        lineColor: '#787b86', lineStyle: 'dashed', lineWidth: 1,
        axisLabelVisible: true, tickSize,
      });
      qoPreviewLines.push(entryLine);

      // SL line (with P&L label)
      let computedSlPrice: number | null = null;
      refs.qoPreviewLines.current = { sl: null, tps: [] };
      if (bc.stopLoss.points > 0) {
        computedSlPrice = side === OrderSide.Buy ? ep - toPrice(bc.stopLoss.points) : ep + toPrice(bc.stopLoss.points);
        const slDiff = side === OrderSide.Buy ? ep - computedSlPrice : computedSlPrice - ep;
        const slPnl = calcPnl(slDiff, contract!, st.orderSize);
        const slLine = new PriceLevelLine({
          price: computedSlPrice, series, overlay, chartApi: chart,
          lineColor: '#ff0000', lineStyle: 'dashed', lineWidth: 1,
          axisLabelVisible: true, tickSize,
          label: [
            { text: `-$${Math.abs(slPnl).toFixed(2)}`, bg: '#ff0000', color: '#000' },
            { text: String(st.orderSize), bg: '#ff0000', color: '#000' },
          ],
        });
        qoPreviewLines.push(slLine);
        refs.qoPreviewLines.current.sl = slLine;
      }

      // TP lines (with P&L labels)
      const computedTpPrices: number[] = [];
      const computedTpSizes: number[] = [];
      bc.takeProfits.forEach((tp) => {
        const tpPrice = side === OrderSide.Buy ? ep + toPrice(tp.points) : ep - toPrice(tp.points);
        computedTpPrices.push(tpPrice);
        computedTpSizes.push(tp.size);
        const tpDiff = side === OrderSide.Buy ? tpPrice - ep : ep - tpPrice;
        const tpPnl = calcPnl(tpDiff, contract!, tp.size);
        const tpLine = new PriceLevelLine({
          price: tpPrice, series, overlay, chartApi: chart,
          lineColor: '#00c805', lineStyle: 'dashed', lineWidth: 1,
          axisLabelVisible: true, tickSize,
          label: [
            { text: `+$${Math.abs(tpPnl).toFixed(2)}`, bg: '#00c805', color: '#000' },
            { text: String(tp.size), bg: '#00c805', color: '#000' },
          ],
        });
        qoPreviewLines.push(tpLine);
        refs.qoPreviewLines.current.tps.push(tpLine);
      });

      qoComputedPrices = {
        entryPrice: ep, slPrice: computedSlPrice,
        tpPrices: computedTpPrices, tpSizes: computedTpSizes,
        side, orderSize: st.orderSize,
      };
    }

    function updatePreviewPrices(ep: number) {
      if (qoPreviewLines.length === 0) return;
      const st = useStore.getState();
      const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      const bc = activePreset?.config;
      const toPrice = (points: number) => pointsToPrice(points, contract!);
      const side = isBuy ? OrderSide.Buy : OrderSide.Sell;

      // Entry line (index 0)
      qoPreviewLines[0].setPrice(ep);
      qoPreviewLines[0].syncPosition();

      let lineIdx = 1;
      if (bc) {
        if (bc.stopLoss.points > 0 && qoPreviewLines[lineIdx]) {
          const slPrice = side === OrderSide.Buy ? ep - toPrice(bc.stopLoss.points) : ep + toPrice(bc.stopLoss.points);
          qoPreviewLines[lineIdx].setPrice(slPrice);
          qoPreviewLines[lineIdx].syncPosition();
          const slDiff = side === OrderSide.Buy ? ep - slPrice : slPrice - ep;
          const slPnl = calcPnl(slDiff, contract!, st.orderSize);
          qoPreviewLines[lineIdx].updateSection(0, `-$${Math.abs(slPnl).toFixed(2)}`, '#ff0000');
          lineIdx++;
        }
        bc.takeProfits.forEach((tp) => {
          if (!qoPreviewLines[lineIdx]) return;
          const tpPrice = side === OrderSide.Buy ? ep + toPrice(tp.points) : ep - toPrice(tp.points);
          qoPreviewLines[lineIdx].setPrice(tpPrice);
          qoPreviewLines[lineIdx].syncPosition();
          const tpDiff = side === OrderSide.Buy ? tpPrice - ep : ep - tpPrice;
          const tpPnl = calcPnl(tpDiff, contract!, tp.size);
          qoPreviewLines[lineIdx].updateSection(0, `+$${Math.abs(tpPnl).toFixed(2)}`, '#00c805');
          lineIdx++;
        });
      }
    }

    function refreshLabel() {
      const sz = useStore.getState().orderSize;
      label.textContent = isBuy ? `Buy Limit ${sz}` : `Sell Limit ${sz}`;
      label.style.background = isBuy ? '#00c805' : '#ff0000';
      label.style.color = isBuy ? '#000' : '#fff';
    }

    const onMove = (param: { point?: { x: number; y: number }; time?: unknown }) => {
      if (isDragging || awaitingClick) return;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

      // Suppress the + button while the cursor is over an overlay label
      if (refs.labelHovered.current) {
        el.style.display = 'none';
        return;
      }

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
      if (!isHovered) {
        isBuy = lastP != null ? snappedPrice < lastP : true;
      }

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
      }
    };

    const onLeave = () => {
      if (isDragging || awaitingClick) return;
      isHovered = false;
      refs.qoHovered.current = false;
      label.style.display = 'none';
      plusEl.style.borderRadius = '2px';
      plusEl.style.background = '#2a2e39';
      chart.clearCrosshairPosition();
      if (!pendingFillUnsub) {
        removePreviewLines();
      }
      hideTimer = window.setTimeout(() => {
        if (!isHovered) el.style.display = 'none';
      }, 100);
    };

    function placeQuickOrder() {
      if (snappedPrice == null) return;
      const st = useStore.getState();
      if (!st.activeAccountId) return;

      const side = isBuy ? OrderSide.Buy : OrderSide.Sell;
      const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      let bracketsArmed = false;

      // Use gateway-native brackets for <= 1 TP (atomic placement).
      // Fall back to client-side bracket engine for 2+ TPs.
      let nativeBrackets: ReturnType<typeof buildNativeBracketParams> = null;

      if (activePreset) {
        const bc = activePreset.config;
        const bracketsActive = bc.stopLoss.points >= 1 || bc.takeProfits.length >= 1;
        if (bracketsActive) {
          nativeBrackets = buildNativeBracketParams(bc, side, contract!);

          if (!nativeBrackets) {
            // 2+ TPs — arm bracket engine
            bracketEngine.armForEntry({
              accountId: st.activeAccountId,
              contractId: contract!.id,
              entrySide: side,
              entrySize: st.orderSize,
              config: bc,
              contract: contract!,
            });
            bracketsArmed = true;
          }

          // Publish pending preview for overlay labels
          const toP = (points: number) => pointsToPrice(points, contract!);
          const ep = snappedPrice;
          st.setQoPendingPreview({
            entryPrice: ep,
            slPrice: bc.stopLoss.points > 0
              ? (side === OrderSide.Buy ? ep - toP(bc.stopLoss.points) : ep + toP(bc.stopLoss.points))
              : null,
            tpPrices: bc.takeProfits.map((tp) =>
              side === OrderSide.Buy ? ep + toP(tp.points) : ep - toP(tp.points),
            ),
            side,
            orderSize: st.orderSize,
            tpSizes: bc.takeProfits.map((tp) => tp.size),
          });
        }
      }

      // Remove hover labels (labels on preview lines)
      for (const line of qoPreviewLines) line.setLabel(null);
      if (!bracketsArmed && !nativeBrackets) removePreviewLines();

      // Set placeholder immediately so onLeave won't remove preview lines
      // before the async .then() replaces it with the real subscription
      if (bracketsArmed || nativeBrackets) pendingFillUnsub = () => {};

      orderService.placeOrder({
        accountId: st.activeAccountId,
        contractId: contract!.id,
        type: OrderType.Limit,
        side,
        size: st.orderSize,
        limitPrice: snappedPrice,
        ...nativeBrackets,
      }).then(({ orderId }) => {
        if (bracketsArmed) {
          bracketEngine.confirmEntryOrderId(orderId);
        }
        if (bracketsArmed || nativeBrackets) {
          // Keep preview lines until entry fills/cancels, then remove
          pendingFillUnsub = useStore.subscribe((state) => {
            const o = state.openOrders.find((ord) => ord.id === orderId);
            if (!o || o.status === OrderStatus.Filled || o.status === OrderStatus.Cancelled) {
              // Unsubscribe FIRST to prevent recursive re-entry from setQoPendingPreview
              pendingFillUnsub?.();
              pendingFillUnsub = null;
              removePreviewLines();
              useStore.getState().setQoPendingPreview(null);
            }
          });
        }
      }).catch((err) => {
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
      });
    }

    function cleanupAwait() {
      if (cancelAwaitHandler) {
        window.removeEventListener('mousedown', cancelAwaitHandler, true);
        cancelAwaitHandler = null;
      }
      awaitingClick = false;
    }

    function resetHoverState() {
      isHovered = false;
      refs.qoHovered.current = false;
      label.style.display = 'none';
      plusEl.style.borderRadius = '2px';
      plusEl.style.background = '#2a2e39';
      chart.clearCrosshairPosition();
    }

    const onMouseDown = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (snappedPrice == null) return;
      if (!useStore.getState().activeAccountId) return;

      const startY = e.clientY;
      let didDrag = false;
      const wasAwaiting = awaitingClick;
      if (wasAwaiting) cleanupAwait();
      isDragging = true;
      chart.applyOptions({ handleScroll: false, handleScale: false });

      const onDragMove = (me: MouseEvent) => {
        if (!didDrag && Math.abs(me.clientY - startY) > 3) didDrag = true;
        if (!didDrag) return;

        const container = refs.container.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const chartY = me.clientY - rect.top;
        const rawPrice = series.coordinateToPrice(chartY);
        if (rawPrice == null) return;

        snappedPrice = Math.round((rawPrice as number) / contract.tickSize) * contract.tickSize;

        // Reposition + button
        const y = series.priceToCoordinate(snappedPrice);
        if (y != null) el.style.top = `${y}px`;

        // Keep crosshair at dragged position
        const timeToUse = lastCrosshairTime ?? lastValidTime;
        if (timeToUse != null) {
          chart.setCrosshairPosition(snappedPrice, timeToUse as Parameters<typeof chart.setCrosshairPosition>[1], series);
        }

        // Update preview line positions and P&L
        updatePreviewPrices(snappedPrice);
      };

      const onDragEnd = () => {
        window.removeEventListener('mousemove', onDragMove);
        window.removeEventListener('mouseup', onDragEnd);
        isDragging = false;
        chart.applyOptions({ handleScroll: true, handleScale: true });

        if (didDrag) {
          // Drag completed (or re-drag while awaiting) — freeze and wait for a clean click
          awaitingClick = true;
          cancelAwaitHandler = (me: MouseEvent) => {
            // Click outside the + button → cancel
            if (wrap.contains(me.target as Node)) return;
            cleanupAwait();
            resetHoverState();
            removePreviewLines();
            el.style.display = 'none';
          };
          window.addEventListener('mousedown', cancelAwaitHandler, true);
        } else if (wasAwaiting) {
          // Clean click while awaiting → place order
          placeQuickOrder();
          resetHoverState();
        } else {
          // First-time simple click (no prior drag) → place immediately
          placeQuickOrder();
          resetHoverState();
        }
      };

      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onDragEnd);
    };

    wrap.addEventListener('mouseenter', onEnter);
    wrap.addEventListener('mouseleave', onLeave);
    wrap.addEventListener('mousedown', onMouseDown);
    chart.subscribeCrosshairMove(onMove);

    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      cleanupAwait();
      refs.qoHovered.current = false;
      if (pendingFillUnsub) {
        pendingFillUnsub(); pendingFillUnsub = null;
        useStore.getState().setQoPendingPreview(null);
      }
      removePreviewLines();
      chart.unsubscribeCrosshairMove(onMove);
      wrap.removeEventListener('mouseenter', onEnter);
      wrap.removeEventListener('mouseleave', onLeave);
      wrap.removeEventListener('mousedown', onMouseDown);
      el.style.display = 'none';
    };
  }, [contract, timeframe, isOrderChart]);
}
