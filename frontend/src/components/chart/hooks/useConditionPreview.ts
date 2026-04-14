import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { resolveConditionServerUrl } from '../../../store/slices/conditionsSlice';
import { conditionService } from '../../../services/conditionService';
import type { CreateConditionInput } from '../../../services/conditionService';
import { PriceLevelLine } from '../PriceLevelLine';
import type { ChartRefs } from './types';
import { showToast, errorMessage } from '../../../utils/toast';
import {
  installSizeButtons, formatSlPnl, formatTpPnl,
  updateSizeCellCount, BUY_HOVER, SELL_HOVER,
  LABEL_BG, LABEL_TEXT, CLOSE_BG, BUY_COLOR, wireCloseHover,
} from './labelUtils';
import { snapToTickSize } from '../barUtils';
import { calcPnl } from '../../../utils/instrument';
import type { PreviewState, PreviewDragState } from './conditionLineTypes';
import {
  CLR_ABOVE, CLR_BELOW, CLR_BUY, CLR_SELL,
  CLR_ARM_ABOVE, CLR_ARM_BELOW, CLR_SL, CLR_TP,
} from './conditionLineTypes';

/**
 * Effect 3: Preview mode — creates/destroys the preview lines for quick
 * condition creation. Handles all interaction (ARM, +SL, +TP, size buttons,
 * limit/market toggle, direction flip).
 */
export function useConditionPreview(
  refs: ChartRefs,
  contract: Contract | null,
  timeframe: Timeframe,
  conditionPreview: boolean,
  conditionServerUrl: string,
  previewRef: React.MutableRefObject<PreviewState | null>,
  previewDragRef: React.MutableRefObject<PreviewDragState | null>,
): void {
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

    if (!conditionPreview || !series || !overlay || !chart || !container || !contract) {
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
    const condPrice = snapToTickSize(lastP + offset, tickSize);
    const orderPrice = snapToTickSize(lastP - offset, tickSize);
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

      const armBg = isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW;
      const orderTypeText = p.isMarket ? 'market' : 'limit';

      p.condLine.setLabel([
        { text: arrowChar, bg: armBg, color: '#fff' },
        { text: `${condText} ${timeframe.label}`, bg: LABEL_BG, color: LABEL_TEXT },
        { text: orderTypeText, bg: LABEL_BG, color: LABEL_TEXT },
        { text: 'ARM', bg: armBg, color: '#fff' },
        { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT },
      ]);

      // Order / market label
      if (p.orderLine) {
        const sections = [
          { text: sideText, bg: LABEL_BG, color: LABEL_TEXT },
          { text: String(p.size), bg: sideBg, color: LABEL_TEXT },
        ];
        if (!p.slLine) sections.push({ text: '+SL', bg: CLR_SL, color: LABEL_TEXT });
        const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
        if (totalTpSize < p.size) sections.push({ text: '+TP', bg: BUY_COLOR, color: LABEL_TEXT });
        sections.push({ text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT });
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

    function positionMarketLabel() {
      const p = previewRef.current;
      if (!p || !p.isMarket || !p.condLine || !p.orderLine) return;
      p.condLine.setLabelLeft(0.30);
      p.orderLine.setLabelLeft(0.65);
    }

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
          if (cell.textContent === 'limit' || cell.textContent === 'market') {
            makeClickable(cell);
            cell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              const p = previewRef.current;
              if (!p || !p.orderLine) return;
              if (!p.isMarket) {
                p.isMarket = true;
                p.isAbove = p.condPrice > p.orderPrice;
                p.orderPrice = p.condPrice;
                p.orderLine.setPrice(p.condPrice);
                p.slLine?.destroy();
                p.slLine = null;
                p.slPrice = null;
                for (const tp of p.tpLines) tp.line.destroy();
                p.tpLines = [];
              } else {
                p.isMarket = false;
              }
              updatePreviewLabels();
            });
          }
          if (cell.textContent === 'ARM') {
            makeClickable(cell);
            cell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              armCondition();
            });
          }
          if (cell.textContent === '\u2715') {
            cell.style.cursor = 'pointer';
            wireCloseHover(cell);
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

        if (p.isMarket) {
          labelEl.style.cursor = 'default';
          const sideCell = cells[0];
          if (sideCell) {
            makeClickable(sideCell);
            sideCell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              const p = previewRef.current;
              if (!p) return;
              p.isAbove = !p.isAbove;
              updatePreviewLabels();
            });
          }
        }

        const sizeCell = cells[1];
        if (sizeCell) {
          setupOrderSizeButtons(sizeCell);
        }

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
            cell.style.cursor = 'pointer';
            wireCloseHover(cell);
            cell.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (p.isMarket) {
                useStore.getState().setConditionPreview(false);
              } else {
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

      // Drag start
      labelEl.addEventListener('mousedown', (e) => {
        const t = e.target as HTMLElement;
        if (t.textContent === 'ARM' || t.textContent === 'limit' || t.textContent === 'market' || t.textContent === '+SL' || t.textContent === '+TP' || t.textContent === '\u2715') return;
        if (t.textContent === '+' || t.textContent === '\u2212') return;
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

    function updateLineSizeCell(line: PriceLevelLine, cellIdx: number, size: number) {
      const cells = line.getCells();
      updateSizeCellCount(cells, cellIdx, size);
    }

    function syncBracketSizes() {
      const p = previewRef.current;
      if (!p) return;
      if (p.slLine && p.slPrice != null) {
        updateLineSizeCell(p.slLine, 1, p.size);
        const txt = slPnlText(p.orderPrice, p.slPrice, p.size, p.isAbove);
        p.slLine.updateSection(0, txt, CLR_SL, LABEL_TEXT);
      }
      for (const tp of p.tpLines) {
        const txt = tpPnlText(p.orderPrice, tp.price, tp.size, p.isAbove);
        tp.line.updateSection(0, txt, CLR_TP, LABEL_TEXT);
      }
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
          tpEntry.line.updateSection(0, txt, CLR_TP, LABEL_TEXT);
          updatePreviewLabels();
        },
        onPlus: () => {
          const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
          if (totalTpSize >= p.size) return;
          tpEntry.size++;
          kit.setCount(tpEntry.size);
          const txt = tpPnlText(p.orderPrice, tpEntry.price, tpEntry.size, p.isAbove);
          tpEntry.line.updateSection(0, txt, CLR_TP, LABEL_TEXT);
          updatePreviewLabels();
        },
        isMinDisabled: () => tpEntry.size <= 1,
        isPlusDisabled: () => p.tpLines.reduce((s, t) => s + t.size, 0) >= p.size,
      });
    }

    function slPnlText(orderPr: number, slPr: number, sz: number, isAbv: boolean): string {
      return formatSlPnl(orderPr, slPr, sz, isAbv, contract!);
    }

    function tpPnlText(orderPr: number, tpPr: number, sz: number, isAbv: boolean): string {
      return formatTpPnl(orderPr, tpPr, sz, isAbv, contract!);
    }

    function addSlLine() {
      const p = previewRef.current;
      if (!p || p.slLine || !series || !overlay || !chart) return;

      const isAbove = p.isAbove;
      const slOffset = tickSize * 15;
      const slPrice = isAbove
        ? snapToTickSize(p.orderPrice - slOffset, tickSize)
        : snapToTickSize(p.orderPrice + slOffset, tickSize);

      const pnlTxt = slPnlText(p.orderPrice, slPrice, p.size, isAbove);

      const slLine = new PriceLevelLine({
        price: slPrice, series, overlay, chartApi: chart,
        lineColor: CLR_SL, lineStyle: 'dashed', lineWidth: 1,
        axisLabelVisible: true, tickSize,
        label: [
          { text: pnlTxt, bg: CLR_SL, color: LABEL_TEXT },
          { text: String(p.size), bg: CLR_SL, color: LABEL_TEXT },
          { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT },
        ],
      });

      p.slLine = slLine;
      p.slPrice = slPrice;

      const slLabel = slLine.getLabelEl();
      const slCells = slLine.getCells();
      if (slLabel) {
        slLabel.style.pointerEvents = 'auto';
        slLabel.style.cursor = 'grab';

        if (slCells[1]) setupSlSizeButtons(slCells[1]);

        if (slCells[2]) {
          slCells[2].style.cursor = 'pointer';
          wireCloseHover(slCells[2]);
          slCells[2].addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            p.slLine?.destroy();
            p.slLine = null;
            p.slPrice = null;
            updatePreviewLabels();
          });
        }

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
      const tpOffset = tickSize * (30 + p.tpLines.length * 15);
      const tpPrice = isAbove
        ? snapToTickSize(p.orderPrice + tpOffset, tickSize)
        : snapToTickSize(p.orderPrice - tpOffset, tickSize);

      const tpSize = remaining;
      const pnlTxt = tpPnlText(p.orderPrice, tpPrice, tpSize, isAbove);

      const tpLine = new PriceLevelLine({
        price: tpPrice, series, overlay, chartApi: chart,
        lineColor: CLR_TP, lineStyle: 'dashed', lineWidth: 1,
        axisLabelVisible: true, tickSize,
        label: [
          { text: pnlTxt, bg: CLR_TP, color: LABEL_TEXT },
          { text: String(tpSize), bg: CLR_TP, color: LABEL_TEXT },
          { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT },
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

        if (tpCells[1]) setupTpSizeButtons(tpCells[1], tpEntry);

        if (tpCells[2]) {
          tpCells[2].style.cursor = 'pointer';
          wireCloseHover(tpCells[2]);
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
      const url = resolveConditionServerUrl(st.conditionServerUrl);
      if (!st.activeAccountId || !contract) return;

      const isAbove = p.isAbove;
      const conditionType = isAbove ? 'closes_above' : 'closes_below';
      const orderSide = isAbove ? 'buy' : 'sell';

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
          useStore.getState().setConditionPreview(false);
        })
        .catch((err) => {
          showToast('error', 'Failed to arm condition', errorMessage(err));
        });
    }

    return () => {
      destroyPreview();
    };
  }, [conditionPreview, contract, conditionServerUrl, timeframe, refs, previewRef, previewDragRef]);
}
