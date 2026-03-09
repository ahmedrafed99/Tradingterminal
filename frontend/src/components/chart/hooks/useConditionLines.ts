import { useEffect, useRef } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { conditionService } from '../../../services/conditionService';
import type { CreateConditionInput } from '../../../services/conditionService';
import { PriceLevelLine } from '../PriceLevelLine';
import type { ChartRefs } from './types';
import { showToast, errorMessage } from '../../../utils/toast';
import { calcPnl } from '../../../utils/instrument';
import {
  installSizeButtons, formatSlPnl, formatTpPnl,
  updateSizeCellCount, BUY_HOVER, SELL_HOVER,
} from './labelUtils';

// ── Colors ───────────────────────────────────────────────
const CLR_ABOVE = '#2962ff';
const CLR_BELOW = '#d32f2f';
const CLR_BUY = '#00c805';
const CLR_SELL = '#ff0000';
const CLR_ARM_ABOVE = '#4a7dff';
const CLR_ARM_BELOW = '#d32f2f';
const CLR_SL = '#ff0000';
const CLR_TP = '#00c805';

/**
 * Renders armed conditions as dashed lines on the chart,
 * AND manages the "Preview" mode for quick condition creation.
 *
 * Preview mode (conditionPreview === true):
 *  - 2 draggable lines appear mid-chart: condition trigger + order (limit)
 *  - Arrow button on condition line toggles between Close Above / Close Below
 *  - +/- buttons on order line for size (when no preset)
 *  - +SL / +TP buttons add bracket lines (when no preset)
 *  - ARM button on condition line sends the condition to the server
 *  - If a bracket preset is selected, auto-arms immediately
 */
export function useConditionLines(
  refs: ChartRefs,
  contract: Contract | null,
  timeframe: Timeframe,
): void {
  const conditions = useStore((s) => s.conditions);
  const conditionServerUrl = useStore((s) => s.conditionServerUrl);
  const conditionPreview = useStore((s) => s.conditionPreview);

  // -- Refs for armed condition lines --
  const linesRef = useRef<PriceLevelLine[]>([]);
  const condIdsRef = useRef<string[]>([]);
  const dragRef = useRef<{
    condId: string;
    lineIdx: number;
    originalPrice: number;
    startY: number;
    field: 'triggerPrice' | 'orderPrice';
  } | null>(null);

  // -- Refs for preview lines --
  const previewRef = useRef<{
    condLine: PriceLevelLine | null;
    orderLine: PriceLevelLine | null;
    slLine: PriceLevelLine | null;
    tpLines: { line: PriceLevelLine; price: number; size: number }[];
    condPrice: number;
    orderPrice: number;
    slPrice: number | null;
    size: number;
    isAbove: boolean;
    isMarket: boolean;
  } | null>(null);
  const previewDragRef = useRef<{
    target: 'cond' | 'order' | 'sl' | 'tp';
    startY: number;
    originalPrice: number;
    tpIndex?: number;
  } | null>(null);

  // =====================================================================
  // EFFECT 1: Armed condition lines (existing conditions from server)
  // =====================================================================
  useEffect(() => {
    const series = refs.series.current;
    const overlay = refs.overlay.current;
    const chart = refs.chart.current;

    for (const line of linesRef.current) line.destroy();
    linesRef.current = [];
    condIdsRef.current = [];

    if (!series || !overlay || !chart || !contract || !conditionServerUrl) return;

    const relevant = conditions.filter(
      (c) => c.status === 'armed' && String(c.contractId) === String(contract.id),
    );

    const tickSize = contract.tickSize;

    for (const cond of relevant) {
      const isAbove = cond.conditionType === 'closes_above';
      const lineColor = isAbove ? CLR_ABOVE : CLR_BELOW;
      const condId = cond.id;

      // --- Trigger line ---
      const line = new PriceLevelLine({
        price: cond.triggerPrice,
        series,
        overlay,
        chartApi: chart,
        lineColor,
        lineStyle: 'dashed',
        lineWidth: 1,
        axisLabelVisible: true,
        tickSize,
      });

      const arrowChar = isAbove ? '\u25B2' : '\u25BC';

      line.setLabel([
        { text: arrowChar, bg: isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW, color: '#fff' },
        { text: `${isAbove ? 'Above' : 'Below'} ${cond.timeframe}`, bg: '#cac9cb', color: '#000' },
        { text: '\u2715', bg: '#e0e0e0', color: '#000' },
      ]);

      const labelEl = line.getLabelEl();
      const cells = line.getCells();
      const lineIdx = linesRef.current.length;

      if (labelEl) {
        labelEl.style.pointerEvents = 'auto';
        labelEl.style.cursor = 'grab';

        const xCell = cells[cells.length - 1];
        if (xCell) {
          xCell.style.cursor = 'pointer';
          xCell.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const url = useStore.getState().conditionServerUrl;
            if (!url) return;
            conditionService.remove(url, condId).then(() => {
              useStore.getState().removeCondition(condId);
            }).catch((err) => {
              showToast('error', 'Failed to delete', errorMessage(err));
            });
          });
        }

        labelEl.addEventListener('mousedown', (e) => {
          if (e.target === xCell || xCell?.contains(e.target as Node)) return;
          e.preventDefault();
          dragRef.current = {
            condId,
            lineIdx,
            originalPrice: cond.triggerPrice,
            startY: e.clientY,
            field: 'triggerPrice',
          };
          labelEl.style.cursor = 'grabbing';
          if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
          if (chart) chart.applyOptions({ handleScroll: false, handleScale: false });
        });
      }

      linesRef.current.push(line);
      condIdsRef.current.push(condId);

      // --- Order price line (limit orders only) ---
      if (cond.orderType === 'limit' && cond.orderPrice != null) {
        const sideLabel = cond.orderSide === 'buy' ? 'Buy Limit' : 'Sell Limit';
        const sideBg = cond.orderSide === 'buy' ? CLR_BUY : CLR_SELL;

        const orderLine = new PriceLevelLine({
          price: cond.orderPrice,
          series,
          overlay,
          chartApi: chart,
          lineColor: sideBg,
          lineStyle: 'dashed',
          lineWidth: 1,
          axisLabelVisible: true,
          tickSize,
        });

        orderLine.setLabel([
          { text: sideLabel, bg: '#cac9cb', color: '#000' },
          { text: String(cond.orderSize), bg: sideBg, color: '#000' },
          { text: '\u2715', bg: '#e0e0e0', color: '#000' },
        ]);

        const orderLabelEl = orderLine.getLabelEl();
        const orderCells = orderLine.getCells();
        const orderLineIdx = linesRef.current.length;
        if (orderLabelEl) {
          orderLabelEl.style.pointerEvents = 'auto';
          orderLabelEl.style.cursor = 'grab';

          const orderXCell = orderCells[orderCells.length - 1];
          if (orderXCell) {
            orderXCell.style.cursor = 'pointer';
            orderXCell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              const url = useStore.getState().conditionServerUrl;
              if (!url) return;
              conditionService.update(url, condId, { orderType: 'market', orderPrice: undefined })
                .then((updated) => { useStore.getState().upsertCondition(updated); })
                .catch((err) => {
                  showToast('error', 'Failed to update', errorMessage(err));
                });
            });
          }

          // Drag to modify order price
          orderLabelEl.addEventListener('mousedown', (e) => {
            if (e.target === orderXCell || orderXCell?.contains(e.target as Node)) return;
            e.preventDefault();
            dragRef.current = {
              condId,
              lineIdx: orderLineIdx,
              originalPrice: cond.orderPrice!,
              startY: e.clientY,
              field: 'orderPrice',
            };
            orderLabelEl.style.cursor = 'grabbing';
            if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
            if (chart) chart.applyOptions({ handleScroll: false, handleScale: false });
          });
        }

        linesRef.current.push(orderLine);
        condIdsRef.current.push(condId);
      }
    }

    return () => {
      for (const line of linesRef.current) line.destroy();
      linesRef.current = [];
      condIdsRef.current = [];
    };
  }, [conditions, contract, conditionServerUrl, refs]);

  // =====================================================================
  // EFFECT 2: Armed condition drag handling
  // =====================================================================
  useEffect(() => {
    const container = refs.container.current;
    const series = refs.series.current;
    const chart = refs.chart.current;
    if (!container || !series || !chart || !contract) return;

    const tickSize = contract.tickSize;

    function onMouseMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = container!.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const rawPrice = series!.coordinateToPrice(y);
      if (rawPrice === null) return;
      const snapped = Math.round(rawPrice / tickSize) * tickSize;
      const line = linesRef.current[drag.lineIdx];
      if (line) { line.setPrice(snapped); line.syncPosition(); }
    }

    function onMouseUp(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      container!.style.cursor = '';
      chart!.applyOptions({ handleScroll: true, handleScale: true });
      const line = linesRef.current[drag.lineIdx];
      const labelEl = line?.getLabelEl();
      if (labelEl) labelEl.style.cursor = 'grab';

      const dy = Math.abs(e.clientY - drag.startY);
      if (dy < 4) {
        if (line) { line.setPrice(drag.originalPrice); line.syncPosition(); }
        if (drag.field === 'triggerPrice') {
          useStore.getState().openConditionModal(drag.condId);
        }
        return;
      }

      const newPrice = line?.getPrice() ?? drag.originalPrice;
      if (newPrice === drag.originalPrice) return;
      const url = useStore.getState().conditionServerUrl;
      if (!url) return;
      conditionService.update(url, drag.condId, { [drag.field]: newPrice })
        .then((updated) => { useStore.getState().upsertCondition(updated); })
        .catch((err) => {
          if (line) { line.setPrice(drag.originalPrice); line.syncPosition(); }
          showToast('error', 'Failed to update condition', errorMessage(err));
        });
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [contract, refs]);

  // =====================================================================
  // EFFECT 3: Preview mode — create / destroy preview lines
  // =====================================================================
  useEffect(() => {
    const series = refs.series.current;
    const overlay = refs.overlay.current;
    const chart = refs.chart.current;
    const container = refs.container.current;

    // Cleanup helper
    function destroyPreview() {
      const p = previewRef.current;
      if (!p) return;
      p.condLine?.destroy();
      p.orderLine?.destroy();
      p.slLine?.destroy();
      for (const tp of p.tpLines) tp.line.destroy();
      previewRef.current = null;
    }

    if (!conditionPreview || !series || !overlay || !chart || !container || !contract || !conditionServerUrl) {
      destroyPreview();
      return;
    }

    // Don't recreate if already exists
    if (previewRef.current) return;

    const tickSize = contract.tickSize;
    const st = useStore.getState();
    const lastP = st.lastPrice ?? refs.lastBar.current?.close;
    if (!lastP) { destroyPreview(); return; }

    // Offset: ~20 ticks above/below last price
    const offset = tickSize * 20;
    const condPrice = Math.round((lastP + offset) / tickSize) * tickSize;
    const orderPrice = Math.round((lastP - offset) / tickSize) * tickSize;
    const size = st.orderSize;

    // Condition line
    const condLine = new PriceLevelLine({
      price: condPrice, series, overlay, chartApi: chart,
      lineColor: CLR_ABOVE, lineStyle: 'dashed', lineWidth: 1,
      axisLabelVisible: true, tickSize,
    });

    // Order line
    const orderLine = new PriceLevelLine({
      price: orderPrice, series, overlay, chartApi: chart,
      lineColor: CLR_BUY, lineStyle: 'dashed', lineWidth: 1,
      axisLabelVisible: true, tickSize,
    });

    previewRef.current = {
      condLine, orderLine,
      slLine: null, tpLines: [],
      condPrice, orderPrice,
      slPrice: null,
      size, isAbove: true, isMarket: false,
    };

    // Build labels (also wires up interaction handlers)
    updatePreviewLabels();

    function updatePreviewLabels() {
      const p = previewRef.current;
      if (!p || !p.condLine) return;

      const isAbove = p.isAbove;

      // Always sync line colors to match current direction
      p.condLine.setLineColor(isAbove ? CLR_ABOVE : CLR_BELOW);
      if (p.orderLine) {
        if (p.isMarket) {
          // Market mode: hide the horizontal line and axis label
          p.orderLine.setLineWidth(0);
          p.orderLine.setAxisLabelVisible(false);
        } else {
          p.orderLine.setLineColor(isAbove ? CLR_BUY : CLR_SELL);
          p.orderLine.setLineWidth(1);
          p.orderLine.setAxisLabelVisible(true);
        }
      }

      const arrowChar = isAbove ? '\u25B2' : '\u25BC';
      const condText = isAbove ? 'If Close Above' : 'If Close Below';
      const orderWord = p.isMarket ? 'Market' : 'Limit';
      const sideText = isAbove ? `Buy ${orderWord}` : `Sell ${orderWord}`;
      const sideBg = isAbove ? CLR_BUY : CLR_SELL;

      // Condition label: [▲] [If Close Above 5m] [limit/market] [ARM] [✕]
      const armBg = isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW;
      const orderTypeText = p.isMarket ? 'market' : 'limit';

      p.condLine.setLabel([
        { text: arrowChar, bg: armBg, color: '#fff' },
        { text: `${condText} ${timeframe.label}`, bg: '#cac9cb', color: '#000' },
        { text: orderTypeText, bg: '#cac9cb', color: '#000' },
        { text: 'ARM', bg: armBg, color: '#fff' },
        { text: '\u2715', bg: '#e0e0e0', color: '#000' },
      ]);

      // Order / market label
      if (p.orderLine) {
        const sections = [
          { text: sideText, bg: '#cac9cb', color: '#000' },
          { text: String(p.size), bg: sideBg, color: '#000' },
        ];
        if (!p.slLine) sections.push({ text: '+SL', bg: CLR_SL, color: '#000' });
        const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
        if (totalTpSize < p.size) sections.push({ text: '+TP', bg: '#00c805', color: '#000' });
        sections.push({ text: '\u2715', bg: '#e0e0e0', color: '#000' });
        p.orderLine.setLabel(sections);
      }

      // Rewire interaction after label rebuild
      setupPreviewInteraction(p.condLine, 'cond');
      if (p.orderLine) setupPreviewInteraction(p.orderLine, 'order');

      // In market mode, position labels side by side; in limit mode, reset to centered
      if (p.isMarket) {
        positionMarketLabel();
      } else {
        p.condLine.setLabelLeft(0.5);
      }
    }

    /** Position the market order label immediately to the right of the condition label */
    function positionMarketLabel() {
      const p = previewRef.current;
      if (!p || !p.isMarket || !p.condLine || !p.orderLine) return;
      const condLabelEl = p.condLine.getLabelEl();
      const orderLabelEl = p.orderLine.getLabelEl();
      if (!condLabelEl || !orderLabelEl) return;
      // Shift condition label left, keep market label to the right
      p.condLine.setLabelLeft(0.30);
      p.orderLine.setLabelLeft(0.65);
    }

    /** Make a cell look & feel clickable: pointer cursor, brighten on hover */
    function makeClickable(cell: HTMLDivElement) {
      cell.style.cursor = 'pointer';
      cell.style.transition = 'filter 0.15s';
      cell.addEventListener('mouseenter', () => { cell.style.filter = 'brightness(1.25)'; });
      cell.addEventListener('mouseleave', () => { cell.style.filter = 'brightness(1)'; });
    }

    function setupPreviewInteraction(line: PriceLevelLine, target: 'cond' | 'order') {
      const labelEl = line.getLabelEl();
      const cells = line.getCells();
      if (!labelEl) return;

      labelEl.style.pointerEvents = 'auto';
      labelEl.style.cursor = 'grab';

      if (target === 'cond') {
        for (const cell of cells) {
          // limit/market toggle button
          if (cell.textContent === 'limit' || cell.textContent === 'market') {
            makeClickable(cell);
            cell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              const p = previewRef.current;
              if (!p || !p.orderLine) return;
              if (!p.isMarket) {
                // Switch to market: move order label next to condition label
                p.isMarket = true;
                p.isAbove = p.condPrice > p.orderPrice;
                p.orderPrice = p.condPrice;
                p.orderLine.setPrice(p.condPrice);
                // Destroy SL/TP (user can re-add relative to market label)
                p.slLine?.destroy();
                p.slLine = null;
                p.slPrice = null;
                for (const tp of p.tpLines) tp.line.destroy();
                p.tpLines = [];
              } else {
                // Switch to limit: show line again
                p.isMarket = false;
              }
              updatePreviewLabels();
            });
          }
          // ARM button
          if (cell.textContent === 'ARM') {
            makeClickable(cell);
            cell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              armCondition();
            });
          }
          // ✕ button — close preview
          if (cell.textContent === '\u2715') {
            makeClickable(cell);
            cell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              useStore.getState().setConditionPreview(false);
            });
          }
        }
      }

      if (target === 'order') {
        const p = previewRef.current;
        if (!p) return;

        // Market order label: not draggable
        if (p.isMarket) {
          labelEl.style.cursor = 'default';
        }

        // Size cell (index 1) — add +/- buttons
        const sizeCell = cells[1];
        if (sizeCell) {
          setupOrderSizeButtons(sizeCell);
        }

        // +SL / +TP / ✕ buttons
        for (const cell of cells) {
          if (cell.textContent === '+SL') {
            makeClickable(cell);
            cell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              addSlLine();
            });
          }
          if (cell.textContent === '+TP') {
            makeClickable(cell);
            cell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              addTpLine();
            });
          }
          if (cell.textContent === '\u2715') {
            makeClickable(cell);
            cell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (p.isMarket) {
                // Market mode: close preview
                useStore.getState().setConditionPreview(false);
              } else {
                // Limit mode: switch to market
                p.isMarket = true;
                p.isAbove = p.condPrice > p.orderPrice;
                p.orderPrice = p.condPrice;
                p.orderLine?.setPrice(p.condPrice);
                p.slLine?.destroy();
                p.slLine = null;
                p.slPrice = null;
                for (const tp of p.tpLines) tp.line.destroy();
                p.tpLines = [];
                updatePreviewLabels();
              }
            });
          }
        }
      }

      // Drag start (market order label is not draggable)
      labelEl.addEventListener('mousedown', (e) => {
        // Skip button clicks
        const t = e.target as HTMLElement;
        if (t.textContent === 'ARM' || t.textContent === 'limit' || t.textContent === 'market' || t.textContent === '+SL' || t.textContent === '+TP' || t.textContent === '\u2715') return;
        if (t.textContent === '+' || t.textContent === '\u2212') return;
        // Market order tracks last price — not draggable
        if (target === 'order' && previewRef.current?.isMarket) return;

        e.preventDefault();
        const p = previewRef.current;
        if (!p) return;
        const price = target === 'cond' ? p.condPrice : p.orderPrice;
        previewDragRef.current = { target, startY: e.clientY, originalPrice: price };
        labelEl.style.cursor = 'grabbing';
        if (container) container.style.cursor = 'grabbing';
        if (chart) chart.applyOptions({ handleScroll: false, handleScale: false });
      });
    }

    /** Update the count text inside a size cell without destroying +/- buttons */
    function updateLineSizeCell(line: PriceLevelLine, cellIdx: number, size: number) {
      const cells = line.getCells();
      updateSizeCellCount(cells, cellIdx, size);
    }

    /** Sync SL/TP after order size changes — SL tracks order size, TPs keep their own sizes */
    function syncBracketSizes() {
      const p = previewRef.current;
      if (!p) return;
      // SL always matches order size
      if (p.slLine && p.slPrice != null) {
        updateLineSizeCell(p.slLine, 1, p.size);
        const txt = slPnlText(p.orderPrice, p.slPrice, p.size, p.isAbove);
        p.slLine.updateSection(0, txt, CLR_SL, '#000');
      }
      // TPs: only recalc PnL, don't change their individual sizes
      for (const tp of p.tpLines) {
        const txt = tpPnlText(p.orderPrice, tp.price, tp.size, p.isAbove);
        tp.line.updateSection(0, txt, CLR_TP, '#000');
      }
      // Rebuild order label to show/hide +TP based on remaining room
      updatePreviewLabels();
    }

    function setupOrderSizeButtons(sizeCell: HTMLDivElement) {
      const p = previewRef.current;
      if (!p) return;

      const kit = installSizeButtons(sizeCell, {
        initialCount: p.size,
        normalBg: p.isAbove ? CLR_BUY : CLR_SELL,
        hoverBg: p.isAbove ? BUY_HOVER : SELL_HOVER,
        onMinus: () => {
          const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
          if (p.size <= 1 || p.size <= totalTpSize) return;
          p.size--;
          kit.setCount(p.size);
          syncBracketSizes();
        },
        onPlus: () => {
          p.size++;
          kit.setCount(p.size);
          syncBracketSizes();
        },
        isMinDisabled: () => {
          const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
          return p.size <= 1 || p.size <= totalTpSize;
        },
      });
    }

    /** Wire +/- size buttons on the SL line's size cell (tracks order size) */
    function setupSlSizeButtons(sizeCell: HTMLDivElement) {
      const p = previewRef.current;
      if (!p) return;

      const kit = installSizeButtons(sizeCell, {
        initialCount: p.size,
        normalBg: CLR_SL,
        hoverBg: SELL_HOVER,
        onMinus: () => {
          const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
          if (p.size <= 1 || p.size <= totalTpSize) return;
          p.size--;
          kit.setCount(p.size);
          syncBracketSizes();
        },
        onPlus: () => {
          p.size++;
          kit.setCount(p.size);
          syncBracketSizes();
        },
        isMinDisabled: () => {
          const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
          return p.size <= 1 || p.size <= totalTpSize;
        },
      });
    }

    /** Wire +/- size buttons on a TP line's size cell (independent TP size) */
    function setupTpSizeButtons(sizeCell: HTMLDivElement, tpEntry: { line: PriceLevelLine; price: number; size: number }) {
      const p = previewRef.current;
      if (!p) return;

      const kit = installSizeButtons(sizeCell, {
        initialCount: tpEntry.size,
        normalBg: CLR_TP,
        hoverBg: BUY_HOVER,
        onMinus: () => {
          if (tpEntry.size <= 1) return;
          tpEntry.size--;
          kit.setCount(tpEntry.size);
          const txt = tpPnlText(p.orderPrice, tpEntry.price, tpEntry.size, p.isAbove);
          tpEntry.line.updateSection(0, txt, CLR_TP, '#000');
          updatePreviewLabels();
        },
        onPlus: () => {
          const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
          if (totalTpSize >= p.size) return;
          tpEntry.size++;
          kit.setCount(tpEntry.size);
          const txt = tpPnlText(p.orderPrice, tpEntry.price, tpEntry.size, p.isAbove);
          tpEntry.line.updateSection(0, txt, CLR_TP, '#000');
          updatePreviewLabels();
        },
        isMinDisabled: () => tpEntry.size <= 1,
        isPlusDisabled: () => p.tpLines.reduce((s, t) => s + t.size, 0) >= p.size,
      });
    }

    function slPnlText(orderPrice: number, slPrice: number, size: number, isAbove: boolean): string {
      return formatSlPnl(orderPrice, slPrice, size, isAbove, contract!);
    }

    function tpPnlText(orderPrice: number, tpPrice: number, size: number, isAbove: boolean): string {
      return formatTpPnl(orderPrice, tpPrice, size, isAbove, contract!);
    }

    function addSlLine() {
      const p = previewRef.current;
      if (!p || p.slLine || !series || !overlay || !chart) return;

      const isAbove = p.isAbove;
      // SL on opposite side of order from condition
      const slOffset = tickSize * 15;
      const slPrice = isAbove
        ? Math.round((p.orderPrice - slOffset) / tickSize) * tickSize
        : Math.round((p.orderPrice + slOffset) / tickSize) * tickSize;

      const pnlTxt = slPnlText(p.orderPrice, slPrice, p.size, isAbove);

      const slLine = new PriceLevelLine({
        price: slPrice, series, overlay, chartApi: chart,
        lineColor: CLR_SL, lineStyle: 'dashed', lineWidth: 1,
        axisLabelVisible: true, tickSize,
        label: [
          { text: pnlTxt, bg: CLR_SL, color: '#000' },
          { text: String(p.size), bg: CLR_SL, color: '#000' },
          { text: '\u2715', bg: '#e0e0e0', color: '#000' },
        ],
      });

      p.slLine = slLine;
      p.slPrice = slPrice;

      const slLabel = slLine.getLabelEl();
      const slCells = slLine.getCells();
      if (slLabel) {
        slLabel.style.pointerEvents = 'auto';
        slLabel.style.cursor = 'grab';

        // +/- size buttons on size cell
        if (slCells[1]) setupSlSizeButtons(slCells[1]);

        // ✕ to remove
        if (slCells[2]) {
          slCells[2].style.cursor = 'pointer';
          slCells[2].addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            p.slLine?.destroy();
            p.slLine = null;
            p.slPrice = null;
            updatePreviewLabels();
          });
        }

        // Drag
        slLabel.addEventListener('mousedown', (e) => {
          const t = e.target as HTMLElement;
          if (t.textContent === '+' || t.textContent === '\u2212') return;
          if (e.target === slCells[2] || slCells[2]?.contains(e.target as Node)) return;
          e.preventDefault();
          previewDragRef.current = { target: 'sl', startY: e.clientY, originalPrice: slPrice };
          slLabel.style.cursor = 'grabbing';
          if (container) container.style.cursor = 'grabbing';
          chart.applyOptions({ handleScroll: false, handleScale: false });
        });
      }

      updatePreviewLabels();
    }

    function addTpLine() {
      const p = previewRef.current;
      if (!p || !series || !overlay || !chart) return;

      const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
      const remaining = p.size - totalTpSize;
      if (remaining <= 0) return;

      const isAbove = p.isAbove;
      // Offset each TP further from order price
      const tpOffset = tickSize * (30 + p.tpLines.length * 15);
      const tpPrice = isAbove
        ? Math.round((p.orderPrice + tpOffset) / tickSize) * tickSize
        : Math.round((p.orderPrice - tpOffset) / tickSize) * tickSize;

      const tpSize = remaining;
      const pnlTxt = tpPnlText(p.orderPrice, tpPrice, tpSize, isAbove);

      const tpLine = new PriceLevelLine({
        price: tpPrice, series, overlay, chartApi: chart,
        lineColor: CLR_TP, lineStyle: 'dashed', lineWidth: 1,
        axisLabelVisible: true, tickSize,
        label: [
          { text: pnlTxt, bg: CLR_TP, color: '#000' },
          { text: String(tpSize), bg: CLR_TP, color: '#000' },
          { text: '\u2715', bg: '#e0e0e0', color: '#000' },
        ],
      });

      const tpEntry = { line: tpLine, price: tpPrice, size: tpSize };
      p.tpLines.push(tpEntry);
      const tpIndex = p.tpLines.length - 1;

      const tpLabel = tpLine.getLabelEl();
      const tpCells = tpLine.getCells();
      if (tpLabel) {
        tpLabel.style.pointerEvents = 'auto';
        tpLabel.style.cursor = 'grab';

        // +/- size buttons on size cell
        if (tpCells[1]) setupTpSizeButtons(tpCells[1], tpEntry);

        if (tpCells[2]) {
          tpCells[2].style.cursor = 'pointer';
          tpCells[2].addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            tpEntry.line.destroy();
            const idx = p.tpLines.indexOf(tpEntry);
            if (idx >= 0) p.tpLines.splice(idx, 1);
            updatePreviewLabels();
          });
        }

        tpLabel.addEventListener('mousedown', (e) => {
          const t = e.target as HTMLElement;
          if (t.textContent === '+' || t.textContent === '\u2212') return;
          if (e.target === tpCells[2] || tpCells[2]?.contains(e.target as Node)) return;
          e.preventDefault();
          previewDragRef.current = { target: 'tp', startY: e.clientY, originalPrice: tpPrice, tpIndex };
          tpLabel.style.cursor = 'grabbing';
          if (container) container.style.cursor = 'grabbing';
          chart.applyOptions({ handleScroll: false, handleScale: false });
        });
      }

      updatePreviewLabels();
    }

    function armCondition() {
      const p = previewRef.current;
      if (!p) return;
      const st = useStore.getState();
      const url = st.conditionServerUrl;
      if (!url || !st.activeAccountId || !contract) return;

      const isAbove = p.isAbove;
      const conditionType = isAbove ? 'closes_above' : 'closes_below';
      const orderSide = isAbove ? 'buy' : 'sell';

      // Build bracket from SL/TP lines or preset
      let bracket: CreateConditionInput['bracket'];
      const activePreset = st.bracketPresets.find((pr) => pr.id === st.activePresetId);
      if (activePreset) {
        const bc = activePreset.config;
        bracket = {
          enabled: true,
          sl: bc.stopLoss.points > 0 ? { points: bc.stopLoss.points } : undefined,
          tp: bc.takeProfits.length > 0 ? [{ points: bc.takeProfits[0].points }] : undefined,
        };
      } else if (p.slPrice != null || p.tpLines.length > 0) {
        const refPrice = p.isMarket ? (st.lastPrice ?? p.orderPrice) : p.orderPrice;
        const slPoints = p.slPrice != null
          ? Math.abs(refPrice - p.slPrice) / contract.tickSize * contract.tickSize
          : undefined;
        const tpArr = p.tpLines
          .filter((t) => t.size > 0)
          .map((t) => ({
            points: Math.abs(t.price - refPrice) / contract.tickSize * contract.tickSize,
            size: t.size,
          }))
          .filter((t) => t.points > 0);
        bracket = {
          enabled: true,
          sl: slPoints != null && slPoints > 0 ? { points: slPoints } : undefined,
          tp: tpArr.length > 0 ? tpArr : undefined,
        };
      }

      const payload: CreateConditionInput = {
        contractId: String(contract.id),
        contractTickSize: contract.tickSize,
        conditionType,
        triggerPrice: p.condPrice,
        timeframe: timeframe.label,
        orderSide,
        orderType: p.isMarket ? 'market' : 'limit',
        orderPrice: p.isMarket ? undefined : p.orderPrice,
        orderSize: p.size,
        accountId: st.activeAccountId,
        bracket,
      };

      conditionService.create(url, payload)
        .then((created) => {
          useStore.getState().upsertCondition(created);
          showToast('success', 'Condition armed', `${conditionType} @ ${p.condPrice}`);
          // Turn off preview after arming
          useStore.getState().setConditionPreview(false);
        })
        .catch((err) => {
          showToast('error', 'Failed to arm condition', errorMessage(err));
        });
    }

    return () => {
      destroyPreview();
    };
  }, [conditionPreview, contract, conditionServerUrl, timeframe, refs]);

  // =====================================================================
  // EFFECT 4: Preview drag handling
  // =====================================================================
  useEffect(() => {
    const container = refs.container.current;
    const series = refs.series.current;
    const chart = refs.chart.current;
    if (!container || !series || !chart || !contract) return;

    const tickSize = contract.tickSize;

    function onMouseMove(e: MouseEvent) {
      const drag = previewDragRef.current;
      const p = previewRef.current;
      if (!drag || !p) return;

      const rect = container!.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const rawPrice = series!.coordinateToPrice(y);
      if (rawPrice === null) return;
      const snapped = Math.round(rawPrice / tickSize) * tickSize;

      if (drag.target === 'cond' && p.condLine) {
        p.condPrice = snapped;
        p.condLine.setPrice(snapped);
        p.condLine.syncPosition();
        // In market mode, order label rides alongside the condition label
        if (p.isMarket && p.orderLine) {
          p.orderPrice = snapped;
          p.orderLine.setPrice(snapped);
          p.orderLine.syncPosition();
          // Update SL/TP PnL since reference price moved
          if (p.slLine && p.slPrice != null && contract) {
            const slDiff = p.isAbove ? p.slPrice - snapped : snapped - p.slPrice;
            const slPnl = calcPnl(slDiff, contract, p.size);
            p.slLine.updateSection(0, `-$${Math.abs(slPnl).toFixed(2)}`, CLR_SL, '#000');
          }
          for (const tp of p.tpLines) {
            const tpDiff = p.isAbove ? tp.price - snapped : snapped - tp.price;
            const tpPnl = calcPnl(tpDiff, contract!, tp.size);
            tp.line.updateSection(0, `+$${Math.abs(tpPnl).toFixed(2)}`, CLR_TP, '#000');
          }
        }
      } else if (drag.target === 'order' && p.orderLine) {
        p.orderPrice = snapped;
        p.orderLine.setPrice(snapped);
        p.orderLine.syncPosition();
        // Update SL/TP PnL since reference price moved
        if (p.slLine && p.slPrice != null && contract) {
          const slDiff = p.isAbove ? p.slPrice - snapped : snapped - p.slPrice;
          const slPnl = calcPnl(slDiff, contract, p.size);
          p.slLine.updateSection(0, `-$${Math.abs(slPnl).toFixed(2)}`, CLR_SL, '#000');
        }
        for (const tp of p.tpLines) {
          const tpDiff = p.isAbove ? tp.price - snapped : snapped - tp.price;
          const tpPnl = calcPnl(tpDiff, contract!, tp.size);
          tp.line.updateSection(0, `+$${Math.abs(tpPnl).toFixed(2)}`, CLR_TP, '#000');
        }
      }

      // Flip condition type when order/cond lines cross each other (limit only)
      if ((drag.target === 'cond' || drag.target === 'order') && !p.isMarket) {
        const shouldBeAbove = p.condPrice > p.orderPrice;
        if (shouldBeAbove !== p.isAbove) {
          p.isAbove = shouldBeAbove;
          // Update condition line visuals
          const armBg = p.isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW;
          p.condLine?.setLineColor(p.isAbove ? CLR_ABOVE : CLR_BELOW);
          p.condLine?.updateSection(0, p.isAbove ? '\u25B2' : '\u25BC', armBg, '#fff');
          p.condLine?.updateSection(1, `If Close ${p.isAbove ? 'Above' : 'Below'} ${timeframe.label}`, '#cac9cb', '#000');
          p.condLine?.updateSection(3, 'ARM', armBg, '#fff');
          // Update order line visuals (bg only on size cell to preserve +/- buttons)
          const sideBg = p.isAbove ? CLR_BUY : CLR_SELL;
          if (!p.isMarket) p.orderLine?.setLineColor(sideBg);
          const orderWord = p.isMarket ? 'Market' : 'Limit';
          p.orderLine?.updateSection(0, `${p.isAbove ? 'Buy' : 'Sell'} ${orderWord}`, '#cac9cb', '#000');
          p.orderLine?.updateSection(1, undefined, sideBg);
          // Update SL/TP PnL since direction flipped
          if (p.slLine && p.slPrice != null) {
            const slDiff = p.isAbove ? p.slPrice - p.orderPrice : p.orderPrice - p.slPrice;
            const slPnl = calcPnl(slDiff, contract!, p.size);
            p.slLine.updateSection(0, `-$${Math.abs(slPnl).toFixed(2)}`, CLR_SL, '#000');
          }
          for (const tp of p.tpLines) {
            const tpDiff = p.isAbove ? tp.price - p.orderPrice : p.orderPrice - tp.price;
            const tpPnl = calcPnl(tpDiff, contract!, tp.size);
            tp.line.updateSection(0, `+$${Math.abs(tpPnl).toFixed(2)}`, CLR_TP, '#000');
          }
        }
      }

      if (drag.target === 'sl' && p.slLine) {
        p.slPrice = snapped;
        p.slLine.setPrice(snapped);
        p.slLine.syncPosition();
        // Update PnL label
        if (contract) {
          const diff = p.isAbove ? snapped - p.orderPrice : p.orderPrice - snapped;
          const pnl = calcPnl(diff, contract, p.size);
          p.slLine.updateSection(0, `-$${Math.abs(pnl).toFixed(2)}`, CLR_SL, '#000');
        }
      } else if (drag.target === 'tp' && drag.tpIndex != null) {
        const tpEntry = p.tpLines[drag.tpIndex];
        if (tpEntry) {
          tpEntry.price = snapped;
          tpEntry.line.setPrice(snapped);
          tpEntry.line.syncPosition();
          if (contract) {
            const diff = p.isAbove ? snapped - p.orderPrice : p.orderPrice - snapped;
            const pnl = calcPnl(diff, contract, tpEntry.size);
            tpEntry.line.updateSection(0, `+$${Math.abs(pnl).toFixed(2)}`, CLR_TP, '#000');
          }
        }
      }
    }

    function onMouseUp(_e: MouseEvent) {
      const drag = previewDragRef.current;
      if (!drag) return;
      previewDragRef.current = null;

      container!.style.cursor = '';
      chart!.applyOptions({ handleScroll: true, handleScale: true });

      const p = previewRef.current;
      if (!p) return;

      // Restore cursor on the dragged line
      let line: PriceLevelLine | null = null;
      if (drag.target === 'tp' && drag.tpIndex != null) {
        line = p.tpLines[drag.tpIndex]?.line ?? null;
      } else {
        const lineMap: Record<string, PriceLevelLine | null> = { cond: p.condLine, order: p.orderLine, sl: p.slLine };
        line = lineMap[drag.target] ?? null;
      }
      const labelEl = line?.getLabelEl();
      if (labelEl) labelEl.style.cursor = 'grab';
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [contract, timeframe, refs]);

  // =====================================================================
  // EFFECT 5: Sync all line positions on scroll / zoom / price changes
  // =====================================================================
  useEffect(() => {
    const chart = refs.chart.current;
    const container = refs.container.current;
    if (!chart || !container) return;

    function sync() {
      for (const line of linesRef.current) line.syncPosition();
      const p = previewRef.current;
      if (p) {
        p.condLine?.syncPosition();
        p.orderLine?.syncPosition();
        p.slLine?.syncPosition();
        for (const tp of p.tpLines) tp.line.syncPosition();
      }
    }

    chart.timeScale().subscribeVisibleLogicalRangeChange(sync);
    const ro = new ResizeObserver(sync);
    ro.observe(container);
    container.addEventListener('wheel', sync, { passive: true });

    let prevLp = useStore.getState().lastPrice;
    const unsub = useStore.subscribe((state) => {
      if (state.lastPrice !== prevLp) {
        prevLp = state.lastPrice;
        sync();
      }
    });

    let rafId = 0;
    function rafLoop() { sync(); rafId = requestAnimationFrame(rafLoop); }
    function onPointerDown() { cancelAnimationFrame(rafId); rafLoop(); }
    function onPointerUp() { cancelAnimationFrame(rafId); rafId = 0; }
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(sync);
      ro.disconnect();
      container.removeEventListener('wheel', sync);
      unsub();
      cancelAnimationFrame(rafId);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [refs]);
}
