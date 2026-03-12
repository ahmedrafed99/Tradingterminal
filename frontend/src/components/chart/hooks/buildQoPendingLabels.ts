import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { bracketEngine } from '../../../services/bracketEngine';
import { orderService } from '../../../services/orderService';
import { OrderSide, OrderType, OrderStatus } from '../../../types/enums';
import { calcPnl } from '../../../utils/instrument';
import type { ChartRefs } from './types';

interface QoPendingPreview {
  side: OrderSide;
  entryPrice: number;
  orderSize: number;
  slPrice: number | null;
  tpPrices: number[];
  tpSizes: number[];
}

/**
 * Build labels for quick-order pending preview lines (SL/TP awaiting fill).
 * Registers cancel-X and row-drag hit targets.
 * Returns P&L updater closures.
 */
export function buildQoPendingLabels(
  refs: ChartRefs,
  contract: Contract,
  qoPendingPreview: QoPendingPreview,
): (() => void)[] {
  const pnlUpdaters: (() => void)[] = [];
  const qo = qoPendingPreview;
  const qoEntryPrice = qo.entryPrice;

  // Initialize mutable prices ref
  refs.qoPreviewPrices.current = { entry: qo.entryPrice, sl: qo.slPrice, tps: [...qo.tpPrices] };

  // SL label
  if (qo.slPrice != null) {
    const slLine = refs.qoPreviewLines.current.sl;
    if (slLine) {
      const slDiff = qo.side === OrderSide.Buy ? qoEntryPrice - qo.slPrice : qo.slPrice - qoEntryPrice;
      const slPnl = calcPnl(slDiff, contract, qo.orderSize);
      const slPnlText = `-$${Math.abs(slPnl).toFixed(2)}`;
      const cancelSl = () => {
        // Cancel the actual Suspended SL order in the gateway
        const st = useStore.getState();
        const acct = st.activeAccountId;
        const cur = st.qoPendingPreview;
        if (acct && cur) {
          const oppSide = cur.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;
          const slOrder = st.openOrders.find((o) =>
            String(o.contractId) === String(contract.id) &&
            o.status === OrderStatus.Suspended &&
            (o.customTag?.endsWith('-SL') ?? (
              o.side === oppSide &&
              (o.type === OrderType.Stop || o.type === OrderType.TrailingStop) &&
              o.size === cur.orderSize
            )),
          );
          if (slOrder) {
            orderService.cancelOrder(acct, slOrder.id).catch(() => {});
            st.removeOrder(slOrder.id);
          }
        }

        const sl = refs.qoPreviewLines.current.sl;
        if (sl) {
          sl.destroy();
          refs.qoPreviewLines.current.sl = null;
        }
        bracketEngine.updateArmedConfig((cfg) => ({
          ...cfg,
          stopLoss: { ...cfg.stopLoss, points: 0 },
        }));
        if (cur) st.setQoPendingPreview({ ...cur, slPrice: null });
      };

      slLine.setLabel([
        { text: slPnlText, bg: '#ff0000', color: '#000' },
        { text: String(qo.orderSize), bg: '#ff0000', color: '#000' },
        { text: '\u2715', bg: '#e0e0e0', color: '#000' },
      ]);

      const slCells = slLine.getCells();
      const slLabelEl = slLine.getLabelEl();

      refs.hitTargets.current.push({
        el: slCells[2], priority: 0,
        handler: () => cancelSl(),
      });

      if (slLabelEl) {
        refs.hitTargets.current.push({
          el: slLabelEl,
          priority: 2,
          handler: () => {
            refs.previewDragState.current = { role: { kind: 'qo-sl' }, lineIdx: -1 };
            refs.activeDragRow.current = slLabelEl;
            slLabelEl.style.cursor = 'grabbing';
            if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
            if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
          },
        });
      }

      pnlUpdaters.push(() => {
        const sp = refs.qoPreviewPrices.current.sl;
        if (sp == null) return;
        const ep = refs.qoPreviewPrices.current.entry;
        const diff = qo.side === OrderSide.Buy ? ep - sp : sp - ep;
        const pnl = calcPnl(diff, contract, qo.orderSize);
        slLine.updateSection(0, `-$${Math.abs(pnl).toFixed(2)}`, '#ff0000');
      });
    }
  }

  // TP labels
  for (let ti = 0; ti < qo.tpPrices.length; ti++) {
    const tpPrice = qo.tpPrices[ti];
    const tpSize = qo.tpSizes[ti] ?? qo.orderSize;
    const tpLine = refs.qoPreviewLines.current.tps[ti];
    if (!tpLine) continue;

    const tpDiff = qo.side === OrderSide.Buy ? tpPrice - qoEntryPrice : qoEntryPrice - tpPrice;
    const tpPnl = calcPnl(tpDiff, contract, tpSize);
    const tpPnlText = `+$${Math.abs(tpPnl).toFixed(2)}`;
    const tpIdx = ti;
    const cancelTp = () => {
      // Cancel the actual Suspended TP order in the gateway (0-1 TP native bracket path)
      const st = useStore.getState();
      const acct = st.activeAccountId;
      const cur = st.qoPendingPreview;
      if (acct && cur) {
        const oppSide = cur.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;
        const suspendedTps = st.openOrders.filter((o) =>
          String(o.contractId) === String(contract.id) &&
          o.status === OrderStatus.Suspended &&
          (o.customTag?.endsWith('-TP') ?? (
            o.side === oppSide &&
            o.type === OrderType.Limit &&
            o.size === cur.orderSize
          )),
        );
        const tpOrder = suspendedTps[tpIdx];
        if (tpOrder) {
          orderService.cancelOrder(acct, tpOrder.id).catch(() => {});
          st.removeOrder(tpOrder.id);
        }
      }

      const tp = refs.qoPreviewLines.current.tps[tpIdx];
      if (tp) {
        tp.destroy();
        refs.qoPreviewLines.current.tps[tpIdx] = null;
      }
      bracketEngine.updateArmedConfig((cfg) => ({
        ...cfg,
        takeProfits: cfg.takeProfits.filter((_, i) => i !== tpIdx),
      }));
      if (cur) {
        const newTpPrices = cur.tpPrices.filter((_, i) => i !== tpIdx);
        const newTpSizes = cur.tpSizes.filter((_, i) => i !== tpIdx);
        refs.qoPreviewLines.current.tps = refs.qoPreviewLines.current.tps.filter((_, i) => i !== tpIdx);
        st.setQoPendingPreview({
          ...cur,
          tpPrices: newTpPrices,
          tpSizes: newTpSizes,
        });
      }
    };

    tpLine.setLabel([
      { text: tpPnlText, bg: '#00c805', color: '#000' },
      { text: String(tpSize), bg: '#00c805', color: '#000' },
      { text: '\u2715', bg: '#e0e0e0', color: '#000' },
    ]);

    const tpCells = tpLine.getCells();
    const tpLabelEl = tpLine.getLabelEl();

    refs.hitTargets.current.push({
      el: tpCells[2], priority: 0,
      handler: () => cancelTp(),
    });

    const qoTpIdx = ti;
    if (tpLabelEl) {
      refs.hitTargets.current.push({
        el: tpLabelEl,
        priority: 2,
        handler: () => {
          refs.previewDragState.current = { role: { kind: 'qo-tp', index: qoTpIdx }, lineIdx: -1 };
          refs.activeDragRow.current = tpLabelEl;
          tpLabelEl.style.cursor = 'grabbing';
          if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
          if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
        },
      });
    }

    const capturedTpIdx = ti;
    const capturedTpSize = tpSize;
    pnlUpdaters.push(() => {
      const tp = refs.qoPreviewPrices.current.tps[capturedTpIdx];
      if (tp == null) return;
      const ep = refs.qoPreviewPrices.current.entry;
      const diff = qo.side === OrderSide.Buy ? tp - ep : ep - tp;
      const pnl = calcPnl(diff, contract, capturedTpSize);
      tpLine.updateSection(0, `+$${Math.abs(pnl).toFixed(2)}`, '#00c805');
    });
  }

  return pnlUpdaters;
}
