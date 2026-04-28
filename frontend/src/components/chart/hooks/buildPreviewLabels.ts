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
import { getSchedule } from '../../../utils/marketHours';

/**
 * Build labels for preview lines (entry, SL, TP).
 * Sets cell content and onClick handlers on PriceLevelPrimitive instances.
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

    const primitive = refs.previewLines.current[i];
    if (!primitive) continue;

    // ── Entry ─────────────────────────────────────────────────────────────────
    if (role.kind === 'entry') {
      if (snap.previewHideEntry) {
        primitive.setCellOrder([]);
        continue;
      }

      const onExecute = async () => {
        if (!getSchedule(contract?.marketType).isOpen()) {
          showToast('warning', 'Market closed', 'Market is closed. Orders cannot be placed.');
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

      const entrySideBg = pvSide === OrderSide.Buy ? BUY_COLOR : SELL_COLOR;

      primitive.setCell('pnl', {
        text: pvSide === OrderSide.Buy ? 'Limit Buy' : 'Limit Sell',
        bg: LABEL_BG,
        color: LABEL_TEXT,
        onClick: onExecute,
      });
      primitive.setCell('size', {
        text: String(previewTotalSize),
        bg: entrySideBg,
        color: LABEL_TEXT,
      });

      const cellOrder: string[] = ['pnl', 'size'];

      if (!hasPreset) {
        const curAdHocSl = snap.adHocSlPoints;
        const allocatedTpSize = snap.adHocTpLevels.reduce((sum, tp) => sum + tp.size, 0);
        const remainingContracts = previewTotalSize - allocatedTpSize;

        if (curAdHocSl == null) {
          primitive.setCell('addsl', {
            text: '+SL',
            bg: `${COLOR_LINE_SELL}80`,
            color: LABEL_TEXT,
            onClick: () => useStore.getState().setAdHocSlPoints(10),
          });
          cellOrder.push('addsl');
        }
        if (remainingContracts > 0) {
          primitive.setCell('addtp', {
            text: '+TP',
            bg: `${COLOR_LINE_BUY}80`,
            color: LABEL_TEXT,
            onClick: () => {
              const st = useStore.getState();
              const n = st.adHocTpLevels.length;
              st.addAdHocTp(20 * (n + 1), 1);
            },
          });
          cellOrder.push('addtp');
        }
      }

      primitive.setCell('close', {
        text: '✕',
        bg: CLOSE_BG,
        color: LABEL_TEXT,
        onClick: () => useStore.getState().togglePreview(),
      });
      cellOrder.push('close');
      primitive.setCellOrder(cellOrder);
      continue;
    }

    // ── SL ────────────────────────────────────────────────────────────────────
    if (role.kind === 'sl') {
      const displaySize = previewTotalSize;
      const entryPrice = refs.previewPrices.current[0] ?? 0;
      const slDiff = pvSide === OrderSide.Buy ? entryPrice - price : price - entryPrice;
      const slPnl = calcPnl(slDiff, contract, displaySize);
      const pnlText = `-$${Math.abs(slPnl).toFixed(2)}`;

      const onCancel = hasPreset
        ? () => useStore.getState().setDraftSlPoints(0)
        : () => useStore.getState().setAdHocSlPoints(null);

      primitive.setCell('pnl', { text: pnlText, bg: SELL_COLOR, color: LABEL_TEXT });
      primitive.setCell('size', { text: String(displaySize), bg: SELL_COLOR, color: LABEL_TEXT });
      primitive.setCell('close', { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT, onClick: onCancel });
      primitive.setCellOrder(['pnl', 'size', 'close']);

      const previewIdx = i;
      pnlUpdaters.push(() => {
        const ep = refs.previewPrices.current[0] ?? 0;
        const sp = refs.previewPrices.current[previewIdx] ?? price;
        const s1 = useStore.getState();
        const sz = s1.orderSize;
        const diff = s1.previewSide === OrderSide.Buy ? ep - sp : sp - ep;
        const pnl = calcPnl(diff, contract, sz);
        primitive.setCell('pnl', {
          text: `-$${Math.abs(pnl).toFixed(2)}`,
          bg: SELL_COLOR,
          color: LABEL_TEXT,
        });
      });
      continue;
    }

    // ── TP ────────────────────────────────────────────────────────────────────
    if (role.kind === 'tp') {
      const displaySize = previewTpSizes[role.index] ?? previewTotalSize;
      const entryPrice = refs.previewPrices.current[0] ?? 0;
      const tpDiff = pvSide === OrderSide.Buy ? price - entryPrice : entryPrice - price;
      const tpPnl = calcPnl(tpDiff, contract, displaySize);
      const pnlText = `+$${Math.abs(tpPnl).toFixed(2)}`;

      const onCancel = hasPreset
        ? () => useStore.getState().setDraftTpPoints(role.index, 0)
        : () => useStore.getState().removeAdHocTp(role.index);

      primitive.setCell('pnl', { text: pnlText, bg: BUY_COLOR, color: LABEL_TEXT });
      primitive.setCell('size', { text: String(displaySize), bg: BUY_COLOR, color: LABEL_TEXT });
      primitive.setCell('close', { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT, onClick: onCancel });
      primitive.setCellOrder(['pnl', 'size', 'close']);

      const tpIdx = role.index;
      const previewIdx = i;
      pnlUpdaters.push(() => {
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
        primitive.setCell('pnl', {
          text: `+$${Math.abs(pnl).toFixed(2)}`,
          bg: BUY_COLOR,
          color: LABEL_TEXT,
        });
      });
    }
  }

  return pnlUpdaters;
}
