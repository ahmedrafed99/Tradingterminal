import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { buildNativeBracketParams, buildNativeSLOnly } from '../../../types/bracket';
import { OrderType, OrderSide, OrderStatus } from '../../../types/enums';
import { orderService } from '../../../services/orderService';
import type { PlaceOrderParams } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { pointsToPrice, calcPnl } from '../../../utils/instrument';
import { snapToTickSize, getPriceScaleWidth } from '../barUtils';
import { fitTpsToOrderSize } from './resolvePreviewConfig';
import { showToast, errorMessage } from '../../../utils/toast';
import { isFuturesMarketOpen } from '../../../utils/marketHours';
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
    const labelText = el.querySelector('[data-qo-text]') as HTMLSpanElement;
    const labelSize = el.querySelector('[data-qo-size]') as HTMLSpanElement;
    const plusEl = el.querySelector('[data-qo-plus]') as HTMLDivElement;
    if (!wrap || !label || !labelText || !labelSize || !plusEl) return;

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

      // TP lines (with P&L labels) — trim to fit within orderSize
      const fittedTps = fitTpsToOrderSize(bc.takeProfits, st.orderSize);
      const computedTpPrices: number[] = [];
      const computedTpSizes: number[] = [];
      fittedTps.forEach((tp) => {
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
        const fittedTps = fitTpsToOrderSize(bc.takeProfits, st.orderSize);
        fittedTps.forEach((tp) => {
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

    // Size +/- sub-elements (created once, shown on size cell hover)
    let sizeMinusEl: HTMLDivElement | null = null;
    let sizeCountEl: HTMLDivElement | null = null;
    let sizePlusEl: HTMLDivElement | null = null;
    let sizeButtonsActive = false;

    function setupSizeButtons() {
      if (sizeMinusEl) return; // already created

      sizeMinusEl = document.createElement('div');
      sizeMinusEl.textContent = '\u2212';
      sizeMinusEl.style.cssText = 'display:none;padding:0 4px;cursor:pointer;opacity:0;transition:opacity 0.15s, transform 0.15s;';

      sizeCountEl = document.createElement('div');
      sizeCountEl.style.cssText = 'padding:0 4px;';

      sizePlusEl = document.createElement('div');
      sizePlusEl.textContent = '+';
      sizePlusEl.style.cssText = 'display:none;padding:0 4px;cursor:pointer;opacity:0;transition:opacity 0.15s, transform 0.15s;';

      // Scale up on hover
      sizeMinusEl.addEventListener('mouseenter', () => { sizeMinusEl!.style.transform = 'scale(1.4)'; });
      sizeMinusEl.addEventListener('mouseleave', () => { sizeMinusEl!.style.transform = ''; });
      sizePlusEl.addEventListener('mouseenter', () => { sizePlusEl!.style.transform = 'scale(1.4)'; });
      sizePlusEl.addEventListener('mouseleave', () => { sizePlusEl!.style.transform = ''; });

      // Click handlers — stopPropagation so they don't trigger order placement
      sizeMinusEl.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const st = useStore.getState();
        if (st.orderSize <= 1) return;
        st.setOrderSize(st.orderSize - 1);
        refreshLabel();
        // With preset: rebuild preview lines so TPs trim to new size
        if (getPresetMaxSize() != null) createPreviewLines();
      });

      sizePlusEl.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const st = useStore.getState();
        const max = getPresetMaxSize();
        if (max != null && st.orderSize >= max) return; // can't exceed preset size
        st.setOrderSize(st.orderSize + 1);
        refreshLabel();
        if (max != null) createPreviewLines();
      });
    }

    function getPresetMaxSize(): number | null {
      const st = useStore.getState();
      const preset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      if (!preset) return null;
      return preset.config.takeProfits.reduce((sum, tp) => sum + tp.size, 0);
    }

    // Prepare size buttons DOM (hidden) — called on hover enter
    function prepareSizeButtons() {
      setupSizeButtons();
      if (!sizeMinusEl || !sizeCountEl || !sizePlusEl) return;

      const st = useStore.getState();

      // Replace labelSize content with sub-elements (buttons stay hidden)
      labelSize.textContent = '';
      labelSize.style.display = 'flex';
      labelSize.style.alignItems = 'center';
      labelSize.style.padding = '0';
      labelSize.style.transition = 'background 0.15s';

      if (!labelSize.contains(sizeMinusEl)) {
        labelSize.appendChild(sizeMinusEl);
        labelSize.appendChild(sizeCountEl!);
        labelSize.appendChild(sizePlusEl);
      }

      sizeCountEl.textContent = String(st.orderSize);
      // Keep buttons hidden until mouse enters the size cell
      sizeMinusEl.style.display = 'none';
      sizePlusEl.style.display = 'none';
    }

    // Reveal +/- and darken bg — called when mouse enters the size cell
    function revealSizeButtons() {
      if (!sizeMinusEl || !sizeCountEl || !sizePlusEl) return;
      const sz = useStore.getState().orderSize;
      const max = getPresetMaxSize();
      const minDisabled = sz <= 1;
      const plusDisabled = max != null && sz >= max;
      sizeMinusEl.style.display = '';
      sizePlusEl.style.display = '';
      labelSize.style.background = isBuy ? '#00a004' : '#cc0000';
      requestAnimationFrame(() => {
        if (sizeMinusEl) sizeMinusEl.style.opacity = minDisabled ? '0.35' : '1';
        if (sizePlusEl) sizePlusEl.style.opacity = plusDisabled ? '0.35' : '1';
      });
      sizeMinusEl.style.cursor = minDisabled ? 'default' : 'pointer';
      sizePlusEl.style.cursor = plusDisabled ? 'default' : 'pointer';
      sizeButtonsActive = true;
    }

    // Hide +/- and restore bg — called when mouse leaves the size cell
    function hideSizeButtons() {
      if (!sizeButtonsActive) return;
      labelSize.style.background = isBuy ? '#00c805' : '#ff0000';
      if (sizeMinusEl) { sizeMinusEl.style.opacity = '0'; sizeMinusEl.style.display = 'none'; }
      if (sizePlusEl) { sizePlusEl.style.opacity = '0'; sizePlusEl.style.display = 'none'; }
      sizeButtonsActive = false;
    }

    // Show +/- when hovering labelText (without darkening size bg)
    let textHovered = false;
    function onTextEnter() {
      textHovered = true;
      labelText.style.background = '#b0afb1';
      labelText.style.transition = 'background 0.15s';
      // Reveal +/- buttons without darkening the size cell bg
      if (sizeMinusEl && sizePlusEl && !sizeButtonsActive) {
        sizeMinusEl.style.display = '';
        sizePlusEl.style.display = '';
        const sz = useStore.getState().orderSize;
        const max = getPresetMaxSize();
        const plusDisabled = max != null && sz >= max;
        requestAnimationFrame(() => {
          if (sizeMinusEl) sizeMinusEl.style.opacity = sz <= 1 ? '0.35' : '1';
          if (sizePlusEl) sizePlusEl.style.opacity = plusDisabled ? '0.35' : '1';
        });
        if (sizeMinusEl) sizeMinusEl.style.cursor = sz <= 1 ? 'default' : 'pointer';
        if (sizePlusEl) sizePlusEl.style.cursor = plusDisabled ? 'default' : 'pointer';
      }
    }
    function onTextLeave() {
      textHovered = false;
      labelText.style.background = '#cac9cb';
      // Hide +/- if not hovering size cell
      if (!sizeButtonsActive && sizeMinusEl && sizePlusEl) {
        sizeMinusEl.style.opacity = '0';
        sizeMinusEl.style.display = 'none';
        sizePlusEl.style.opacity = '0';
        sizePlusEl.style.display = 'none';
      }
    }
    labelText.addEventListener('mouseenter', onTextEnter);
    labelText.addEventListener('mouseleave', onTextLeave);

    // Wire mouseenter/mouseleave on labelSize for size cell hover detection
    labelSize.addEventListener('mouseenter', revealSizeButtons);
    labelSize.addEventListener('mouseleave', hideSizeButtons);

    function refreshLabel() {
      const sz = useStore.getState().orderSize;
      labelText.textContent = isBuy ? 'Buy Limit' : 'Sell Limit';
      labelSize.style.background = sizeButtonsActive
        ? (isBuy ? '#00a004' : '#cc0000')
        : (isBuy ? '#00c805' : '#ff0000');
      labelSize.style.color = '#000';

      if (sizeCountEl && labelSize.contains(sizeCountEl)) {
        // Sub-elements are in the DOM — update the count span only
        sizeCountEl.textContent = String(sz);
        if (sizeButtonsActive && sizeMinusEl && sizePlusEl) {
          sizeMinusEl.style.opacity = sz <= 1 ? '0.35' : '1';
          sizeMinusEl.style.cursor = sz <= 1 ? 'default' : 'pointer';
          const max = getPresetMaxSize();
          const plusDisabled = max != null && sz >= max;
          sizePlusEl.style.opacity = plusDisabled ? '0.35' : '1';
          sizePlusEl.style.cursor = plusDisabled ? 'default' : 'pointer';
        }
      } else {
        labelSize.textContent = String(sz);
      }
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
      snappedPrice = snapToTickSize(rawPrice as number, contract.tickSize);
      lastCrosshairTime = param.time ?? null;
      if (param.time) lastValidTime = param.time;
      if (!isHovered) {
        isBuy = lastP != null ? snappedPrice < lastP : true;
      }

      const psWidth = getPriceScaleWidth(chart);

      el.style.display = 'flex';
      el.style.top = `${param.point.y}px`;
      el.style.right = `${psWidth}px`;

      if (isHovered) refreshLabel();
    };

    const onEnter = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      isHovered = true;
      refs.qoHovered.current = true;
      label.style.display = 'flex';
      plusEl.style.borderRadius = '0 2px 2px 0';
      plusEl.style.background = '#434651';
      refreshLabel();
      prepareSizeButtons();
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
      hideSizeButtons();
      if (textHovered) onTextLeave();
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
      if (!isFuturesMarketOpen()) {
        showToast('warning', 'Market closed', 'Futures market is closed. Orders cannot be placed.');
        removePreviewLines();
        useStore.getState().setQoPendingPreview(null);
        return;
      }
      const st = useStore.getState();
      if (!st.activeAccountId) return;

      const side = isBuy ? OrderSide.Buy : OrderSide.Sell;
      const activePreset = st.bracketPresets.find((p) => p.id === st.activePresetId);
      let bracketsArmed = false;

      // Use gateway-native brackets for <= 1 TP (atomic placement).
      // For 2+ TPs, attach native SL bracket (zero-latency SL) + arm engine for TPs only.
      let nativeBrackets: ReturnType<typeof buildNativeBracketParams> = null;
      let nativeSL: ReturnType<typeof buildNativeSLOnly> = null;

      if (activePreset) {
        const bc = activePreset.config;
        const bracketsActive = bc.stopLoss.points >= 1 || bc.takeProfits.length >= 1;
        if (bracketsActive) {
          nativeBrackets = buildNativeBracketParams(bc, side, contract!);

          if (!nativeBrackets) {
            // 2+ TPs — attach native SL for zero-latency protection, engine handles TPs after fill
            nativeSL = buildNativeSLOnly(bc, side, contract!);

            bracketEngine.armForEntry({
              accountId: st.activeAccountId,
              contractId: contract!.id,
              entrySide: side,
              entrySize: st.orderSize,
              config: bc,
              contract: contract!,
              nativeSL: !!nativeSL,
            });
            bracketsArmed = true;
          }

          // Publish pending preview for overlay labels — trim TPs to fit orderSize
          const toP = (points: number) => pointsToPrice(points, contract!);
          const ep = snappedPrice;
          const fittedTps = fitTpsToOrderSize(bc.takeProfits, st.orderSize);
          st.setQoPendingPreview({
            entryPrice: ep,
            slPrice: bc.stopLoss.points > 0
              ? (side === OrderSide.Buy ? ep - toP(bc.stopLoss.points) : ep + toP(bc.stopLoss.points))
              : null,
            tpPrices: fittedTps.map((tp) =>
              side === OrderSide.Buy ? ep + toP(tp.points) : ep - toP(tp.points),
            ),
            side,
            orderSize: st.orderSize,
            tpSizes: fittedTps.map((tp) => tp.size),
          });
        }
      }

      // Remove hover labels (labels on preview lines)
      for (const line of qoPreviewLines) line.setLabel(null);
      if (!bracketsArmed && !nativeBrackets) {
        removePreviewLines();
      } else {
        // Destroy the entry reference line — the live order line replaces it
        const entryLine = qoPreviewLines.shift();
        if (entryLine) entryLine.destroy();
      }

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
        ...nativeSL,
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

        snappedPrice = snapToTickSize(rawPrice as number, contract.tickSize);

        // Reposition + button
        const y = series.priceToCoordinate(snappedPrice);
        if (y != null) el.style.top = `${y}px`;

        // Keep crosshair at dragged position
        const timeToUse = lastCrosshairTime ?? lastValidTime;
        if (timeToUse != null) {
          chart.setCrosshairPosition(snappedPrice, timeToUse as Parameters<typeof chart.setCrosshairPosition>[1], series);
        }

        // Directly update local crosshair label + peer chart (bypasses async
        // crosshair callback chain to eliminate 1–2 frame lag during drag).
        refs.crosshairLabel.current?.updateCrosshairPrice(snappedPrice);
        if (timeToUse != null) refs.peerSync.current?.(snappedPrice, timeToUse);

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
      hideSizeButtons();
      labelSize.removeEventListener('mouseenter', revealSizeButtons);
      labelSize.removeEventListener('mouseleave', hideSizeButtons);
      labelText.removeEventListener('mouseenter', onTextEnter);
      labelText.removeEventListener('mouseleave', onTextLeave);
      labelText.style.background = '#cac9cb';
      // Reset labelSize to plain text mode
      labelSize.textContent = '';
      labelSize.style.display = '';
      labelSize.style.padding = '0 6px';
      labelSize.style.transition = '';
      if (sizeMinusEl && labelSize.contains(sizeMinusEl)) {
        labelSize.removeChild(sizeMinusEl);
        labelSize.removeChild(sizeCountEl!);
        labelSize.removeChild(sizePlusEl!);
      }
      sizeMinusEl = null;
      sizeCountEl = null;
      sizePlusEl = null;
      sizeButtonsActive = false;
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
