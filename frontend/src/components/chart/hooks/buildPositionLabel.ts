import type { Contract } from '../../../services/marketDataService';
import { COLOR_TEXT_MUTED } from '../../../constants/colors';
import { useStore } from '../../../store/useStore';
import { orderService } from '../../../services/orderService';
import { OrderType, OrderSide, PositionType } from '../../../types/enums';
import { calcPnl } from '../../../utils/instrument';
import { markAsManualClose } from '../../../services/manualCloseTracker';
import { showToast, errorMessage } from '../../../utils/toast';
import type { ChartRefs } from './types';
import { LABEL_TEXT, BUY_COLOR, SELL_COLOR, CLOSE_BG } from './labelUtils';

interface Position {
  accountId: number;
  contractId: string;
  averagePrice: number;
  size: number;
  type: number;
}

/**
 * Build the position label on the position PriceLevelLine.
 * Registers close-X and row-drag hit targets.
 * Returns P&L updater closures.
 */
export function buildPositionLabel(
  refs: ChartRefs,
  contract: Contract,
  positions: Position[],
  activeAccountId: number | null,
): (() => void)[] {
  const pnlUpdaters: (() => void)[] = [];

  const pos = positions.find(
    (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
  );
  if (!pos) return pnlUpdaters;

  const isLong = pos.type === PositionType.Long;
  const sideBg = isLong ? BUY_COLOR : SELL_COLOR;

  // Compute initial P&L
  const lp = useStore.getState().lastPrice;
  let initText: string;
  let initBg: string;
  if (lp != null) {
    const diff = isLong ? lp - pos.averagePrice : pos.averagePrice - lp;
    const initPnl = calcPnl(diff, contract, pos.size);
    initText = `${initPnl >= 0 ? '+' : ''}$${initPnl.toFixed(2)}`;
    initBg = initPnl >= 0 ? BUY_COLOR : SELL_COLOR;
    refs.lastPnlCache.current = { text: initText, bg: initBg };
  } else if (refs.lastPnlCache.current.text) {
    initText = refs.lastPnlCache.current.text;
    initBg = refs.lastPnlCache.current.bg;
  } else {
    initText = '---';
    initBg = COLOR_TEXT_MUTED;
  }

  const posIdx = refs.orderLineMeta.current.findIndex((m) => m.kind === 'position');
  const posLine = posIdx >= 0 ? refs.orderLines.current[posIdx] : null;
  if (!posLine) return pnlUpdaters;

  posLine.setLabelLeft(0.65);
  posLine.setLabel([
    { text: initText, bg: initBg, color: LABEL_TEXT },
    { text: String(pos.size), bg: sideBg, color: LABEL_TEXT },
    { text: '\u2715', bg: CLOSE_BG, color: LABEL_TEXT },
  ]);

  const cells = posLine.getCells();
  const labelEl = posLine.getLabelEl();

  // Close-X button (priority 0)
  refs.hitTargets.current.push({
    el: cells[2],
    priority: 0,
    handler: () => {
      const acct = useStore.getState().activeAccountId;
      if (!acct || !contract) return;
      markAsManualClose(contract.id);
      orderService.placeOrder({
        accountId: acct, contractId: contract.id,
        type: OrderType.Market, side: isLong ? OrderSide.Sell : OrderSide.Buy, size: pos.size,
      }).catch((err) => {
        showToast('error', 'Failed to close position', errorMessage(err));
      });
    },
  });

  // Row drag (priority 2)
  if (labelEl) {
    refs.hitTargets.current.push({
      el: labelEl,
      priority: 2,
      handler: () => {
        refs.posDrag.current = {
          isLong,
          posSize: pos.size,
          avgPrice: pos.averagePrice,
          direction: null,
          snappedPrice: pos.averagePrice,
        };
        refs.activeDragRow.current = labelEl;
        labelEl.style.cursor = 'grabbing';
        if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
        if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
      },
    });
  }

  // P&L updater
  pnlUpdaters.push(() => {
    const curPrice = useStore.getState().lastPrice;
    if (curPrice == null) {
      if (refs.lastPnlCache.current.text) {
        posLine.updateSection(0, refs.lastPnlCache.current.text, refs.lastPnlCache.current.bg);
      }
      return;
    }
    const diff = isLong ? curPrice - pos.averagePrice : pos.averagePrice - curPrice;
    const pnl = calcPnl(diff, contract, pos.size);
    const bg = pnl >= 0 ? BUY_COLOR : SELL_COLOR;
    const text = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
    refs.lastPnlCache.current = { text, bg };
    posLine.updateSection(0, text, bg, LABEL_TEXT);
  });

  return pnlUpdaters;
}
