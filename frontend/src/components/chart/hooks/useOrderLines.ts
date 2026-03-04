import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { orderService, type Order, type PlaceOrderParams } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { useStore } from '../../../store/useStore';
import { OrderType, OrderSide, PositionType } from '../../../types/enums';
import { pointsToPrice, priceToPoints, calcPnl } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import { PriceLevelLine } from '../PriceLevelLine';
import { resolvePreviewConfig } from './resolvePreviewConfig';
import type { ChartRefs } from './types';

// Custom white crosshair cursor (24x24 SVG, hotspot at center)
const CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cline x1='12' y1='0' x2='12' y2='24' stroke='%23ffffff' stroke-width='2'/%3E%3Cline x1='0' y1='12' x2='24' y2='12' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`;

export function useOrderLines(refs: ChartRefs, contract: Contract | null, isOrderChart: boolean): void {
  // -- Preview overlay (bracket price lines) --
  const previewEnabled = useStore((s) => s.previewEnabled);
  const previewSide = useStore((s) => s.previewSide);
  const previewHideEntry = useStore((s) => s.previewHideEntry);
  const orderType = useStore((s) => s.orderType);
  const limitPrice = useStore((s) => s.limitPrice);
  const bracketPresets = useStore((s) => s.bracketPresets);
  const activePresetId = useStore((s) => s.activePresetId);
  const draftSlPoints = useStore((s) => s.draftSlPoints);
  const draftTpPoints = useStore((s) => s.draftTpPoints);
  const orderSize = useStore((s) => s.orderSize);
  const adHocSlPoints = useStore((s) => s.adHocSlPoints);
  const adHocTpLevels = useStore((s) => s.adHocTpLevels);
  const qoPendingPreview = useStore((s) => s.qoPendingPreview);

  // -- Live order & position lines (always visible) --
  const openOrders = useStore((s) => s.openOrders);
  const positions = useStore((s) => s.positions);
  const activeAccountId = useStore((s) => s.activeAccountId);

  // Create / destroy lines when the structural config changes
  useEffect(() => {
    if (!isOrderChart) return;
    const series = refs.series.current;
    const overlay = refs.overlay.current;
    const chart = refs.chart.current;
    if (!series || !overlay || !chart) return;

    refs.previewLines.current.forEach((l) => l.destroy());
    refs.previewLines.current = [];
    refs.previewRoles.current = [];
    refs.previewPrices.current = [];

    if (!previewEnabled || !contract) return;

    const config = resolvePreviewConfig();
    const tickSize = contract.tickSize;
    const toPrice = (points: number) => pointsToPrice(points, contract);

    const snap = useStore.getState();
    const entry = snap.orderType === 'limit' ? snap.limitPrice : snap.lastPrice;
    const ep = entry ?? 0;

    // Entry line (always created — hidden when limit order already placed)
    const hideEntry = snap.previewHideEntry;
    refs.previewLines.current.push(new PriceLevelLine({
      price: ep,
      series, overlay, chartApi: chart,
      lineColor: hideEntry ? 'transparent' : '#787b86',
      lineStyle: 'dashed', lineWidth: 1,
      axisLabelVisible: !hideEntry,
      tickSize,
    }));
    refs.previewRoles.current.push({ kind: 'entry' });
    refs.previewPrices.current.push(ep);

    if (config) {
      // SL line
      if (config.stopLoss.points > 0) {
        const slPts = config.stopLoss.points;
        const slPrice = ep ? (snap.previewSide === OrderSide.Buy ? ep - toPrice(slPts) : ep + toPrice(slPts)) : 0;
        refs.previewLines.current.push(new PriceLevelLine({
          price: slPrice,
          series, overlay, chartApi: chart,
          lineColor: '#ff0000', lineStyle: 'dashed', lineWidth: 1,
          axisLabelVisible: true, tickSize,
        }));
        refs.previewRoles.current.push({ kind: 'sl' });
        refs.previewPrices.current.push(slPrice);
      }

      // TP lines
      config.takeProfits.forEach((tp, i) => {
        const tpPts = tp.points;
        const tpPrice = ep ? (snap.previewSide === OrderSide.Buy ? ep + toPrice(tpPts) : ep - toPrice(tpPts)) : 0;
        refs.previewLines.current.push(new PriceLevelLine({
          price: tpPrice,
          series, overlay, chartApi: chart,
          lineColor: '#00c805', lineStyle: 'dashed', lineWidth: 1,
          axisLabelVisible: true, tickSize,
        }));
        refs.previewRoles.current.push({ kind: 'tp', index: i });
        refs.previewPrices.current.push(tpPrice);
      });
    }

    return () => {
      refs.previewLines.current.forEach((l) => l.destroy());
      refs.previewLines.current = [];
      refs.previewRoles.current = [];
      refs.previewPrices.current = [];
    };
  }, [isOrderChart, previewEnabled, previewSide, previewHideEntry, bracketPresets, activePresetId, contract, adHocSlPoints, adHocTpLevels, orderSize]);

  // Update line prices in-place (no teardown → no flicker)
  // Uses direct Zustand subscription for lastPrice to avoid re-rendering on every tick
  useEffect(() => {
    if (!isOrderChart) return;
    if (!previewEnabled || !contract) return;
    if (refs.previewLines.current.length === 0) return;

    const toPrice = (points: number) => pointsToPrice(points, contract);

    function doUpdate() {
      const snap = useStore.getState();
      const entryPrice = snap.orderType === 'limit' ? snap.limitPrice : snap.lastPrice;
      if (!entryPrice) return;

      const cfg = resolvePreviewConfig();
      const prices: number[] = [];
      let idx = 0;

      // Entry
      const entryLine = refs.previewLines.current[idx];
      if (entryLine) entryLine.setPrice(entryPrice);
      prices.push(entryPrice);
      idx++;

      if (cfg) {
        // SL
        if (cfg.stopLoss.points > 0) {
          const slPts = cfg.stopLoss.points;
          const slPrice = snap.previewSide === OrderSide.Buy ? entryPrice - toPrice(slPts) : entryPrice + toPrice(slPts);
          const slLine = refs.previewLines.current[idx];
          if (slLine) slLine.setPrice(slPrice);
          prices.push(slPrice);
          idx++;
        }

        // TPs
        cfg.takeProfits.forEach((tp) => {
          const tpPts = tp.points;
          const tpPrice = snap.previewSide === OrderSide.Buy ? entryPrice + toPrice(tpPts) : entryPrice - toPrice(tpPts);
          const tpLine = refs.previewLines.current[idx];
          if (tpLine) tpLine.setPrice(tpPrice);
          prices.push(tpPrice);
          idx++;
        });
      }

      refs.previewPrices.current = prices;
      refs.updateOverlay.current();
    }

    doUpdate();

    // Subscribe to lastPrice changes directly (bypasses React render cycle)
    let prevLp = useStore.getState().lastPrice;
    const unsub = useStore.subscribe((state) => {
      if (state.lastPrice !== prevLp) {
        prevLp = state.lastPrice;
        doUpdate();
      }
    });

    return () => { unsub(); };
  }, [isOrderChart, previewEnabled, previewSide, bracketPresets, activePresetId, contract, orderType, limitPrice, draftSlPoints, draftTpPoints, adHocSlPoints, adHocTpLevels]);

  // -- Drag interaction for preview lines (initiated from overlay labels) --
  useEffect(() => {
    if (!isOrderChart) return;
    const container = refs.container.current;
    if (!container || (!previewEnabled && !qoPendingPreview) || !contract) return;

    function snap(price: number): number {
      const ts = contract!.tickSize;
      return Math.round(price / ts) * ts;
    }

    function onMouseMove(e: MouseEvent) {
      const drag = refs.previewDragState.current;
      if (!drag) return;

      // Don't stopPropagation — let LWC see the event so crosshair stays visible
      e.preventDefault();

      const rect = container!.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const series = refs.series.current;
      if (!series) return;
      const rawPrice = series.coordinateToPrice(mouseY);
      if (rawPrice === null) return;
      const snapped = snap(rawPrice as number);

      // Quick-order pending preview drag
      if (drag.role.kind === 'qo-sl') {
        const line = refs.qoPreviewLines.current.sl;
        if (line) { line.setPrice(snapped); line.syncPosition(); }
        refs.qoPreviewPrices.current.sl = snapped;
        refs.updateOverlay.current();
        return;
      }
      if (drag.role.kind === 'qo-tp') {
        const tpIdx = drag.role.index;
        const line = refs.qoPreviewLines.current.tps[tpIdx];
        if (line) { line.setPrice(snapped); line.syncPosition(); }
        refs.qoPreviewPrices.current.tps[tpIdx] = snapped;
        refs.updateOverlay.current();
        return;
      }

      // Regular order panel preview drag
      const pvLine = refs.previewLines.current[drag.lineIdx];
      if (pvLine) { pvLine.setPrice(snapped); pvLine.syncPosition(); }
      refs.previewPrices.current[drag.lineIdx] = snapped;
      refs.updateOverlay.current();

      const st = useStore.getState();

      if (drag.role.kind === 'entry') {
        st.setOrderType('limit');
        st.setLimitPrice(snapped);
      } else {
        const entryPrice = st.orderType === 'limit' ? st.limitPrice : st.lastPrice;
        if (entryPrice) {
          const pts = priceToPoints(Math.abs(entryPrice - snapped), contract!);
          const rounded = Math.max(1, Math.round(pts));
          const hasPreset = st.bracketPresets.some((p) => p.id === st.activePresetId);
          if (drag.role.kind === 'sl') {
            if (hasPreset) st.setDraftSlPoints(rounded);
            else st.setAdHocSlPoints(rounded);
          } else if (drag.role.kind === 'tp') {
            if (hasPreset) st.setDraftTpPoints(drag.role.index, rounded);
            else st.updateAdHocTpPoints(drag.role.index, rounded);
          }
        }
      }
    }

    function onMouseUp(e: MouseEvent) {
      const drag = refs.previewDragState.current;
      if (drag) {
        // Entry label click-vs-drag: if movement < 4px, treat as click (submit order)
        const click = refs.entryClick.current;
        if (click) {
          const dx = Math.abs(e.clientX - click.downX);
          const dy = Math.abs(e.clientY - click.downY);
          if (dx < 4 && dy < 4) click.exec();
          refs.entryClick.current = null;
        }

        // Commit quick-order pending preview drag to store + bracketEngine
        if (drag.role.kind === 'qo-sl' || drag.role.kind === 'qo-tp') {
          const st = useStore.getState();
          const cur = st.qoPendingPreview;
          if (cur) {
            if (drag.role.kind === 'qo-sl' && refs.qoPreviewPrices.current.sl != null) {
              const newSlPrice = refs.qoPreviewPrices.current.sl;
              st.setQoPendingPreview({ ...cur, slPrice: newSlPrice });
              const slDiff = Math.abs(cur.entryPrice - newSlPrice);
              const slPoints = Math.round(priceToPoints(slDiff, contract!));
              bracketEngine.updateArmedConfig((cfg) => ({
                ...cfg,
                stopLoss: { ...cfg.stopLoss, points: Math.max(1, slPoints) },
              }));
            } else if (drag.role.kind === 'qo-tp') {
              const tpIdx = drag.role.index;
              const newTpPrice = refs.qoPreviewPrices.current.tps[tpIdx];
              if (newTpPrice != null) {
                const newTpPrices = [...cur.tpPrices];
                newTpPrices[tpIdx] = newTpPrice;
                st.setQoPendingPreview({ ...cur, tpPrices: newTpPrices });
                const tpDiff = Math.abs(newTpPrice - cur.entryPrice);
                const tpPoints = Math.round(priceToPoints(tpDiff, contract!));
                bracketEngine.updateArmedConfig((cfg) => ({
                  ...cfg,
                  takeProfits: cfg.takeProfits.map((tp, i) =>
                    i === tpIdx ? { ...tp, points: Math.max(1, tpPoints) } : tp),
                }));
              }
            }
          }
        }

        refs.previewDragState.current = null;
        if (refs.activeDragRow.current) {
          refs.activeDragRow.current.style.cursor = 'pointer';
          refs.activeDragRow.current = null;
        }
        if (refs.container.current) refs.container.current.style.cursor = CROSSHAIR_CURSOR;
        // Re-enable LWC scroll/scale after drag
        if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: true, handleScale: true });
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isOrderChart, previewEnabled, qoPendingPreview, contract]);

  // -- Live order & position lines (always visible) --
  useEffect(() => {
    if (!isOrderChart) return;
    const series = refs.series.current;
    const overlay = refs.overlay.current;
    const chart = refs.chart.current;
    if (!series || !overlay || !chart) return;

    // Tear down previous
    refs.orderLines.current.forEach((l) => l.destroy());
    refs.orderLines.current = [];
    refs.orderLineMeta.current = [];
    refs.orderLinePrices.current = [];

    if (!contract) return;

    const tickSize = contract.tickSize;

    // Position entry line (not draggable)
    const pos = positions.find(
      (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
    );
    if (pos) {
      refs.orderLines.current.push(new PriceLevelLine({
        price: pos.averagePrice,
        series, overlay, chartApi: chart,
        lineColor: '#cac8cb', lineStyle: 'solid', lineWidth: 1,
        axisLabelVisible: true, tickSize,
      }));
      refs.orderLineMeta.current.push({ kind: 'position' });
      refs.orderLinePrices.current.push(pos.averagePrice);
    }

    // Open order lines (draggable)
    const isLong = pos ? pos.type === PositionType.Long : undefined;
    for (const order of openOrders) {
      if (order.contractId !== contract.id) continue;

      let price: number | undefined;
      let color: string;

      if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
        price = order.stopPrice;
      } else if (order.type === OrderType.Limit) {
        price = order.limitPrice;
      } else {
        continue;
      }

      // Color by profit/loss relative to position; fall back to red SL / side-based limit
      if (pos && price != null) {
        const inProfit = isLong ? price >= pos.averagePrice : price <= pos.averagePrice;
        color = inProfit ? '#00c805' : '#ff0000';
      } else if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
        color = '#ff0000';
      } else {
        color = order.side === OrderSide.Sell ? '#ff0000' : '#00c805';
      }

      if (price == null) continue;

      refs.orderLines.current.push(new PriceLevelLine({
        price,
        series, overlay, chartApi: chart,
        lineColor: color, lineStyle: 'solid', lineWidth: 1,
        axisLabelVisible: true, tickSize,
      }));
      refs.orderLineMeta.current.push({ kind: 'order', order });
      refs.orderLinePrices.current.push(price);
    }

    return () => {
      refs.orderLines.current.forEach((l) => l.destroy());
      refs.orderLines.current = [];
      refs.orderLineMeta.current = [];
      refs.orderLinePrices.current = [];
    };
  }, [isOrderChart, openOrders, positions, contract, activeAccountId]);

  // -- Drag interaction for live order lines (initiated from overlay labels) --
  useEffect(() => {
    if (!isOrderChart) return;
    const container = refs.container.current;
    if (!container || !contract) return;

    function snapPrice(price: number): number {
      const ts = contract!.tickSize;
      return Math.round(price / ts) * ts;
    }

    function onMouseMove(e: MouseEvent) {
      const drag = refs.orderDragState.current;
      if (!drag) return;

      // Don't stopPropagation — let LWC see the event so crosshair stays visible
      e.preventDefault();

      const rect = container!.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const series = refs.series.current;
      if (!series) return;
      const rawPrice = series.coordinateToPrice(mouseY);
      if (rawPrice === null) return;
      const snapped = snapPrice(rawPrice as number);

      // Update line price + color based on profit/loss relative to position
      const pos = positions.find(
        (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract!.id) && p.size > 0,
      );
      const line = refs.orderLines.current[drag.idx];
      if (line) {
        let lineColor: string | undefined;
        if (pos) {
          const isL = pos.type === PositionType.Long;
          lineColor = (isL ? snapped >= pos.averagePrice : snapped <= pos.averagePrice) ? '#00c805' : '#ff0000';
        }
        line.setPrice(snapped);
        if (lineColor) line.setLineColor(lineColor);
        line.syncPosition();
      }
      refs.orderLinePrices.current[drag.idx] = snapped;
      drag.draggedPrice = snapped;

      // Shift pending bracket SL/TP preview lines to follow the dragged entry
      if (drag.meta.kind === 'order' && drag.meta.order.type === OrderType.Limit) {
        const delta = snapped - drag.originalPrice;
        const st = useStore.getState();

        // Path 1: Quick-order pending preview (+ button)
        const qo = st.qoPendingPreview;
        if (qo) {
          refs.qoPreviewPrices.current.entry = snapped;
          const sl = refs.qoPreviewLines.current.sl;
          if (sl && qo.slPrice != null) {
            sl.setPrice(qo.slPrice + delta); sl.syncPosition();
            refs.qoPreviewPrices.current.sl = qo.slPrice + delta;
          }
          qo.tpPrices.forEach((origTp, i) => {
            const tpLine = refs.qoPreviewLines.current.tps[i];
            if (tpLine) {
              tpLine.setPrice(origTp + delta); tpLine.syncPosition();
              refs.qoPreviewPrices.current.tps[i] = origTp + delta;
            }
          });
        }

        // Path 2: Preview with hidden entry (Buy/Sell button flow)
        if (st.previewHideEntry) {
          refs.previewPrices.current[0] = snapped;
          const toP = (points: number) => pointsToPrice(points, contract!);
          const cfg = resolvePreviewConfig();
          const pvSide = st.previewSide;
          let idx = 1; // skip entry line (index 0)
          if (cfg) {
            if (cfg.stopLoss.points > 0) {
              const slPrice = pvSide === OrderSide.Buy ? snapped - toP(cfg.stopLoss.points) : snapped + toP(cfg.stopLoss.points);
              const slLine = refs.previewLines.current[idx];
              if (slLine) { slLine.setPrice(slPrice); slLine.syncPosition(); }
              refs.previewPrices.current[idx] = slPrice;
              idx++;
            }
            cfg.takeProfits.forEach((tp) => {
              const tpPrice = pvSide === OrderSide.Buy ? snapped + toP(tp.points) : snapped - toP(tp.points);
              const tpLine = refs.previewLines.current[idx];
              if (tpLine) { tpLine.setPrice(tpPrice); tpLine.syncPosition(); }
              refs.previewPrices.current[idx] = tpPrice;
              idx++;
            });
          }
        }
      }

      refs.updateOverlay.current();
    }

    function onMouseUp() {
      const drag = refs.orderDragState.current;
      if (!drag) return;

      const { meta, originalPrice, draggedPrice: newPrice } = drag;
      refs.orderDragState.current = null;
      if (refs.activeDragRow.current) {
        refs.activeDragRow.current.style.cursor = 'pointer';
        refs.activeDragRow.current = null;
      }
      if (refs.container.current) refs.container.current.style.cursor = CROSSHAIR_CURSOR;
      // Re-enable LWC scroll/scale after drag
      if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: true, handleScale: true });

      if (meta.kind !== 'order' || newPrice === originalPrice) return;

      const { order } = meta;
      const dragIdx = drag.idx;
      const accountId = useStore.getState().activeAccountId;
      if (!accountId) return;

      // Front-end validation: SL must stay on the correct side of current price
      // Derive direction from order side (stop-sell → protecting long, stop-buy → protecting short)
      if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
        const currentPrice = useStore.getState().lastPrice ?? refs.lastBar.current?.close ?? null;
        if (currentPrice != null) {
          const protectsLong = order.side === OrderSide.Sell;
          const invalid = protectsLong ? newPrice >= currentPrice : newPrice <= currentPrice;
          if (invalid) {
            showToast('warning', 'Invalid stop loss price',
              protectsLong ? 'Stop must be below current price for long positions'
                           : 'Stop must be above current price for short positions');
            const line = refs.orderLines.current[dragIdx];
            if (line) {
              line.setPrice(originalPrice);
              line.setLineColor('#ff0000');
              line.syncPosition();
              refs.orderLinePrices.current[dragIdx] = originalPrice;
              refs.updateOverlay.current();
            }
            return;
          }
        }
      }

      const params: { accountId: number; orderId: number; stopPrice?: number; limitPrice?: number } = {
        accountId,
        orderId: order.id,
      };

      if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
        params.stopPrice = newPrice;
      } else if (order.type === OrderType.Limit) {
        params.limitPrice = newPrice;
      }

      // Optimistically commit bracket preview positions to store
      const prevQo = order.type === OrderType.Limit ? useStore.getState().qoPendingPreview : null;
      const wasHideEntry = order.type === OrderType.Limit && useStore.getState().previewHideEntry;
      if (prevQo) {
        const d = newPrice - originalPrice;
        useStore.getState().setQoPendingPreview({
          ...prevQo,
          entryPrice: prevQo.entryPrice + d,
          slPrice: prevQo.slPrice != null ? prevQo.slPrice + d : null,
          tpPrices: prevQo.tpPrices.map((p) => p + d),
        });
      }
      if (wasHideEntry) {
        useStore.getState().setLimitPrice(newPrice);
      }

      orderService.modifyOrder(params).catch((err) => {
        showToast('error', 'Order modification failed', errorMessage(err));
        // Revert line back to original price
        const line = refs.orderLines.current[dragIdx];
        if (line) {
          // Recompute correct color based on position
          const pos = positions.find(
            (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract!.id) && p.size > 0,
          );
          let revertColor = '#ff0000';
          if (pos) {
            const isL = pos.type === PositionType.Long;
            revertColor = (isL ? originalPrice >= pos.averagePrice : originalPrice <= pos.averagePrice)
              ? '#00c805' : '#ff0000';
          }
          line.setPrice(originalPrice);
          line.setLineColor(revertColor);
          line.syncPosition();
          refs.orderLinePrices.current[dragIdx] = originalPrice;
          refs.updateOverlay.current();
        }
        // Revert bracket preview positions
        if (prevQo) {
          useStore.getState().setQoPendingPreview(prevQo);
          refs.qoPreviewPrices.current.entry = prevQo.entryPrice;
          const sl = refs.qoPreviewLines.current.sl;
          if (sl && prevQo.slPrice != null) { sl.setPrice(prevQo.slPrice); sl.syncPosition(); refs.qoPreviewPrices.current.sl = prevQo.slPrice; }
          prevQo.tpPrices.forEach((tp, i) => {
            const l = refs.qoPreviewLines.current.tps[i];
            if (l) { l.setPrice(tp); l.syncPosition(); refs.qoPreviewPrices.current.tps[i] = tp; }
          });
        }
        if (wasHideEntry) {
          refs.previewPrices.current[0] = originalPrice;
          useStore.getState().setLimitPrice(originalPrice);
        }
      });
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isOrderChart, contract]);

  // -- Position drag-to-create SL/TP (drag from position label → place order on release) --
  useEffect(() => {
    if (!isOrderChart) return;
    const container = refs.container.current;
    const overlay = refs.overlay.current;
    const chart = refs.chart.current;
    if (!container || !overlay || !chart || !contract) return;

    const tickSize = contract.tickSize;

    function snapPrice(price: number): number {
      return Math.round(price / tickSize) * tickSize;
    }

    function onMouseMove(e: MouseEvent) {
      const drag = refs.posDrag.current;
      if (!drag) return;

      // Don't stopPropagation — let the event reach LWC so the crosshair stays visible
      e.preventDefault();

      const rect = container!.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const series = refs.series.current;
      if (!series) return;
      const rawPrice = series.coordinateToPrice(mouseY);
      if (rawPrice === null) return;
      const snapped = snapPrice(rawPrice as number);

      // Determine direction based on price relative to position
      let direction: 'sl' | 'tp';
      if (drag.isLong) {
        direction = snapped < drag.avgPrice ? 'sl' : 'tp';
      } else {
        direction = snapped > drag.avgPrice ? 'sl' : 'tp';
      }
      drag.direction = direction;
      drag.snappedPrice = snapped;

      // Create or update temporary preview line
      const color = direction === 'sl' ? '#ff4444' : '#00c805';
      if (!refs.posDragLine.current) {
        refs.posDragLine.current = new PriceLevelLine({
          price: snapped,
          series: series!, overlay: overlay!, chartApi: chart!,
          lineColor: color, lineStyle: 'dashed', lineWidth: 2,
          axisLabelVisible: true, tickSize,
        });
      } else {
        refs.posDragLine.current.setPrice(snapped);
        refs.posDragLine.current.setLineColor(color);
        refs.posDragLine.current.syncPosition();
      }

      // Compute projected P&L for the label
      const diff = drag.isLong
        ? (direction === 'tp' ? snapped - drag.avgPrice : drag.avgPrice - snapped)
        : (direction === 'tp' ? drag.avgPrice - snapped : snapped - drag.avgPrice);
      const orderSz = direction === 'sl' ? drag.posSize : 1;
      const pnl = calcPnl(diff, contract!, orderSz);
      const pnlText = direction === 'sl'
        ? `-$${Math.abs(pnl).toFixed(2)}`
        : `+$${Math.abs(pnl).toFixed(2)}`;
      const labelText = direction === 'sl' ? 'SL' : 'TP';
      const textColor = color === '#00c805' ? '#000' : '#fff';

      // Create or update temporary overlay label
      if (!refs.posDragLabel.current && overlay) {
        const row = document.createElement('div');
        row.style.cssText = 'position:absolute;left:50%;display:flex;height:20px;font-size:11px;font-weight:bold;font-family:-apple-system,BlinkMacSystemFont,Trebuchet MS,Roboto,Ubuntu,sans-serif;line-height:20px;transform:translate(-50%,-50%);white-space:nowrap;border-radius:3px;overflow:hidden;pointer-events:none;';
        // P&L cell
        const pnlCell = document.createElement('div');
        pnlCell.style.cssText = `background:${color};color:${textColor};padding:0 6px;`;
        pnlCell.textContent = pnlText;
        pnlCell.dataset.role = 'pnl';
        row.appendChild(pnlCell);
        // Size cell
        const sizeCell = document.createElement('div');
        sizeCell.style.cssText = `background:${color};color:${textColor};padding:0 6px;`;
        sizeCell.textContent = String(orderSz);
        sizeCell.dataset.role = 'size';
        row.appendChild(sizeCell);
        // Label cell
        const lblCell = document.createElement('div');
        lblCell.style.cssText = `background:#e0e0e0;color:#000;padding:0 6px;`;
        lblCell.textContent = labelText;
        lblCell.dataset.role = 'lbl';
        row.appendChild(lblCell);
        overlay.appendChild(row);
        refs.posDragLabel.current = row;
      }
      if (refs.posDragLabel.current) {
        // Update cell contents
        const cells = refs.posDragLabel.current.children;
        const pnlCell = cells[0] as HTMLDivElement;
        const sizeCell = cells[1] as HTMLDivElement;
        const lblCell = cells[2] as HTMLDivElement;
        pnlCell.textContent = pnlText;
        pnlCell.style.background = color;
        pnlCell.style.color = textColor;
        sizeCell.textContent = String(orderSz);
        sizeCell.style.background = color;
        sizeCell.style.color = textColor;
        lblCell.textContent = labelText;
        // Position at Y coordinate of the snapped price
        const y = series.priceToCoordinate(snapped);
        if (y !== null) {
          refs.posDragLabel.current.style.top = `${y}px`;
          refs.posDragLabel.current.style.display = 'flex';
        }
      }
    }

    function onMouseUp() {
      const drag = refs.posDrag.current;
      if (!drag) return;

      refs.posDrag.current = null;
      if (refs.activeDragRow.current) {
        refs.activeDragRow.current.style.cursor = 'pointer';
        refs.activeDragRow.current = null;
      }
      if (refs.container.current) refs.container.current.style.cursor = CROSSHAIR_CURSOR;
      // Re-enable LWC scroll/scale after drag
      if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: true, handleScale: true });

      // Remove temporary line + label
      if (refs.posDragLine.current) {
        refs.posDragLine.current.destroy();
        refs.posDragLine.current = null;
      }
      if (refs.posDragLabel.current) {
        refs.posDragLabel.current.remove();
        refs.posDragLabel.current = null;
      }

      if (!drag.direction) return;

      const st = useStore.getState();
      if (!st.activeAccountId || !contract) return;

      const oppositeSide = drag.isLong ? OrderSide.Sell : OrderSide.Buy;

      if (drag.direction === 'sl') {
        // Validate: no existing stop order for this contract + side
        const existingSL = st.openOrders.some(
          (o) => String(o.contractId) === String(contract!.id)
            && (o.type === OrderType.Stop || o.type === OrderType.TrailingStop)
            && o.side === oppositeSide,
        );
        if (existingSL) {
          showToast('warning', 'SL already exists for this position');
          return;
        }
        orderService.placeOrder({
          accountId: st.activeAccountId,
          contractId: contract!.id,
          type: OrderType.Stop,
          side: oppositeSide,
          size: drag.posSize,
          stopPrice: drag.snappedPrice,
        }).catch((err) => {
          showToast('error', 'Stop Loss placement failed', errorMessage(err));
        });
      } else {
        // TP: validate remaining contracts
        const existingTpSize = st.openOrders
          .filter(
            (o) => String(o.contractId) === String(contract!.id)
              && o.type === OrderType.Limit
              && o.side === oppositeSide,
          )
          .reduce((sum, o) => sum + o.size, 0);
        const remaining = drag.posSize - existingTpSize;
        if (remaining <= 0) {
          showToast('warning', 'No remaining contracts for TP');
          return;
        }
        orderService.placeOrder({
          accountId: st.activeAccountId,
          contractId: contract!.id,
          type: OrderType.Limit,
          side: oppositeSide,
          size: Math.min(1, remaining),
          limitPrice: drag.snappedPrice,
        }).catch((err) => {
          showToast('error', 'Take Profit placement failed', errorMessage(err));
        });
      }
    }

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);

    return () => {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      if (refs.posDragLine.current) {
        refs.posDragLine.current.destroy();
        refs.posDragLine.current = null;
      }
      if (refs.posDragLabel.current) {
        refs.posDragLabel.current.remove();
        refs.posDragLabel.current = null;
      }
    };
  }, [isOrderChart, contract, positions, openOrders, activeAccountId]);
}
