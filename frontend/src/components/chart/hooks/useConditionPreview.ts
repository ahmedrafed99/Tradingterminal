import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { resolveConditionServerUrl } from '../../../store/slices/conditionsSlice';
import { conditionService } from '../../../services/conditionService';
import type { CreateConditionInput } from '../../../services/conditionService';
import { PriceLevelPrimitive } from '../primitives/PriceLevelPrimitive';
import type { ChartRefs } from './types';
import { showToast, errorMessage } from '../../../utils/toast';
import {
  formatSlPnl, formatTpPnl,
  BUY_HOVER, SELL_HOVER,
  LABEL_BG, LABEL_TEXT, CLOSE_BG, BUY_COLOR,
} from './labelUtils';
import { snapToTickSize } from '../barUtils';
import { pointsToPrice } from '../../../utils/instrument';
import type { PreviewState } from './conditionLineTypes';
import { resolvePreviewConfig, fitTpsToOrderSize } from './resolvePreviewConfig';
import {
  CLR_ABOVE, CLR_BELOW, CLR_BUY, CLR_SELL,
  CLR_ARM_ABOVE, CLR_ARM_BELOW, CLR_SL, CLR_TP,
} from './conditionLineTypes';

const CLOSE_BG_HOVER = '#c0392b';

/**
 * Effect 3: Preview mode — creates/destroys the preview lines for quick
 * condition creation. Handles all interaction (ARM, +SL, +TP, size buttons,
 * limit/market toggle, direction flip).
 *
 * Drag is handled by PriceLevelPrimitive built-in callbacks.
 * No DOM event listeners; no syncPosition calls.
 */
export function useConditionPreview(
  refs: ChartRefs,
  contract: Contract | null,
  timeframe: Timeframe,
  conditionPreview: boolean,
  conditionServerUrl: string,
  previewRef: React.MutableRefObject<PreviewState | null>,
): void {
  useEffect(() => {
    const series = refs.series.current;
    const container = refs.container.current;

    function attach(prim: PriceLevelPrimitive): PriceLevelPrimitive {
      series!.attachPrimitive(prim);
      prim.setChartElement(container!);
      return prim;
    }

    function detach(prim: PriceLevelPrimitive | null): void {
      if (prim) series!.detachPrimitive(prim);
    }

    function destroyPreview() {
      const p = previewRef.current;
      if (!p) return;
      detach(p.condLine);
      detach(p.orderLine);
      detach(p.slLine);
      for (const tp of p.tpLines) detach(tp.line);
      previewRef.current = null;
    }

    if (!conditionPreview || !series || !container || !contract) {
      destroyPreview();
      return;
    }

    if (previewRef.current) return;

    const tickSize = contract.tickSize;
    const st = useStore.getState();
    const lastP = st.lastPrice ?? refs.lastBar.current?.close;
    if (!lastP) { destroyPreview(); return; }

    const offset = tickSize * 20;
    const condPrice = snapToTickSize(lastP + offset, tickSize);
    const orderPrice = snapToTickSize(lastP - offset, tickSize);
    const size = st.orderSize;

    // ── Build primitive helpers ──────────────────────────────────────

    function makeCondLine(p: PreviewState): PriceLevelPrimitive {
      const isAbove = p.isAbove;
      const armBg = isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW;
      const condText = isAbove ? `If Close Above ${timeframe.label}` : `If Close Below ${timeframe.label}`;
      const orderTypeText = p.isMarket ? 'market' : 'limit';
      return attach(new PriceLevelPrimitive({
        price: p.condPrice,
        lineColor: isAbove ? CLR_ABOVE : CLR_BELOW,
        lineStyle: 'dashed',
        lineWidth: 1,
        priceLabel: { visible: true, tickSize },
        labelFraction: p.isMarket ? 0.30 : undefined,
        cellOrder: ['arrow', 'label', 'type', 'arm', 'close'],
        cells: {
          arrow:  { text: isAbove ? '▲' : '▼', bg: armBg, color: '#fff' },
          label:  { text: condText, bg: LABEL_BG, color: LABEL_TEXT },
          type:   { text: orderTypeText, bg: LABEL_BG, color: LABEL_TEXT,
                    hoverBg: '#b0afb1', onClick: () => toggleMarketMode() },
          arm:    { text: 'ARM', bg: armBg, color: '#fff',
                    onClick: () => armCondition() },
          close:  { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT,
                    hoverBg: CLOSE_BG_HOVER,
                    onClick: () => useStore.getState().setConditionPreview(false) },
        },
        onDrag: (price) => {
          const p2 = previewRef.current;
          if (!p2) return;
          const snapped = snapToTickSize(price, tickSize);
          p2.condPrice = snapped;
          if (p2.isMarket && p2.orderLine) {
            p2.orderPrice = snapped;
            p2.orderLine.setPrice(snapped);
            updateBracketPnl(p2, snapped);
          }
          if (!p2.isMarket) flipDirectionIfCrossed(p2);
        },
        onDragEnd: () => {
          const p2 = previewRef.current;
          if (!p2) return;
          const snapped = snapToTickSize(p2.condLine!.getPrice(), tickSize);
          p2.condPrice = snapped;
          if (p2.isMarket) {
            p2.orderPrice = snapped;
          }
        },
      }));
    }

    function makeOrderLine(p: PreviewState): PriceLevelPrimitive {
      return buildOrderLine(p);
    }

    function buildOrderLine(p: PreviewState): PriceLevelPrimitive {
      const isAbove = p.isAbove;
      const sideBg = isAbove ? CLR_BUY : CLR_SELL;
      const sideLabel = isAbove ? (p.isMarket ? 'Buy Market' : 'Buy Limit') : (p.isMarket ? 'Sell Market' : 'Sell Limit');
      const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);

      const cellOrder = ['side', 'size'];
      if (!p.slLine) cellOrder.push('addSl');
      if (totalTpSize < p.size) cellOrder.push('addTp');
      cellOrder.push('close');

      const minusDisabled = p.size <= 1 || p.size <= totalTpSize;
      const plusDisabled = false;

      const prim = attach(new PriceLevelPrimitive({
        price: p.orderPrice,
        lineColor: sideBg,
        lineStyle: 'dashed',
        lineWidth: p.isMarket ? 0 : 1,
        priceLabel: { visible: !p.isMarket, tickSize },
        labelFraction: p.isMarket ? 0.65 : undefined,
        cellOrder,
        cells: {
          side:  { text: sideLabel, bg: LABEL_BG, color: LABEL_TEXT,
                   ...(p.isMarket ? { hoverBg: '#b0afb1', onClick: () => flipDirection() } : {}) },
          size:  { text: String(p.size), bg: sideBg, color: LABEL_TEXT,
                   leftText: '−', leftColor: minusDisabled ? 'transparent' : LABEL_TEXT,
                   leftClick: () => decrementSize(),
                   rightText: '+', rightColor: plusDisabled ? 'transparent' : LABEL_TEXT,
                   rightClick: () => incrementSize() },
          addSl: { text: '+SL', bg: CLR_SL, color: LABEL_TEXT,
                   hoverBg: SELL_HOVER, onClick: () => addSlLine() },
          addTp: { text: '+TP', bg: BUY_COLOR, color: LABEL_TEXT,
                   hoverBg: BUY_HOVER, onClick: () => addTpLine() },
          close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT,
                   hoverBg: CLOSE_BG_HOVER,
                   onClick: () => {
                     const p2 = previewRef.current;
                     if (!p2) return;
                     if (p2.isMarket) {
                       useStore.getState().setConditionPreview(false);
                     } else {
                       // Remove limit order line — switch to market mode
                       p2.isMarket = true;
                       p2.isAbove = p2.condPrice > p2.orderPrice;
                       p2.orderPrice = p2.condPrice;
                       detachAndRebuildOrderLine(p2);
                       updateCondLine(p2);
                     }
                   } },
        },
        ...(!p.isMarket ? {
          onDrag: (price) => {
            const p2 = previewRef.current;
            if (!p2) return;
            const snapped = snapToTickSize(price, tickSize);
            p2.orderPrice = snapped;
            updateBracketPnl(p2, snapped);
            flipDirectionIfCrossed(p2);
          },
          onDragEnd: () => {
            const p2 = previewRef.current;
            if (!p2) return;
            p2.orderPrice = snapToTickSize(p2.orderLine!.getPrice(), tickSize);
          },
        } : {}),
      }));
      return prim;
    }

    function makeSlLine(p: PreviewState, atPrice?: number): PriceLevelPrimitive {
      const isAbove = p.isAbove;
      const slOffset = tickSize * 15;
      const slPrice = atPrice ?? (isAbove
        ? snapToTickSize(p.orderPrice - slOffset, tickSize)
        : snapToTickSize(p.orderPrice + slOffset, tickSize));

      const pnlTxt = formatSlPnl(p.orderPrice, slPrice, p.size, isAbove, contract!);
      p.slPrice = slPrice;

      const minusDisabled = p.size <= 1 || p.size <= p.tpLines.reduce((s, t) => s + t.size, 0);

      return attach(new PriceLevelPrimitive({
        price: slPrice,
        lineColor: CLR_SL,
        lineStyle: 'dashed',
        lineWidth: 1,
        priceLabel: { visible: true, tickSize },
        cellOrder: ['pnl', 'size', 'close'],
        cells: {
          pnl:   { text: pnlTxt, bg: CLR_SL, color: LABEL_TEXT },
          size:  { text: String(p.size), bg: CLR_SL, color: LABEL_TEXT,
                   leftText: '−', leftColor: minusDisabled ? 'transparent' : LABEL_TEXT,
                   leftClick: () => decrementSize(),
                   rightText: '+', rightColor: LABEL_TEXT,
                   rightClick: () => incrementSize() },
          close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT,
                   hoverBg: CLOSE_BG_HOVER,
                   onClick: () => {
                     const p2 = previewRef.current;
                     if (!p2) return;
                     detach(p2.slLine);
                     p2.slLine = null;
                     p2.slPrice = null;
                     rebuildOrderLine(p2);
                   } },
        },
        onDrag: (price) => {
          const p2 = previewRef.current;
          if (!p2 || !p2.slLine) return;
          const snapped = snapToTickSize(price, tickSize);
          p2.slPrice = snapped;
          const pnl = formatSlPnl(p2.orderPrice, snapped, p2.size, p2.isAbove, contract!);
          p2.slLine.setCell('pnl', { text: pnl });
        },
        onDragEnd: () => {
          const p2 = previewRef.current;
          if (!p2 || !p2.slLine) return;
          p2.slPrice = snapToTickSize(p2.slLine.getPrice(), tickSize);
        },
      }));
    }

    function makeTpLine(p: PreviewState, atPrice?: number, atSize?: number): PriceLevelPrimitive {
      const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
      const remaining = p.size - totalTpSize;
      if (remaining <= 0) return null!;

      const isAbove = p.isAbove;
      const tpOffset = tickSize * (30 + p.tpLines.length * 15);
      const tpPrice = atPrice ?? (isAbove
        ? snapToTickSize(p.orderPrice + tpOffset, tickSize)
        : snapToTickSize(p.orderPrice - tpOffset, tickSize));
      const tpSize = atSize ?? remaining;
      const pnlTxt = formatTpPnl(p.orderPrice, tpPrice, tpSize, isAbove, contract!);

      const entry = { line: null as unknown as PriceLevelPrimitive, price: tpPrice, size: tpSize };
      p.tpLines.push(entry);
      // totalTpSize now includes this entry — + is disabled when all contracts are filled
      const tpMinusDisabled = tpSize <= 1;
      const tpPlusDisabled = p.tpLines.reduce((s, t) => s + t.size, 0) >= p.size;
      const tpShowZones = !tpMinusDisabled || !tpPlusDisabled;

      const prim = attach(new PriceLevelPrimitive({
        price: tpPrice,
        lineColor: CLR_TP,
        lineStyle: 'dashed',
        lineWidth: 1,
        priceLabel: { visible: true, tickSize },
        cellOrder: ['pnl', 'size', 'close'],
        cells: {
          pnl:   { text: pnlTxt, bg: CLR_TP, color: LABEL_TEXT },
          size:  { text: String(tpSize), bg: CLR_TP, color: LABEL_TEXT,
                   ...(tpShowZones ? {
                     leftText: '−', leftColor: tpMinusDisabled ? 'transparent' : LABEL_TEXT,
                     leftClick: () => decrementTpSize(entry),
                     rightText: '+', rightColor: tpPlusDisabled ? 'transparent' : LABEL_TEXT,
                     rightClick: () => incrementTpSize(entry),
                   } : {
                     leftClick: () => decrementTpSize(entry),
                     rightClick: () => incrementTpSize(entry),
                   }) },
          close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT,
                   hoverBg: CLOSE_BG_HOVER,
                   onClick: () => {
                     const p2 = previewRef.current;
                     if (!p2) return;
                     detach(entry.line);
                     const idx = p2.tpLines.indexOf(entry);
                     if (idx >= 0) p2.tpLines.splice(idx, 1);
                     rebuildOrderLine(p2);
                   } },
        },
        onDrag: (price) => {
          const p2 = previewRef.current;
          if (!p2) return;
          const snapped = snapToTickSize(price, tickSize);
          entry.price = snapped;
          const pnl = formatTpPnl(p2.orderPrice, snapped, entry.size, p2.isAbove, contract!);
          entry.line.setCell('pnl', { text: pnl });
        },
        onDragEnd: () => {
          const p2 = previewRef.current;
          if (!p2) return;
          entry.price = snapToTickSize(entry.line.getPrice(), tickSize);
        },
      }));

      entry.line = prim;
      return prim;
    }

    // ── State mutation helpers ───────────────────────────────────────

    function decrementSize() {
      const p = previewRef.current;
      if (!p) return;
      const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
      if (p.size <= 1 || p.size <= totalTpSize) return;
      p.size--;
      syncSizeLabels(p);
      rebuildOrderLine(p);
    }

    function incrementSize() {
      const p = previewRef.current;
      if (!p) return;
      p.size++;
      syncSizeLabels(p);
      rebuildOrderLine(p);
    }

    function syncTpZones(p: PreviewState) {
      const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
      const allFilled = totalTpSize >= p.size;
      for (const tp of p.tpLines) {
        const minusDisabled = tp.size <= 1;
        const plusDisabled = allFilled;
        const showZones = !minusDisabled || !plusDisabled;
        tp.line.setCell('size', {
          leftText: showZones ? '−' : undefined,
          leftColor: minusDisabled ? 'transparent' : LABEL_TEXT,
          rightText: showZones ? '+' : undefined,
          rightColor: plusDisabled ? 'transparent' : LABEL_TEXT,
        });
      }
    }

    function decrementTpSize(entry: { line: PriceLevelPrimitive; price: number; size: number }) {
      const p = previewRef.current;
      if (!p || entry.size <= 1) return;
      entry.size--;
      const pnl = formatTpPnl(p.orderPrice, entry.price, entry.size, p.isAbove, contract!);
      entry.line.setCell('pnl', { text: pnl });
      entry.line.setCell('size', {
        text: String(entry.size),
        leftColor: entry.size <= 1 ? 'transparent' : LABEL_TEXT,
      });
      syncTpZones(p);
      rebuildOrderLine(p);
    }

    function incrementTpSize(entry: { line: PriceLevelPrimitive; price: number; size: number }) {
      const p = previewRef.current;
      if (!p) return;
      const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
      if (totalTpSize >= p.size) return;
      entry.size++;
      const pnl = formatTpPnl(p.orderPrice, entry.price, entry.size, p.isAbove, contract!);
      entry.line.setCell('pnl', { text: pnl });
      entry.line.setCell('size', {
        text: String(entry.size),
        leftColor: entry.size <= 1 ? 'transparent' : LABEL_TEXT,
      });
      syncTpZones(p);
      rebuildOrderLine(p);
    }

    function syncSizeLabels(p: PreviewState) {
      const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
      if (p.slLine && p.slPrice != null) {
        const pnl = formatSlPnl(p.orderPrice, p.slPrice, p.size, p.isAbove, contract!);
        const minusDisabled = p.size <= 1 || p.size <= totalTpSize;
        p.slLine.setCell('pnl', { text: pnl });
        p.slLine.setCell('size', {
          text: String(p.size),
          leftColor: minusDisabled ? 'transparent' : LABEL_TEXT,
        });
      }
      for (const tp of p.tpLines) {
        const pnl = formatTpPnl(p.orderPrice, tp.price, tp.size, p.isAbove, contract!);
        tp.line.setCell('pnl', { text: pnl });
      }
      syncTpZones(p);
    }

    /** Rebuild the order line primitive (cell order changes when +SL/+TP appear/disappear). */
    function rebuildOrderLine(p: PreviewState) {
      detach(p.orderLine);
      p.orderLine = buildOrderLine(p);
    }

    /** Called when order line needs to switch market↔limit, updating condLine too. */
    function detachAndRebuildOrderLine(p: PreviewState) {
      detach(p.orderLine);
      p.orderLine = buildOrderLine(p);
    }

    /** Update condLine cells in-place when direction or market/limit mode changes. */
    function updateCondLine(p: PreviewState) {
      if (!p.condLine) return;
      const isAbove = p.isAbove;
      const armBg = isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW;
      const condText = isAbove ? `If Close Above ${timeframe.label}` : `If Close Below ${timeframe.label}`;
      p.condLine.setLineColor(isAbove ? CLR_ABOVE : CLR_BELOW);
      p.condLine.setCell('arrow', { text: isAbove ? '▲' : '▼', bg: armBg });
      p.condLine.setCell('label', { text: condText });
      p.condLine.setCell('type', { text: p.isMarket ? 'market' : 'limit' });
      p.condLine.setCell('arm', { bg: armBg });
      p.condLine.setLabelFraction(p.isMarket ? 0.30 : null);
    }

    function toggleMarketMode() {
      const p = previewRef.current;
      if (!p || !p.orderLine) return;
      if (!p.isMarket) {
        p.isMarket = true;
        p.isAbove = p.condPrice > p.orderPrice;
        p.orderPrice = p.condPrice;
        detach(p.slLine); p.slLine = null; p.slPrice = null;
        for (const tp of p.tpLines) detach(tp.line);
        p.tpLines = [];
        reapplyBracketPreset();
      } else {
        p.isMarket = false;
        p.orderPrice = snapToTickSize(p.condPrice - tickSize * 20, tickSize);
      }
      detachAndRebuildOrderLine(p);
      updateCondLine(p);
    }

    function flipDirection() {
      const p = previewRef.current;
      if (!p) return;
      p.isAbove = !p.isAbove;
      rebuildOrderLine(p);
      updateCondLine(p);
    }

    /** Flip isAbove if cond and order lines have crossed (limit mode only). */
    function flipDirectionIfCrossed(p: PreviewState) {
      if (p.isMarket) return;
      const shouldBeAbove = p.condPrice > p.orderPrice;
      if (shouldBeAbove === p.isAbove) return;
      p.isAbove = shouldBeAbove;
      rebuildOrderLine(p);
      updateCondLine(p);
    }

    function updateBracketPnl(p: PreviewState, refPrice: number) {
      if (p.slLine && p.slPrice != null) {
        const pnl = formatSlPnl(refPrice, p.slPrice, p.size, p.isAbove, contract!);
        p.slLine.setCell('pnl', { text: pnl });
      }
      for (const tp of p.tpLines) {
        const pnl = formatTpPnl(refPrice, tp.price, tp.size, p.isAbove, contract!);
        tp.line.setCell('pnl', { text: pnl });
      }
    }

    function addSlLine(atPrice?: number) {
      const p = previewRef.current;
      if (!p || p.slLine) return;
      p.slLine = makeSlLine(p, atPrice);
      rebuildOrderLine(p);
    }

    function addTpLine(atPrice?: number, atSize?: number) {
      const p = previewRef.current;
      if (!p) return;
      const totalTpSize = p.tpLines.reduce((s, t) => s + t.size, 0);
      if (totalTpSize >= p.size) return;
      makeTpLine(p, atPrice, atSize);
      rebuildOrderLine(p);
    }

    function reapplyBracketPreset() {
      const p = previewRef.current;
      if (!p) return;
      const cfg = resolvePreviewConfig();
      if (!cfg) return;
      const toP = (pts: number) => pointsToPrice(pts, contract!);
      if (cfg.stopLoss.points > 0) {
        addSlLine(snapToTickSize(
          p.isAbove ? p.orderPrice - toP(cfg.stopLoss.points) : p.orderPrice + toP(cfg.stopLoss.points),
          tickSize,
        ));
      }
      for (const tp of fitTpsToOrderSize(cfg.takeProfits, p.size)) {
        addTpLine(snapToTickSize(
          p.isAbove ? p.orderPrice + toP(tp.points) : p.orderPrice - toP(tp.points),
          tickSize,
        ), tp.size);
      }
    }

    function armCondition() {
      const p = previewRef.current;
      if (!p) return;
      const st2 = useStore.getState();
      const url = resolveConditionServerUrl(st2.conditionServerUrl);
      if (!st2.activeAccountId || !contract) return;

      const isAbove = p.isAbove;
      const conditionType = isAbove ? 'closes_above' : 'closes_below';
      const orderSide = isAbove ? 'buy' : 'sell';

      // Always use actual dragged line positions — preset is only used for initial placement.
      let bracket: CreateConditionInput['bracket'];
      if (p.slPrice != null || p.tpLines.length > 0) {
        const refPrice = p.isMarket ? (st2.lastPrice ?? p.orderPrice) : p.orderPrice;
        const slPoints = p.slPrice != null ? Math.abs(refPrice - p.slPrice) : undefined;
        const tpArr = p.tpLines
          .filter((t) => t.size > 0)
          .map((t) => ({ points: Math.abs(t.price - refPrice), size: t.size }))
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
        accountId: st2.activeAccountId,
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

    // ── Initial construction ─────────────────────────────────────────

    const p: PreviewState = {
      condLine: null, orderLine: null,
      slLine: null, tpLines: [],
      condPrice, orderPrice,
      slPrice: null,
      size, isAbove: true, isMarket: false,
    };
    previewRef.current = p;

    p.condLine = makeCondLine(p);
    p.orderLine = makeOrderLine(p);

    reapplyBracketPreset();

    // ── Store subscriptions ──────────────────────────────────────────

    const unsubSize = useStore.subscribe((state, prev) => {
      if (state.orderSize !== prev.orderSize) {
        const p2 = previewRef.current;
        if (!p2) return;
        p2.size = state.orderSize;
        syncSizeLabels(p2);
        rebuildOrderLine(p2);
      }
    });

    const unsubBracket = useStore.subscribe((state, prev) => {
      if (state.activePresetId === prev.activePresetId && state.bracketPresets === prev.bracketPresets) return;
      const p2 = previewRef.current;
      if (!p2) return;
      detach(p2.slLine); p2.slLine = null; p2.slPrice = null;
      for (const tp of p2.tpLines) detach(tp.line);
      p2.tpLines = [];
      reapplyBracketPreset();
      rebuildOrderLine(p2);
    });

    return () => {
      unsubSize();
      unsubBracket();
      destroyPreview();
    };
  }, [conditionPreview, contract, conditionServerUrl, timeframe, refs, previewRef]);
}
