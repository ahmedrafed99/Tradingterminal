import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { orderService, type PlaceOrderParams } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { OrderType, OrderSide } from '../../../types/enums';
import { calcPnl } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import { resolvePreviewConfig, fitTpsToOrderSize } from './resolvePreviewConfig';
import { buildNativeBracketParams, buildNativeSLOnly } from '../../../types/bracket';
import type { ChartRefs } from './types';
import { LABEL_TEXT, LABEL_BG, BUY_COLOR, SELL_COLOR, CLOSE_BG } from './labelUtils';
import { COLOR_LINE_BUY, COLOR_LINE_SELL } from '../../../constants/colors';
import { isFuturesMarketOpen } from '../../../utils/marketHours';

/**
 * Build labels for preview lines (entry, SL, TP).
 * Registers cancel-X, execute, +SL/+TP buttons, and row-drag hit targets.
 * Returns P&L updater closures.
 */
export function buildPreviewLabels(
  refs: ChartRefs,
  contract: Contract,
): (() => void)[] {
  const pnlUpdaters: (() => void)[] = [];

  const snap = useStore.getState();
  const pvSide = snap.previewSide;
  const previewTotalSize = snap.orderSize;
  const hasPreset = snap.bracketPresets.some((p) => p.id === snap.activePresetId);
  const previewPreset = snap.bracketPresets.find((p) => p.id === snap.activePresetId);
  const previewTpSizes = hasPreset
    ? fitTpsToOrderSize(previewPreset?.config.takeProfits ?? [], snap.orderSize).map((tp) => tp.size)
    : fitTpsToOrderSize(snap.adHocTpLevels, snap.orderSize).map((tp) => tp.size);

  for (let i = 0; i < refs.previewRoles.current.length; i++) {
    const role = refs.previewRoles.current[i];
    const price = refs.previewPrices.current[i];
    if (price == null) continue;

    const pvLine = refs.previewLines.current[i];
    if (!pvLine) continue;

    let onCancel: (() => void) | undefined;
    let onExecute: (() => void) | undefined;
    let pnlText: string;
    let pnlBg: string;
    let pvPnlCompute: (() => { text: string; bg: string; color?: string }) | null = null;
    let displaySize: number;

    if (role.kind === 'entry') {
      if (snap.previewHideEntry) continue;
      pnlText = pvSide === OrderSide.Buy ? 'Limit Buy' : 'Limit Sell';
      pnlBg = LABEL_BG;
      displaySize = previewTotalSize;
      onCancel = () => useStore.getState().togglePreview();
      onExecute = async () => {
        if (!isFuturesMarketOpen()) {
          showToast('warning', 'Market closed', 'Futures market is closed. Orders cannot be placed.');
          return;
        }
        const st = useStore.getState();
        if (!st.activeAccountId || !contract) return;
        const side: OrderSide = st.previewSide;

        const params: PlaceOrderParams = {
          accountId: st.activeAccountId,
          contractId: contract.id,
          type: st.orderType === 'market' ? OrderType.Market : OrderType.Limit,
          side,
          size: st.orderSize,
        };
        if (st.orderType === 'limit' && st.limitPrice != null) {
          params.limitPrice = st.limitPrice;
        }

        const mergedConfig = resolvePreviewConfig();
        const bracketsActive = mergedConfig != null
          && (mergedConfig.stopLoss.points >= 1 || mergedConfig.takeProfits.length >= 1);

        let engineArmed = false;
        if (bracketsActive && mergedConfig) {
          const nativeBrackets = buildNativeBracketParams(mergedConfig, side, contract);
          if (nativeBrackets) {
            Object.assign(params, nativeBrackets);
          } else {
            const nativeSL = buildNativeSLOnly(mergedConfig, side, contract);
            if (nativeSL) Object.assign(params, nativeSL);

            bracketEngine.armForEntry({
              accountId: st.activeAccountId,
              contractId: contract.id,
              entrySide: side,
              entrySize: st.orderSize,
              config: mergedConfig,
              contract: contract,
              nativeSL: !!nativeSL,
            });
            engineArmed = true;
          }
        }

        try {
          const { orderId } = await orderService.placeOrder(params);
          if (engineArmed) bracketEngine.confirmEntryOrderId(orderId);
          const s = useStore.getState();
          s.clearDraftOverrides();
          if (s.orderType === 'market') {
            s.clearAdHocBrackets();
            s.togglePreview();
          } else {
            useStore.setState({ previewHideEntry: true });
          }
        } catch (err) {
          showToast('error', 'Order placement failed', errorMessage(err));
          if (engineArmed) bracketEngine.clearSession();
        }
      };
    } else if (role.kind === 'sl') {
      displaySize = previewTotalSize;
      const entryPrice = refs.previewPrices.current[0] ?? 0;
      const slDiff = pvSide === OrderSide.Buy ? entryPrice - price : price - entryPrice;
      const slPnl = calcPnl(slDiff, contract, displaySize);
      pnlText = `-$${Math.abs(slPnl).toFixed(2)}`;
      pnlBg = SELL_COLOR;
      onCancel = hasPreset
        ? () => useStore.getState().setDraftSlPoints(0)
        : () => useStore.getState().setAdHocSlPoints(null);

      const previewIdx = i;
      pvPnlCompute = () => {
        const ep = refs.previewPrices.current[0] ?? 0;
        const sp = refs.previewPrices.current[previewIdx] ?? price;
        const s1 = useStore.getState();
        const sz = s1.orderSize;
        const diff = s1.previewSide === OrderSide.Buy ? ep - sp : sp - ep;
        const pnl = calcPnl(diff, contract, sz);
        return { text: `-$${Math.abs(pnl).toFixed(2)}`, bg: SELL_COLOR };
      };
    } else {
      displaySize = previewTpSizes[role.index] ?? previewTotalSize;
      const entryPrice = refs.previewPrices.current[0] ?? 0;
      const tpDiff = pvSide === OrderSide.Buy ? price - entryPrice : entryPrice - price;
      const tpPnl = calcPnl(tpDiff, contract, displaySize);
      pnlText = `+$${Math.abs(tpPnl).toFixed(2)}`;
      pnlBg = BUY_COLOR;
      onCancel = hasPreset
        ? () => useStore.getState().setDraftTpPoints(role.index, 0)
        : () => useStore.getState().removeAdHocTp(role.index);

      const tpIdx = role.index;
      const previewIdx = i;
      pvPnlCompute = () => {
        const ep = refs.previewPrices.current[0] ?? 0;
        const tp = refs.previewPrices.current[previewIdx] ?? price;
        const s2 = useStore.getState();
        const presetCfg = s2.bracketPresets.find((p) => p.id === s2.activePresetId);
        const fittedTps = presetCfg
          ? fitTpsToOrderSize(presetCfg.config.takeProfits, s2.orderSize)
          : fitTpsToOrderSize(s2.adHocTpLevels, s2.orderSize);
        const sz = fittedTps[tpIdx]?.size ?? s2.orderSize;
        const diff = s2.previewSide === OrderSide.Buy ? tp - ep : ep - tp;
        const pnl = calcPnl(diff, contract, sz);
        return { text: `+$${Math.abs(pnl).toFixed(2)}`, bg: BUY_COLOR, color: LABEL_TEXT };
      };
    }

    const previewIdx = i;
    const isEntry = role.kind === 'entry';
    const entrySideBg = pvSide === OrderSide.Buy ? BUY_COLOR : SELL_COLOR;
    const sizeBg = isEntry ? entrySideBg : role.kind === 'sl' ? SELL_COLOR : BUY_COLOR;

    const sections: { text: string; bg: string; color: string }[] = [
      { text: pnlText, bg: pnlBg, color: LABEL_TEXT },
      { text: String(displaySize), bg: sizeBg, color: LABEL_TEXT },
    ];

    const buttonCells: { index: number; handler: () => void }[] = [];

    // +SL / +TP buttons on entry label when no preset is active
    if (isEntry && !hasPreset) {
      const curAdHocSl = snap.adHocSlPoints;
      const allocatedTpSize = snap.adHocTpLevels.reduce((sum, tp) => sum + tp.size, 0);
      const remainingContracts = previewTotalSize - allocatedTpSize;

      if (curAdHocSl == null) {
        const slBtnIdx = sections.length;
        sections.push({ text: '+SL', bg: `${COLOR_LINE_SELL}80`, color: LABEL_TEXT });
        buttonCells.push({ index: slBtnIdx, handler: () => useStore.getState().setAdHocSlPoints(10) });
      }
      if (remainingContracts > 0) {
        const tpBtnIdx = sections.length;
        sections.push({ text: '+TP', bg: `${COLOR_LINE_BUY}80`, color: LABEL_TEXT });
        buttonCells.push({
          index: tpBtnIdx,
          handler: () => {
            const st = useStore.getState();
            const n = st.adHocTpLevels.length;
            st.addAdHocTp(20 * (n + 1), 1);
          },
        });
      }
    }

    // Close-X button
    const cancelBtnIdx = sections.length;
    sections.push({ text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT });
    if (onCancel) {
      buttonCells.push({ index: cancelBtnIdx, handler: onCancel });
    }

    if (isEntry) pvLine.setLabelLeft(0.65);
    pvLine.setLabel(sections);
    const cells = pvLine.getCells();
    const labelEl = pvLine.getLabelEl();

    // Register button hit targets (priority 0)
    for (const btn of buttonCells) {
      const handler = btn.handler;
      refs.hitTargets.current.push({
        el: cells[btn.index],
        priority: 0,
        handler: () => handler(),
      });
    }

    // Entry label firstCell click + execute (priority 1)
    if (onExecute) {
      const exec = onExecute;
      refs.hitTargets.current.push({
        el: cells[0],
        priority: 1,
        handler: (e: MouseEvent) => {
          if (!labelEl) return;
          refs.entryClick.current = { downX: e.clientX, downY: e.clientY, exec };
          refs.previewDragState.current = { role, lineIdx: previewIdx };
          refs.activeDragRow.current = labelEl;
          labelEl.style.cursor = 'grabbing';
          if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
          if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
        },
      });
    }

    // Row drag (priority 2)
    if (labelEl) {
      const dragRole = role;
      const dragLineIdx = previewIdx;
      refs.hitTargets.current.push({
        el: labelEl,
        priority: 2,
        handler: () => {
          refs.entryClick.current = null;
          refs.previewDragState.current = { role: dragRole, lineIdx: dragLineIdx };
          refs.activeDragRow.current = labelEl;
          labelEl.style.cursor = 'grabbing';
          if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
          if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
        },
      });
    }

    // P&L updater
    if (pvPnlCompute) {
      const compute = pvPnlCompute;
      pnlUpdaters.push(() => {
        const result = compute();
        if (result) pvLine.updateSection(0, result.text, result.bg, result.color);
      });
    }
  }

  return pnlUpdaters;
}
