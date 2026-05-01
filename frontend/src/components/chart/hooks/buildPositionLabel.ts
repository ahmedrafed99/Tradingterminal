import type { Contract } from '../../../services/marketDataService';
import { COLOR_TEXT_MUTED } from '../../../constants/colors';
import { useStore } from '../../../store/useStore';
import { orderService } from '../../../services/orderService';
import { OrderType, OrderSide, PositionType } from '../../../types/enums';
import { calcPnl, roundToTick } from '../../../utils/instrument';
import { markAsManualClose } from '../../../services/manualCloseTracker';
import { showToast, errorMessage } from '../../../utils/toast';
import type { ChartRefs } from './types';
import { LABEL_TEXT, BUY_COLOR, SELL_COLOR, CLOSE_BG, contrastText } from './labelUtils';

interface Position {
  accountId: string;
  contractId: string;
  averagePrice: number;
  size: number;
  type: number;
}

/**
 * Configure cells + P&L updater on the position PriceLevelPrimitive.
 * Drag-to-create-SL/TP is handled by the primitive's onDragStart (set in useOrderLines).
 * Returns P&L updater closures.
 */
export function buildPositionLabel(
  refs: ChartRefs,
  contract: Contract,
  positions: Position[],
  activeAccountId: string | null,
): (() => void)[] {
  const pnlUpdaters: (() => void)[] = [];

  const pos = positions.find(
    (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
  );
  if (!pos) return pnlUpdaters;

  const isLong = pos.type === PositionType.Long;
  const sideBg = isLong ? BUY_COLOR : SELL_COLOR;

  const posEntry = refs.orderEntries.current.find((e) => e.meta.kind === 'position');
  const posPrimitive = posEntry?.line ?? null;
  if (!posPrimitive) return pnlUpdaters;

  function fmtPnl(diff: number, pnl: number): string {
    if (useStore.getState().pnlMode === 'points') {
      const pts = roundToTick(diff, contract.tickSize);
      return `${pts >= 0 ? '+' : ''}${pts.toFixed(2)} pts`;
    }
    return `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
  }

  // Compute initial P&L
  const lp = useStore.getState().lastPrice;
  let initText: string;
  let initBg: string;
  if (lp != null) {
    const diff = isLong ? lp - pos.averagePrice : pos.averagePrice - lp;
    const initPnl = calcPnl(diff, contract, pos.size);
    initText = fmtPnl(diff, initPnl);
    initBg = initPnl >= 0 ? BUY_COLOR : SELL_COLOR;
    refs.lastPnlCache.current = { text: initText, bg: initBg };
  } else if (refs.lastPnlCache.current.text) {
    initText = refs.lastPnlCache.current.text;
    initBg = refs.lastPnlCache.current.bg;
  } else {
    initText = '---';
    initBg = COLOR_TEXT_MUTED;
  }

  // Close onClick
  function handleClose(): void {
    const acct = useStore.getState().activeAccountId;
    if (!acct || !contract) return;
    markAsManualClose(contract.id);
    orderService.placeOrder({
      accountId: acct,
      contractId: contract.id,
      type: OrderType.Market,
      side: isLong ? OrderSide.Sell : OrderSide.Buy,
      size: pos.size,
    }).catch((err) => {
      showToast('error', 'Failed to close position', errorMessage(err));
    });
  }

  function togglePnlMode(): void {
    const next = useStore.getState().pnlMode === '$' ? 'points' : '$';
    useStore.getState().setPnlMode(next);
  }

  posPrimitive.setCell('pnl', { text: initText, bg: initBg, color: contrastText(initBg), onClick: togglePnlMode });
  posPrimitive.setCell('size', { text: String(pos.size), bg: sideBg, color: LABEL_TEXT });
  posPrimitive.setCell('close', { text: '✕', bg: CLOSE_BG, color: LABEL_TEXT, onClick: handleClose });
  posPrimitive.setCellOrder(['pnl', 'size', 'close']);

  // P&L updater — skipped during drag to prevent blink
  pnlUpdaters.push(() => {
    if (refs.isDragging.current) return;
    const curPrice = useStore.getState().lastPrice;
    if (curPrice == null) {
      if (refs.lastPnlCache.current.text) {
        posPrimitive.setCell('pnl', {
          text: refs.lastPnlCache.current.text,
          bg: refs.lastPnlCache.current.bg,
          color: contrastText(refs.lastPnlCache.current.bg),
          onClick: togglePnlMode,
        });
      }
      return;
    }
    const diff = isLong ? curPrice - pos.averagePrice : pos.averagePrice - curPrice;
    const pnl = calcPnl(diff, contract, pos.size);
    const bg = pnl >= 0 ? BUY_COLOR : SELL_COLOR;
    const text = fmtPnl(diff, pnl);
    refs.lastPnlCache.current = { text, bg };
    posPrimitive.setCell('pnl', { text, bg, color: contrastText(bg), onClick: togglePnlMode });
  });

  return pnlUpdaters;
}
