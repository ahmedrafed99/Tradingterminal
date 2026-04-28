import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { OrderType, OrderSide } from '../../../types/enums';
import { placeOrderWithBrackets } from '../../../services/placeOrderWithBrackets';
import { pointsToPrice, calcPnl } from '../../../utils/instrument';
import { snapToTickSize } from '../barUtils';
import { fitTpsToOrderSize } from './resolvePreviewConfig';
import { showToast, errorMessage } from '../../../utils/toast';
import { getSchedule } from '../../../utils/marketHours';
import { PriceLevelPrimitive } from '../primitives/PriceLevelPrimitive';
import { QuickOrderPrimitive } from '../primitives/QuickOrderPrimitive';
import type { ChartRefs } from './types';
import { COLOR_TEXT_MUTED } from '../../../constants/colors';
import { BUY_COLOR, SELL_COLOR, LABEL_TEXT } from './labelUtils';

export function useQuickOrder(
  refs: ChartRefs,
  contract: Contract | null,
  timeframe: Timeframe,
  isOrderChart: boolean,
): void {
  useEffect(() => {
    const chart = refs.chart.current;
    const series = refs.series.current;
    const container = refs.container.current;
    if (!chart || !series || !container || !isOrderChart || !contract) return;

    const primitive = new QuickOrderPrimitive();
    series.attachPrimitive(primitive);
    primitive.setChartElement(container);

    // Set initial order size
    const initSt = useStore.getState();
    primitive.setOrderSize(initSt.orderSize, getPresetMaxSize());

    let snappedPrice: number | null = null;
    let lastCrosshairTime: unknown = null;
    let lastValidTime: unknown = null;
    let isBuy = true;
    let hoverPreviewLines: PriceLevelPrimitive[] = [];
    let awaitingClick = false;
    let cancelAwaitHandler: ((e: MouseEvent) => void) | null = null;

    function getPresetMaxSize(): number | null {
      const st = useStore.getState();
      const preset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      if (!preset) return null;
      return preset.config.takeProfits.reduce((sum, tp) => sum + tp.size, 0);
    }

    function removePreviewLines() {
      hoverPreviewLines.forEach((l) => series!.detachPrimitive(l));
      hoverPreviewLines = [];
    }

    function createPreviewLines() {
      removePreviewLines();
      if (snappedPrice == null) return;
      const st = useStore.getState();
      const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      if (!activePreset) return;
      const bc = activePreset.config;
      const tickSize = contract!.tickSize;
      const toPrice = (points: number) => pointsToPrice(points, contract!);
      const ep = snappedPrice;
      const side = isBuy ? OrderSide.Buy : OrderSide.Sell;

      const entryLine = new PriceLevelPrimitive({
        price: ep,
        lineColor: COLOR_TEXT_MUTED, lineStyle: 'dashed', lineWidth: 1,
        priceLabel: { visible: false },
        cellOrder: [], cells: {},
      });
      series!.attachPrimitive(entryLine);
      hoverPreviewLines.push(entryLine);

      if (bc.stopLoss.points > 0) {
        const slPrice = side === OrderSide.Buy ? ep - toPrice(bc.stopLoss.points) : ep + toPrice(bc.stopLoss.points);
        const slDiff = side === OrderSide.Buy ? ep - slPrice : slPrice - ep;
        const slPnl = calcPnl(slDiff, contract!, st.orderSize);
        const slLine = new PriceLevelPrimitive({
          price: slPrice,
          lineColor: SELL_COLOR, lineStyle: 'dashed', lineWidth: 1,
          priceLabel: { visible: true, tickSize },
          cellOrder: ['pnl', 'size'],
          cells: {
            pnl:  { text: `-$${Math.abs(slPnl).toFixed(2)}`, bg: SELL_COLOR, color: LABEL_TEXT },
            size: { text: String(st.orderSize), bg: SELL_COLOR, color: LABEL_TEXT },
          },
        });
        series!.attachPrimitive(slLine);
        hoverPreviewLines.push(slLine);
      }

      const fittedTps = fitTpsToOrderSize(bc.takeProfits, st.orderSize);
      fittedTps.forEach((tp) => {
        const tpPrice = side === OrderSide.Buy ? ep + toPrice(tp.points) : ep - toPrice(tp.points);
        const tpDiff = side === OrderSide.Buy ? tpPrice - ep : ep - tpPrice;
        const tpPnl = calcPnl(tpDiff, contract!, tp.size);
        const tpLine = new PriceLevelPrimitive({
          price: tpPrice,
          lineColor: BUY_COLOR, lineStyle: 'dashed', lineWidth: 1,
          priceLabel: { visible: true, tickSize },
          cellOrder: ['pnl', 'size'],
          cells: {
            pnl:  { text: `+$${Math.abs(tpPnl).toFixed(2)}`, bg: BUY_COLOR, color: LABEL_TEXT },
            size: { text: String(tp.size), bg: BUY_COLOR, color: LABEL_TEXT },
          },
        });
        series!.attachPrimitive(tpLine);
        hoverPreviewLines.push(tpLine);
      });
    }

    function updatePreviewPrices(ep: number) {
      if (hoverPreviewLines.length === 0) return;
      const st = useStore.getState();
      const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      const bc = activePreset?.config;
      const toPrice = (points: number) => pointsToPrice(points, contract!);
      const side = isBuy ? OrderSide.Buy : OrderSide.Sell;

      hoverPreviewLines[0].setPrice(ep);

      let lineIdx = 1;
      if (bc) {
        if (bc.stopLoss.points > 0 && hoverPreviewLines[lineIdx]) {
          const slPrice = side === OrderSide.Buy ? ep - toPrice(bc.stopLoss.points) : ep + toPrice(bc.stopLoss.points);
          hoverPreviewLines[lineIdx].setPrice(slPrice);
          const slDiff = side === OrderSide.Buy ? ep - slPrice : slPrice - ep;
          const slPnl = calcPnl(slDiff, contract!, st.orderSize);
          hoverPreviewLines[lineIdx].setCell('pnl', { text: `-$${Math.abs(slPnl).toFixed(2)}` });
          lineIdx++;
        }
        const fittedTps = fitTpsToOrderSize(bc.takeProfits, st.orderSize);
        fittedTps.forEach((tp) => {
          if (!hoverPreviewLines[lineIdx]) return;
          const tpPrice = side === OrderSide.Buy ? ep + toPrice(tp.points) : ep - toPrice(tp.points);
          hoverPreviewLines[lineIdx].setPrice(tpPrice);
          const tpDiff = side === OrderSide.Buy ? tpPrice - ep : ep - tpPrice;
          const tpPnl = calcPnl(tpDiff, contract!, tp.size);
          hoverPreviewLines[lineIdx].setCell('pnl', { text: `+$${Math.abs(tpPnl).toFixed(2)}` });
          lineIdx++;
        });
      }
    }

    function cleanupAwait() {
      if (cancelAwaitHandler) {
        window.removeEventListener('mousedown', cancelAwaitHandler, true);
        cancelAwaitHandler = null;
      }
      awaitingClick = false;
      primitive.setLocked(false);
    }

    function placeQuickOrder() {
      if (snappedPrice == null) return;
      if (!getSchedule(contract?.marketType).isOpen()) {
        showToast('warning', 'Market closed', 'Market is closed. Orders cannot be placed.');
        removePreviewLines();
        return;
      }
      const st = useStore.getState();
      if (!st.activeAccountId) return;

      const side = isBuy ? OrderSide.Buy : OrderSide.Sell;
      const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);

      removePreviewLines();

      placeOrderWithBrackets({
        accountId: st.activeAccountId,
        contractId: contract!.id,
        contract: contract!,
        side,
        size: st.orderSize,
        orderType: OrderType.Limit,
        limitPrice: snappedPrice,
        bracketConfig: activePreset?.config ?? null,
      }).catch((err) => {
        showToast('error', 'Quick order failed', errorMessage(err));
      });
    }

    // ── Primitive callbacks ───────────────────────────────────────────────────

    primitive.onExpandChange = (expanded) => {
      refs.qoHovered.current = expanded;
      if (expanded) {
        createPreviewLines();
        const timeToUse = lastCrosshairTime ?? lastValidTime;
        if (snappedPrice != null && timeToUse != null) {
          chart.setCrosshairPosition(snappedPrice, timeToUse as Parameters<typeof chart.setCrosshairPosition>[1], series!);
        }
      } else {
        if (!awaitingClick) {
          removePreviewLines();
          chart.clearCrosshairPosition();
        }
      }
    };

    primitive.onDragUpdate = (price) => {
      snappedPrice = snapToTickSize(price, contract!.tickSize);
      primitive.setCrosshair(snappedPrice, isBuy);
      updatePreviewPrices(snappedPrice);
      const timeToUse = lastCrosshairTime ?? lastValidTime;
      if (timeToUse != null) {
        chart.setCrosshairPosition(snappedPrice, timeToUse as Parameters<typeof chart.setCrosshairPosition>[1], series!);
        refs.crosshairLabel.current?.updateCrosshairPrice(snappedPrice);
        refs.peerSync.current?.(snappedPrice, timeToUse);
      }
    };

    primitive.onDragEnd = (price, didDrag) => {
      snappedPrice = snapToTickSize(price, contract!.tickSize);
      cleanupAwait();
      if (!didDrag) {
        // Simple click (or re-click while awaiting) → place order
        placeQuickOrder();
        primitive.setCrosshair(null, isBuy);
        primitive.setExpanded(false);
        refs.qoHovered.current = false;
      } else {
        // Drag completed — freeze at dragged price, await a confirming click
        primitive.setLocked(true);
        awaitingClick = true;
        cancelAwaitHandler = (me: MouseEvent) => {
          if (primitive.containsPoint(me.clientX, me.clientY)) return;
          cleanupAwait();
          removePreviewLines();
          primitive.setExpanded(false);
          refs.qoHovered.current = false;
          chart.clearCrosshairPosition();
          primitive.setCrosshair(null, isBuy);
        };
        window.addEventListener('mousedown', cancelAwaitHandler, true);
      }
    };

    primitive.onSizeChange = (delta) => {
      const st = useStore.getState();
      const newSize = st.orderSize + delta;
      if (delta === -1 && newSize < 1) return;
      const max = getPresetMaxSize();
      if (delta === 1 && max != null && newSize > max) return;
      st.setOrderSize(newSize);
      primitive.setOrderSize(newSize, max);
      if (max != null) {
        removePreviewLines();
        createPreviewLines();
      }
    };

    // ── crosshairMove ─────────────────────────────────────────────────────────

    const onMove = (param: { point?: { x: number; y: number }; time?: unknown }) => {
      if (primitive.isDragging || awaitingClick) return;

      // Suppress while a label or peer chart is being hovered
      if (refs.labelHovered.current || refs.peerHovered.current) {
        primitive.setCrosshair(null, isBuy);
        return;
      }

      if (!param.point) {
        primitive.setCrosshair(null, isBuy);
        return;
      }

      const rawPrice = series!.coordinateToPrice(param.point.y);
      if (rawPrice === null) {
        primitive.setCrosshair(null, isBuy);
        return;
      }

      const lastP = useStore.getState().lastPrice ?? refs.lastBar.current?.close ?? null;
      snappedPrice = snapToTickSize(rawPrice as number, contract!.tickSize);
      lastCrosshairTime = param.time ?? null;
      if (param.time) lastValidTime = param.time;

      // Only update side when not expanded (don't flip colors mid-hover)
      if (!primitive.isExpanded) {
        isBuy = lastP != null ? snappedPrice < lastP : true;
      }

      primitive.setCrosshair(snappedPrice, isBuy);
      // Sync order size in case store changed since last expand
      if (primitive.isExpanded) {
        const st = useStore.getState();
        primitive.setOrderSize(st.orderSize, getPresetMaxSize());
      }
    };

    chart.subscribeCrosshairMove(onMove);

    return () => {
      cleanupAwait();
      removePreviewLines();
      chart.unsubscribeCrosshairMove(onMove);
      series.detachPrimitive(primitive);
      refs.qoHovered.current = false;
    };
  }, [contract, timeframe, isOrderChart]);
}
