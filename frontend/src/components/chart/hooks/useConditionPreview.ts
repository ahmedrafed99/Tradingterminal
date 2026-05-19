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
      const preview = previewRef.current;
      if (!preview) return;
      detach(preview.condLine);
      detach(preview.orderLine);
      detach(preview.slLine);
      for (const tpreview of preview.tpLines) detach(tpreview.line);
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

    function makeCondLine(preview: PreviewState): PriceLevelPrimitive {
      const isAbove = preview.isAbove;
      const armBg = isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW;
      const condText = isAbove ? `If Close Above ${timeframe.label}` : `If Close Below ${timeframe.label}`;
      const orderTypeText = preview.isMarket ? 'market' : 'limit';
      return attach(new PriceLevelPrimitive({
        price: preview.condPrice,
        lineColor: isAbove ? CLR_ABOVE : CLR_BELOW,
        lineStyle: 'dashed',
        lineWidth: 1,
        priceLabel: { visible: true, tickSize },
        labelFraction: preview.isMarket ? 0.30 : undefined,
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
          const preview2 = previewRef.current;
          if (!preview2) return;
          const snapped = snapToTickSize(price, tickSize);
          preview2.condPrice = snapped;
          if (preview2.isMarket && preview2.orderLine) {
            preview2.orderPrice = snapped;
            preview2.orderLine.setPrice(snapped);
            updateBracketPnl(preview2,snapped);
          }
          if (!preview2.isMarket) flipDirectionIfCrossed(preview2);
        },
        onDragEnd: () => {
          const preview2 = previewRef.current;
          if (!preview2) return;
          const snapped = snapToTickSize(preview2.condLine!.getPrice(), tickSize);
          preview2.condPrice = snapped;
          if (preview2.isMarket) {
            preview2.orderPrice = snapped;
          }
        },
      }));
    }

    function makeOrderLine(preview: PreviewState): PriceLevelPrimitive {
      return buildOrderLine(preview);
    }

    function buildOrderLine(preview: PreviewState): PriceLevelPrimitive {
      const isAbove = preview.isAbove;
      const sideBg = isAbove ? CLR_BUY : CLR_SELL;
      const sideLabel = isAbove ? (preview.isMarket ? 'Buy Market' : 'Buy Limit') : (preview.isMarket ? 'Sell Market' : 'Sell Limit');
      const totalTpSize = preview.tpLines.reduce((s, t) => s + t.size, 0);

      const cellOrder = ['side', 'size'];
      if (!preview.slLine) cellOrder.push('addSl');
      if (totalTpSize < preview.size) cellOrder.push('addTp');
      cellOrder.push('close');

      const minusDisabled = preview.size <= 1 || preview.size <= totalTpSize;
      const plusDisabled = false;

      const prim = attach(new PriceLevelPrimitive({
        price: preview.orderPrice,
        lineColor: sideBg,
        lineStyle: 'dashed',
        lineWidth: preview.isMarket ? 0 : 1,
        priceLabel: { visible: !preview.isMarket, tickSize },
        labelFraction: preview.isMarket ? 0.65 : undefined,
        cellOrder,
        cells: {
          side:  { text: sideLabel, bg: LABEL_BG, color: LABEL_TEXT,
                   ...(preview.isMarket ? { hoverBg: '#b0afb1', onClick: () => flipDirection() } : {}) },
          size:  { text: String(preview.size), bg: sideBg, color: LABEL_TEXT,
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
                     const preview2 = previewRef.current;
                     if (!preview2) return;
                     if (preview2.isMarket) {
                       useStore.getState().setConditionPreview(false);
                     } else {
                       // Remove limit order line — switch to market mode
                       preview2.isMarket = true;
                       preview2.isAbove = preview2.condPrice > preview2.orderPrice;
                       preview2.orderPrice = preview2.condPrice;
                       detachAndRebuildOrderLine(preview2);
                       updateCondLine(preview2);
                     }
                   } },
        },
        ...(!preview.isMarket ? {
          onDrag: (price) => {
            const preview2 = previewRef.current;
            if (!preview2) return;
            const snapped = snapToTickSize(price, tickSize);
            preview2.orderPrice = snapped;
            updateBracketPnl(preview2,snapped);
            flipDirectionIfCrossed(preview2);
          },
          onDragEnd: () => {
            const preview2 = previewRef.current;
            if (!preview2) return;
            preview2.orderPrice = snapToTickSize(preview2.orderLine!.getPrice(), tickSize);
          },
        } : {}),
      }));
      return prim;
    }

    function makeSlLine(preview: PreviewState, atPrice?: number): PriceLevelPrimitive {
      const isAbove = preview.isAbove;
      const slOffset = tickSize * 15;
      const slPrice = atPrice ?? (isAbove
        ? snapToTickSize(preview.orderPrice - slOffset, tickSize)
        : snapToTickSize(preview.orderPrice + slOffset, tickSize));

      const pnlTxt = formatSlPnl(preview.orderPrice, slPrice, preview.size, isAbove, contract!);
      preview.slPrice = slPrice;

      const minusDisabled = preview.size <= 1 || preview.size <= preview.tpLines.reduce((s, t) => s + t.size, 0);

      return attach(new PriceLevelPrimitive({
        price: slPrice,
        lineColor: CLR_SL,
        lineStyle: 'dashed',
        lineWidth: 1,
        priceLabel: { visible: true, tickSize },
        cellOrder: ['pnl', 'size', 'close'],
        cells: {
          pnl:   { text: pnlTxt, bg: CLR_SL, color: LABEL_TEXT },
          size:  { text: String(preview.size), bg: CLR_SL, color: LABEL_TEXT,
                   leftText: '−', leftColor: minusDisabled ? 'transparent' : LABEL_TEXT,
                   leftClick: () => decrementSize(),
                   rightText: '+', rightColor: LABEL_TEXT,
                   rightClick: () => incrementSize() },
          close: { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT,
                   hoverBg: CLOSE_BG_HOVER,
                   onClick: () => {
                     const preview2 = previewRef.current;
                     if (!preview2) return;
                     detach(preview2.slLine);
                     preview2.slLine = null;
                     preview2.slPrice = null;
                     rebuildOrderLine(preview2);
                   } },
        },
        onDrag: (price) => {
          const preview2 = previewRef.current;
          if (!preview2 || !preview2.slLine) return;
          const snapped = snapToTickSize(price, tickSize);
          preview2.slPrice = snapped;
          const pnl = formatSlPnl(preview2.orderPrice, snapped, preview2.size, preview2.isAbove, contract!);
          preview2.slLine.setCell('pnl', { text: pnl });
        },
        onDragEnd: () => {
          const preview2 = previewRef.current;
          if (!preview2 || !preview2.slLine) return;
          preview2.slPrice = snapToTickSize(preview2.slLine.getPrice(), tickSize);
        },
      }));
    }

    function makeTpLine(preview: PreviewState, atPrice?: number, atSize?: number): PriceLevelPrimitive {
      const totalTpSize = preview.tpLines.reduce((s, t) => s + t.size, 0);
      const remaining = preview.size - totalTpSize;
      if (remaining <= 0) return null!;

      const isAbove = preview.isAbove;
      const tpOffset = tickSize * (30 + preview.tpLines.length * 15);
      const tpPrice = atPrice ?? (isAbove
        ? snapToTickSize(preview.orderPrice + tpOffset, tickSize)
        : snapToTickSize(preview.orderPrice - tpOffset, tickSize));
      const tpSize = atSize ?? remaining;
      const pnlTxt = formatTpPnl(preview.orderPrice, tpPrice, tpSize, isAbove, contract!);

      const entry = { line: null as unknown as PriceLevelPrimitive, price: tpPrice, size: tpSize };
      preview.tpLines.push(entry);
      // totalTpSize now includes this entry — + is disabled when all contracts are filled
      const tpMinusDisabled = tpSize <= 1;
      const tpPlusDisabled = preview.tpLines.reduce((s, t) => s + t.size, 0) >= preview.size;
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
                     const preview2 = previewRef.current;
                     if (!preview2) return;
                     detach(entry.line);
                     const idx = preview2.tpLines.indexOf(entry);
                     if (idx >= 0) preview2.tpLines.splice(idx, 1);
                     rebuildOrderLine(preview2);
                   } },
        },
        onDrag: (price) => {
          const preview2 = previewRef.current;
          if (!preview2) return;
          const snapped = snapToTickSize(price, tickSize);
          entry.price = snapped;
          const pnl = formatTpPnl(preview2.orderPrice, snapped, entry.size, preview2.isAbove, contract!);
          entry.line.setCell('pnl', { text: pnl });
        },
        onDragEnd: () => {
          const preview2 = previewRef.current;
          if (!preview2) return;
          entry.price = snapToTickSize(entry.line.getPrice(), tickSize);
        },
      }));

      entry.line = prim;
      return prim;
    }

    // ── State mutation helpers ───────────────────────────────────────

    function decrementSize() {
      const preview = previewRef.current;
      if (!preview) return;
      const totalTpSize = preview.tpLines.reduce((s, t) => s + t.size, 0);
      if (preview.size <= 1 || preview.size <= totalTpSize) return;
      preview.size--;
      syncSizeLabels(preview);
      rebuildOrderLine(preview);
    }

    function incrementSize() {
      const preview = previewRef.current;
      if (!preview) return;
      preview.size++;
      syncSizeLabels(preview);
      rebuildOrderLine(preview);
    }

    function syncTpZones(preview: PreviewState) {
      const totalTpSize = preview.tpLines.reduce((s, t) => s + t.size, 0);
      const allFilled = totalTpSize >= preview.size;
      for (const tpreview of preview.tpLines) {
        const minusDisabled = tpreview.size <= 1;
        const plusDisabled = allFilled;
        const showZones = !minusDisabled || !plusDisabled;
        tpreview.line.setCell('size', {
          leftText: showZones ? '−' : undefined,
          leftColor: minusDisabled ? 'transparent' : LABEL_TEXT,
          rightText: showZones ? '+' : undefined,
          rightColor: plusDisabled ? 'transparent' : LABEL_TEXT,
        });
      }
    }

    function decrementTpSize(entry: { line: PriceLevelPrimitive; price: number; size: number }) {
      const preview = previewRef.current;
      if (!preview || entry.size <= 1) return;
      entry.size--;
      const pnl = formatTpPnl(preview.orderPrice, entry.price, entry.size, preview.isAbove, contract!);
      entry.line.setCell('pnl', { text: pnl });
      entry.line.setCell('size', {
        text: String(entry.size),
        leftColor: entry.size <= 1 ? 'transparent' : LABEL_TEXT,
      });
      syncTpZones(preview);
      rebuildOrderLine(preview);
    }

    function incrementTpSize(entry: { line: PriceLevelPrimitive; price: number; size: number }) {
      const preview = previewRef.current;
      if (!preview) return;
      const totalTpSize = preview.tpLines.reduce((s, t) => s + t.size, 0);
      if (totalTpSize >= preview.size) return;
      entry.size++;
      const pnl = formatTpPnl(preview.orderPrice, entry.price, entry.size, preview.isAbove, contract!);
      entry.line.setCell('pnl', { text: pnl });
      entry.line.setCell('size', {
        text: String(entry.size),
        leftColor: entry.size <= 1 ? 'transparent' : LABEL_TEXT,
      });
      syncTpZones(preview);
      rebuildOrderLine(preview);
    }

    function syncSizeLabels(preview: PreviewState) {
      const totalTpSize = preview.tpLines.reduce((s, t) => s + t.size, 0);
      if (preview.slLine && preview.slPrice != null) {
        const pnl = formatSlPnl(preview.orderPrice, preview.slPrice, preview.size, preview.isAbove, contract!);
        const minusDisabled = preview.size <= 1 || preview.size <= totalTpSize;
        preview.slLine.setCell('pnl', { text: pnl });
        preview.slLine.setCell('size', {
          text: String(preview.size),
          leftColor: minusDisabled ? 'transparent' : LABEL_TEXT,
        });
      }
      for (const tpreview of preview.tpLines) {
        const pnl = formatTpPnl(preview.orderPrice, tpreview.price, tpreview.size, preview.isAbove, contract!);
        tpreview.line.setCell('pnl', { text: pnl });
      }
      syncTpZones(preview);
    }

    /** Rebuild the order line primitive (cell order changes when +SL/+TP appear/disappear). */
    function rebuildOrderLine(preview: PreviewState) {
      detach(preview.orderLine);
      preview.orderLine = buildOrderLine(preview);
    }

    /** Called when order line needs to switch market↔limit, updating condLine too. */
    function detachAndRebuildOrderLine(preview: PreviewState) {
      detach(preview.orderLine);
      preview.orderLine = buildOrderLine(preview);
    }

    /** Update condLine cells in-place when direction or market/limit mode changes. */
    function updateCondLine(preview: PreviewState) {
      if (!preview.condLine) return;
      const isAbove = preview.isAbove;
      const armBg = isAbove ? CLR_ARM_ABOVE : CLR_ARM_BELOW;
      const condText = isAbove ? `If Close Above ${timeframe.label}` : `If Close Below ${timeframe.label}`;
      preview.condLine.setLineColor(isAbove ? CLR_ABOVE : CLR_BELOW);
      preview.condLine.setCell('arrow', { text: isAbove ? '▲' : '▼', bg: armBg });
      preview.condLine.setCell('label', { text: condText });
      preview.condLine.setCell('type', { text: preview.isMarket ? 'market' : 'limit' });
      preview.condLine.setCell('arm', { bg: armBg });
      preview.condLine.setLabelFraction(preview.isMarket ? 0.30 : null);
    }

    function toggleMarketMode() {
      const preview = previewRef.current;
      if (!preview || !preview.orderLine) return;
      if (!preview.isMarket) {
        preview.isMarket = true;
        preview.isAbove = preview.condPrice > preview.orderPrice;
        preview.orderPrice = preview.condPrice;
        detach(preview.slLine); preview.slLine = null; preview.slPrice = null;
        for (const tpreview of preview.tpLines) detach(tpreview.line);
        preview.tpLines = [];
        reapplyBracketPreset();
      } else {
        preview.isMarket = false;
        preview.orderPrice = snapToTickSize(preview.condPrice - tickSize * 20, tickSize);
      }
      detachAndRebuildOrderLine(preview);
      updateCondLine(preview);
    }

    function flipDirection() {
      const preview = previewRef.current;
      if (!preview) return;
      preview.isAbove = !preview.isAbove;
      rebuildOrderLine(preview);
      updateCondLine(preview);
    }

    /** Flip isAbove if cond and order lines have crossed (limit mode only). */
    function flipDirectionIfCrossed(preview: PreviewState) {
      if (preview.isMarket) return;
      const shouldBeAbove = preview.condPrice > preview.orderPrice;
      if (shouldBeAbove === preview.isAbove) return;
      preview.isAbove = shouldBeAbove;
      rebuildOrderLine(preview);
      updateCondLine(preview);
    }

    function updateBracketPnl(preview: PreviewState, refPrice: number) {
      if (preview.slLine && preview.slPrice != null) {
        const pnl = formatSlPnl(refPrice, preview.slPrice, preview.size, preview.isAbove, contract!);
        preview.slLine.setCell('pnl', { text: pnl });
      }
      for (const tpreview of preview.tpLines) {
        const pnl = formatTpPnl(refPrice, tpreview.price, tpreview.size, preview.isAbove, contract!);
        tpreview.line.setCell('pnl', { text: pnl });
      }
    }

    function addSlLine(atPrice?: number) {
      const preview = previewRef.current;
      if (!preview || preview.slLine) return;
      preview.slLine = makeSlLine(preview,atPrice);
      rebuildOrderLine(preview);
    }

    function addTpLine(atPrice?: number, atSize?: number) {
      const preview = previewRef.current;
      if (!preview) return;
      const totalTpSize = preview.tpLines.reduce((s, t) => s + t.size, 0);
      if (totalTpSize >= preview.size) return;
      makeTpLine(preview,atPrice, atSize);
      rebuildOrderLine(preview);
    }

    function reapplyBracketPreset() {
      const preview = previewRef.current;
      if (!preview) return;
      const cfg = resolvePreviewConfig();
      if (!cfg) return;
      const toP = (pts: number) => pointsToPrice(pts, contract!);
      if (cfg.stopLoss.points > 0) {
        addSlLine(snapToTickSize(
          preview.isAbove ? preview.orderPrice - toP(cfg.stopLoss.points) : preview.orderPrice + toP(cfg.stopLoss.points),
          tickSize,
        ));
      }
      for (const tpreview of fitTpsToOrderSize(cfg.takeProfits, preview.size)) {
        addTpLine(snapToTickSize(
          preview.isAbove ? preview.orderPrice + toP(tpreview.points) : preview.orderPrice - toP(tpreview.points),
          tickSize,
        ), tpreview.size);
      }
    }

    function armCondition() {
      const preview = previewRef.current;
      if (!preview) return;
      const st2 = useStore.getState();
      const url = resolveConditionServerUrl(st2.conditionServerUrl);
      if (!st2.activeAccountId || !contract) return;

      const isAbove = preview.isAbove;
      const conditionType = isAbove ? 'closes_above' : 'closes_below';
      const orderSide = isAbove ? 'buy' : 'sell';

      // Always use actual dragged line positions — preset is only used for initial placement.
      let bracket: CreateConditionInput['bracket'];
      if (preview.slPrice != null || preview.tpLines.length > 0) {
        const refPrice = preview.isMarket ? (st2.lastPrice ?? preview.orderPrice) : preview.orderPrice;
        const slPoints = preview.slPrice != null ? Math.abs(refPrice - preview.slPrice) : undefined;
        const tpArr = preview.tpLines
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
        triggerPrice: preview.condPrice,
        timeframe: timeframe.label,
        orderSide,
        orderType: preview.isMarket ? 'market' : 'limit',
        orderPrice: preview.isMarket ? undefined : preview.orderPrice,
        orderSize: preview.size,
        accountId: st2.activeAccountId,
        bracket,
      };

      conditionService.create(url, payload)
        .then((created) => {
          useStore.getState().upsertCondition(created);
          showToast('success', 'Condition armed', `${conditionType} @ ${preview.condPrice}`);
          useStore.getState().setConditionPreview(false);
        })
        .catch((err) => {
          showToast('error', 'Failed to arm condition', errorMessage(err));
        });
    }

    // ── Initial construction ─────────────────────────────────────────

    const initialPreview: PreviewState = {
      condLine: null, orderLine: null,
      slLine: null, tpLines: [],
      condPrice, orderPrice,
      slPrice: null,
      size, isAbove: true, isMarket: false,
    };
    previewRef.current = initialPreview;

    initialPreview.condLine = makeCondLine(initialPreview);
    initialPreview.orderLine = makeOrderLine(initialPreview);

    reapplyBracketPreset();

    // ── Store subscriptions ──────────────────────────────────────────

    const unsubSize = useStore.subscribe((state, prev) => {
      if (state.orderSize !== prev.orderSize) {
        const preview2 = previewRef.current;
        if (!preview2) return;
        preview2.size = state.orderSize;
        syncSizeLabels(preview2);
        rebuildOrderLine(preview2);
      }
    });

    const unsubBracket = useStore.subscribe((state, prev) => {
      if (state.activePresetId === prev.activePresetId && state.bracketPresets === prev.bracketPresets) return;
      const preview2 = previewRef.current;
      if (!preview2) return;
      detach(preview2.slLine); preview2.slLine = null; preview2.slPrice = null;
      for (const tpreview of preview2.tpLines) detach(tpreview.line);
      preview2.tpLines = [];
      reapplyBracketPreset();
      rebuildOrderLine(preview2);
    });

    return () => {
      unsubSize();
      unsubBracket();
      destroyPreview();
    };
  }, [conditionPreview, contract, conditionServerUrl, timeframe, refs, previewRef]);
}
