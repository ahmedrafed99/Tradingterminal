import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { orderService, type PlaceOrderParams, type Order } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { OrderType, OrderSide, PositionType } from '../../../types/enums';
import { calcPnl } from '../../../utils/instrument';
import { showToast, errorMessage } from '../../../utils/toast';
import { resolvePreviewConfig, fitTpsToOrderSize } from './resolvePreviewConfig';
import { buildNativeBracketParams, buildNativeSLOnly } from '../../../types/bracket';
import type { ChartRefs, PreviewLineRole } from './types';

/**
 * Configures labels on PriceLevelLine instances, registers hit targets,
 * and runs the sync loop (scroll/zoom/resize/tick repositioning).
 *
 * Labels are added via `line.setLabel(sections)` on PriceLevelLine instances
 * that were created by useOrderLines / useQuickOrder.
 */
export function useOverlayLabels(
  refs: ChartRefs,
  contract: Contract | null,
  isOrderChart: boolean,
): void {

  // Store selectors needed for overlay label rebuild
  const openOrders = useStore((s) => s.openOrders);
  const positions = useStore((s) => s.positions);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const previewEnabled = useStore((s) => s.previewEnabled);
  const previewSide = useStore((s) => s.previewSide);
  const previewHideEntry = useStore((s) => s.previewHideEntry);
  const bracketPresets = useStore((s) => s.bracketPresets);
  const activePresetId = useStore((s) => s.activePresetId);
  const orderType = useStore((s) => s.orderType);
  const limitPrice = useStore((s) => s.limitPrice);
  const orderSize = useStore((s) => s.orderSize);
  const draftSlPoints = useStore((s) => s.draftSlPoints);
  const draftTpPoints = useStore((s) => s.draftTpPoints);
  const adHocSlPoints = useStore((s) => s.adHocSlPoints);
  const adHocTpLevels = useStore((s) => s.adHocTpLevels);
  const qoPendingPreview = useStore((s) => s.qoPendingPreview);

  // -- Label configuration + hit-target registration --
  useEffect(() => {
    if (!isOrderChart) return;
    const overlay = refs.overlay.current;
    const series = refs.series.current;
    if (!overlay || !series) return;

    // Clear previous labels + hit targets
    for (const line of refs.previewLines.current) line.setLabel(null);
    for (const line of refs.orderLines.current) line.setLabel(null);
    // Only strip qo preview labels if qoPendingPreview is active (this effect owns those labels).
    // Hover-preview labels are baked in by useQuickOrder's createPreviewLines() — not ours to clear.
    if (qoPendingPreview) {
      const qoPrev = refs.qoPreviewLines.current;
      if (qoPrev.sl) qoPrev.sl.setLabel(null);
      for (const tp of qoPrev.tps) if (tp) tp.setLabel(null);
    }
    refs.hitTargets.current = [];

    // P&L updater closures — called every frame in updatePositions()
    const pnlUpdaters: (() => void)[] = [];

    // Text color helper: always black
    function textFor(_bg: string): string {
      return '#000';
    }

    // Darken a hex color by a factor (0–1, where 0.85 = 15% darker)
    function darken(hex: string, factor = 0.82): string {
      const h = hex.replace('#', '');
      const r = Math.round(parseInt(h.substring(0, 2), 16) * factor);
      const g = Math.round(parseInt(h.substring(2, 4), 16) * factor);
      const b = Math.round(parseInt(h.substring(4, 6), 16) * factor);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // --- Position label ---
    if (contract) {
      const pos = positions.find(
        (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
      );
      if (pos) {
        const isLong = pos.type === PositionType.Long;
        const sideBg = isLong ? '#00c805' : '#ff0000';

        // Compute initial P&L — use cached value if lastPrice not yet available
        const lp = useStore.getState().lastPrice;
        let initText: string;
        let initBg: string;
        if (lp != null) {
          const diff = isLong ? lp - pos.averagePrice : pos.averagePrice - lp;
          const initPnl = calcPnl(diff, contract, pos.size);
          initText = `${initPnl >= 0 ? '+' : ''}$${initPnl.toFixed(2)}`;
          initBg = initPnl >= 0 ? '#00c805' : '#ff0000';
          refs.lastPnlCache.current = { text: initText, bg: initBg };
        } else if (refs.lastPnlCache.current.text) {
          initText = refs.lastPnlCache.current.text;
          initBg = refs.lastPnlCache.current.bg;
        } else {
          initText = '---';
          initBg = '#787b86';
        }

        // Find the position PriceLevelLine
        const posIdx = refs.orderLineMeta.current.findIndex((m) => m.kind === 'position');
        const posLine = posIdx >= 0 ? refs.orderLines.current[posIdx] : null;
        if (posLine) {
          posLine.setLabelLeft(0.65);
          posLine.setLabel([
            { text: initText, bg: initBg, color: textFor(initBg) },
            { text: String(pos.size), bg: sideBg, color: textFor(sideBg) },
            { text: '\u2715', bg: '#e0e0e0', color: '#000' },
          ]);

          const cells = posLine.getCells();
          const labelEl = posLine.getLabelEl();

          // Register close-X button (priority 0)
          refs.hitTargets.current.push({
            el: cells[2],
            priority: 0,
            handler: () => {
              const acct = useStore.getState().activeAccountId;
              if (!acct || !contract) return;
              orderService.placeOrder({
                accountId: acct, contractId: contract.id,
                type: OrderType.Market, side: isLong ? OrderSide.Sell : OrderSide.Buy, size: pos.size,
              }).catch((err) => {
                showToast('error', 'Failed to close position', errorMessage(err));
              });
            },
          });

          // Register row drag (priority 2)
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
            const bg = pnl >= 0 ? '#00c805' : '#ff0000';
            const text = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
            refs.lastPnlCache.current = { text, bg };
            posLine.updateSection(0, text, bg, textFor(bg));
          });
        }
      }
    }

    // TP size +/- button sub-element refs (keyed by orderId)
    const tpSizeButtons = new Map<number, {
      minusEl: HTMLDivElement; plusEl: HTMLDivElement;
      countEl: HTMLDivElement; sizeCell: HTMLDivElement;
      sizeBg: string;
    }>();

    // Redistribution handler for TP size +/- buttons
    async function handleRedistribute(
      clickedOrderId: number,
      clickedSize: number,
      delta: 1 | -1,
      allTps: Order[],
      isLong: boolean,
    ) {
      if (refs.tpRedistInFlight.current) return;
      refs.tpRedistInFlight.current = true;

      const acct = useStore.getState().activeAccountId;
      if (!acct) { refs.tpRedistInFlight.current = false; return; }

      const newClickedSize = clickedSize + delta;

      // Sort other TPs by distance from entry (furthest first)
      const otherTps = allTps
        .filter(o => o.id !== clickedOrderId)
        .sort((a, b) => {
          const aP = a.limitPrice ?? 0;
          const bP = b.limitPrice ?? 0;
          return isLong ? bP - aP : aP - bP;
        });

      let targetOrderId: number | null = null;
      let targetNewSize: number | null = null;

      if (delta === 1) {
        // Take 1 from furthest with spare (size > 1), or from unallocated
        const donor = otherTps.find(o => o.size > 1);
        if (donor) {
          targetOrderId = donor.id;
          targetNewSize = donor.size - 1;
        }
      } else {
        // Give 1 to furthest, or to unallocated if no other TPs
        const recipient = otherTps[0];
        if (recipient) {
          targetOrderId = recipient.id;
          targetNewSize = recipient.size + 1;
        }
      }

      // Step 1: modify clicked TP
      try {
        await orderService.modifyOrder({ accountId: acct, orderId: clickedOrderId, size: newClickedSize });
        bracketEngine.updateTPSize(clickedOrderId, newClickedSize);
      } catch (err) {
        showToast('error', 'Failed to modify TP size', errorMessage(err));
        refs.tpRedistInFlight.current = false;
        return;
      }

      // Step 2: modify counterpart (if needed)
      if (targetOrderId != null && targetNewSize != null) {
        try {
          await orderService.modifyOrder({ accountId: acct, orderId: targetOrderId, size: targetNewSize });
          bracketEngine.updateTPSize(targetOrderId, targetNewSize);
        } catch (err) {
          showToast('warning', 'Partial TP resize failed, reverting', errorMessage(err));
          try {
            await orderService.modifyOrder({ accountId: acct, orderId: clickedOrderId, size: clickedSize });
            bracketEngine.updateTPSize(clickedOrderId, clickedSize);
          } catch {
            showToast('error', 'TP sizes may be inconsistent', 'Check open orders and adjust manually.');
          }
        }
      }

      refs.tpRedistInFlight.current = false;
    }

    // --- Open order labels (SL/TP show projected P&L) ---
    const pos = contract ? positions.find(
      (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
    ) : undefined;

    for (const order of openOrders) {
      if (!contract || String(order.contractId) !== String(contract.id)) continue;
      let price: number | undefined;
      if (order.type === OrderType.Stop || order.type === OrderType.TrailingStop) {
        price = order.stopPrice;
      } else if (order.type === OrderType.Limit) {
        price = order.limitPrice;
      } else {
        continue;
      }
      if (price == null) continue;

      const orderId = order.id;
      const oSize = order.size;
      const oSide = order.side;
      const oType = order.type;

      // P&L color by profit/loss relative to position
      function profitColor(p: number): string {
        if (pos) {
          const isL = pos.type === PositionType.Long;
          return (isL ? p >= pos.averagePrice : p <= pos.averagePrice) ? '#00c805' : '#ff0000';
        }
        return (oType === OrderType.Stop || oType === OrderType.TrailingStop) ? '#ff0000'
          : oSide === OrderSide.Sell ? '#ff0000' : '#00c805';
      }
      // Size cell color by order side (sell=red, buy=green)
      const sizeBg = oSide === OrderSide.Sell ? '#ff0000' : '#00c805';

      // Lookup current price from refs (changes during drag)
      function getOrderRefPrice(): number {
        for (let k = 0; k < refs.orderLineMeta.current.length; k++) {
          const m = refs.orderLineMeta.current[k];
          if (m.kind === 'order' && m.order.id === orderId) {
            return refs.orderLinePrices.current[k];
          }
        }
        return price!;
      }

      // Compute projected P&L
      let initPnlText: string;
      let initPnlBg: string;
      let orderPnlCompute: (() => { text: string; bg: string; color?: string }) | null = null;

      if (pos) {
        const isLong = pos.type === PositionType.Long;
        const diff = isLong ? price - pos.averagePrice : pos.averagePrice - price;
        const projPnl = calcPnl(diff, contract!, oSize);
        initPnlText = `${projPnl >= 0 ? '+' : ''}$${projPnl.toFixed(2)}`;
        initPnlBg = profitColor(price);

        orderPnlCompute = () => {
          const curPrice = getOrderRefPrice();
          const d = isLong ? curPrice - pos.averagePrice : pos.averagePrice - curPrice;
          const pnl = calcPnl(d, contract!, oSize);
          const bg = profitColor(curPrice);
          return {
            text: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
            bg,
            color: textFor(bg),
          };
        };
      } else {
        // No position — SL/TP labels are meaningless (order is about to be cancelled)
        if (oType === OrderType.Stop || oType === OrderType.TrailingStop) continue;
        initPnlText = oSide === OrderSide.Buy ? 'Buy Limit' : 'Sell Limit';
        initPnlBg = '#cac9cb';
      }

      // Find the matching PriceLevelLine for this order
      let orderLineIdx = -1;
      for (let k = 0; k < refs.orderLineMeta.current.length; k++) {
        const m = refs.orderLineMeta.current[k];
        if (m.kind === 'order' && m.order.id === orderId) {
          orderLineIdx = k;
          break;
        }
      }
      const orderLine = orderLineIdx >= 0 ? refs.orderLines.current[orderLineIdx] : null;
      if (!orderLine) continue;

      // Shift entry-order labels right so they don't overlap SL/TP labels
      const isEntryOrder = oType === OrderType.Limit && (
        (qoPendingPreview != null && oSide === qoPendingPreview.side) ||
        (previewHideEntry && oSide === previewSide)
      );
      if (isEntryOrder) orderLine.setLabelLeft(0.65);

      orderLine.setLabel([
        { text: initPnlText, bg: initPnlBg, color: initPnlBg === '#cac9cb' ? '#000' : textFor(initPnlBg) },
        { text: String(oSize), bg: sizeBg, color: textFor(sizeBg) },
        { text: '\u2715', bg: '#e0e0e0', color: '#000' },
      ]);

      const cells = orderLine.getCells();
      const labelEl = orderLine.getLabelEl();

      // --- TP size +/- buttons (only for live TPs with a multi-contract position) ---
      const isLiveTP = pos
        && pos.size > 1
        && oType === OrderType.Limit
        && oSide === (pos.type === PositionType.Long ? OrderSide.Sell : OrderSide.Buy);

      if (isLiveTP) {
        const oppSide = pos.type === PositionType.Long ? OrderSide.Sell : OrderSide.Buy;
        const allTps = openOrders.filter(o =>
          String(o.contractId) === String(contract!.id)
          && o.type === OrderType.Limit
          && o.side === oppSide,
        );
        const totalTpSize = allTps.reduce((sum, o) => sum + o.size, 0);
        const unallocated = pos.size - totalTpSize;
        const minusDisabled = oSize <= 1;
        const othersHaveSpare = allTps.some(o => o.id !== orderId && o.size > 1);
        const plusDisabled = !othersHaveSpare && unallocated <= 0;
        const isLong = pos.type === PositionType.Long;

        // Customize size cell with −/+ sub-elements
        const sizeCell = cells[1];
        sizeCell.style.display = 'flex';
        sizeCell.style.alignItems = 'center';
        sizeCell.style.padding = '0';
        sizeCell.style.transition = 'background 0.15s';
        sizeCell.textContent = '';
        sizeCell.dataset.screenshotText = String(oSize);

        const minusEl = document.createElement('div');
        minusEl.textContent = '\u2212';
        minusEl.style.cssText = `display:none;padding:0 3px;cursor:${minusDisabled ? 'default' : 'pointer'};opacity:${minusDisabled ? '0.5' : '1'};transition:opacity 0.15s, transform 0.15s;`;
        minusEl.addEventListener('mouseenter', () => { minusEl.style.transform = 'scale(1.4)'; });
        minusEl.addEventListener('mouseleave', () => { minusEl.style.transform = ''; });

        const countEl = document.createElement('div');
        countEl.textContent = String(oSize);
        countEl.style.cssText = 'padding:0 4px;';

        const plusEl = document.createElement('div');
        plusEl.textContent = '+';
        plusEl.style.cssText = `display:none;padding:0 3px;cursor:${plusDisabled ? 'default' : 'pointer'};opacity:${plusDisabled ? '0.5' : '1'};transition:opacity 0.15s, transform 0.15s;`;
        plusEl.addEventListener('mouseenter', () => { plusEl.style.transform = 'scale(1.4)'; });
        plusEl.addEventListener('mouseleave', () => { plusEl.style.transform = ''; });

        sizeCell.appendChild(minusEl);
        sizeCell.appendChild(countEl);
        sizeCell.appendChild(plusEl);

        tpSizeButtons.set(orderId, { minusEl, plusEl, countEl, sizeCell, sizeBg });

        // Persist hover across label rebuilds
        if (refs.hoveredTpOrderId.current === orderId) {
          minusEl.style.display = '';
          plusEl.style.display = '';
          sizeCell.style.background = darken(sizeBg);
        }

        // Register hit targets for enabled +/- buttons (priority 0)
        if (!minusDisabled) {
          refs.hitTargets.current.push({
            el: minusEl, priority: 0,
            handler: () => handleRedistribute(orderId, oSize, -1, allTps, isLong),
          });
        }
        if (!plusDisabled) {
          refs.hitTargets.current.push({
            el: plusEl, priority: 0,
            handler: () => handleRedistribute(orderId, oSize, 1, allTps, isLong),
          });
        }
      }

      // Register cancel-X button (priority 0)
      refs.hitTargets.current.push({
        el: cells[2],
        priority: 0,
        handler: () => {
          const acct = useStore.getState().activeAccountId;
          if (!acct) return;
          orderService.cancelOrder(acct, orderId).catch((err) => {
            showToast('error', 'Failed to cancel order', errorMessage(err));
          });
        },
      });

      // Register row drag (priority 1 — wins over position row-drag when overlapping)
      const dragOrder = order;
      if (labelEl) {
        refs.hitTargets.current.push({
          el: labelEl,
          priority: 1,
          handler: () => {
            let idx = -1;
            for (let k = 0; k < refs.orderLineMeta.current.length; k++) {
              const m = refs.orderLineMeta.current[k];
              if (m.kind === 'order' && m.order.id === dragOrder.id) { idx = k; break; }
            }
            if (idx === -1) return;
            refs.orderDragState.current = {
              meta: { kind: 'order', order: dragOrder },
              idx,
              originalPrice: refs.orderLinePrices.current[idx],
              draggedPrice: refs.orderLinePrices.current[idx],
            };
            refs.activeDragRow.current = labelEl;
            labelEl.style.cursor = 'grabbing';
            if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
            if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
          },
        });
      }

      // P&L updater
      if (orderPnlCompute) {
        const compute = orderPnlCompute;
        pnlUpdaters.push(() => {
          const result = compute();
          orderLine.updateSection(0, result.text, result.bg, result.color);
        });
      }
    }

    // --- TP size +/- hover detection ---
    const hoverContainer = refs.container.current;
    const onTpSizeHover = (e: MouseEvent) => {
      const mx = e.clientX;
      const my = e.clientY;
      let foundId: number | null = null;

      for (const [oid, btns] of tpSizeButtons) {
        const rect = btns.sizeCell.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
          foundId = oid;
          break;
        }
      }

      if (foundId !== refs.hoveredTpOrderId.current) {
        // Hide previous — restore backgrounds
        if (refs.hoveredTpOrderId.current != null) {
          const prev = tpSizeButtons.get(refs.hoveredTpOrderId.current);
          if (prev) {
            prev.minusEl.style.display = 'none';
            prev.plusEl.style.display = 'none';
            prev.sizeCell.style.background = prev.sizeBg;
          }
        }
        // Show new — darken size cell bg
        if (foundId != null) {
          const cur = tpSizeButtons.get(foundId);
          if (cur) {
            cur.minusEl.style.display = '';
            cur.plusEl.style.display = '';
            cur.sizeCell.style.background = darken(cur.sizeBg);
          }
        }
        refs.hoveredTpOrderId.current = foundId;
      }
    };
    if (hoverContainer) {
      hoverContainer.addEventListener('mousemove', onTpSizeHover);
    }

    // --- Preview labels ---
    const snap2 = useStore.getState();
    const pvSide = snap2.previewSide;
    const previewTotalSize = snap2.orderSize;
    const hasPreset = snap2.bracketPresets.some((p) => p.id === snap2.activePresetId);
    const previewPreset = snap2.bracketPresets.find((p) => p.id === snap2.activePresetId);
    const previewTpSizes = hasPreset
      ? fitTpsToOrderSize(previewPreset?.config.takeProfits ?? [], snap2.orderSize).map((tp) => tp.size)
      : fitTpsToOrderSize(snap2.adHocTpLevels, snap2.orderSize).map((tp) => tp.size);

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
        // Skip entry label entirely when hidden (limit order already placed)
        if (snap2.previewHideEntry) continue;
        pnlText = pvSide === OrderSide.Buy ? 'Limit Buy' : 'Limit Sell';
        pnlBg = '#cac9cb';
        displaySize = previewTotalSize;
        onCancel = () => useStore.getState().togglePreview();
        onExecute = async () => {
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

          // Use resolvePreviewConfig for both preset and ad-hoc brackets
          const mergedConfig = resolvePreviewConfig();
          const bracketsActive = mergedConfig != null
            && (mergedConfig.stopLoss.points >= 1 || mergedConfig.takeProfits.length >= 1);

          let engineArmed = false;
          if (bracketsActive && mergedConfig) {
            // Use full native brackets for <= 1 TP, native SL only for 2+ TPs
            const nativeBrackets = buildNativeBracketParams(mergedConfig, side, contract);
            if (nativeBrackets) {
              Object.assign(params, nativeBrackets);
            } else {
              // 2+ TPs — attach native SL, engine handles TPs after fill
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
              // Limit: hide entry line (real order covers it), keep SL/TP visible
              useStore.setState({ previewHideEntry: true });
            }
          } catch (err) {
            showToast('error', 'Order placement failed', errorMessage(err));
            if (engineArmed) bracketEngine.clearSession();
          }
        };
      } else if (role.kind === 'sl') {
        // SL projected P&L (always negative, full position size)
        displaySize = previewTotalSize;
        const entryPrice = refs.previewPrices.current[0] ?? 0;
        const slDiff = pvSide === OrderSide.Buy ? entryPrice - price : price - entryPrice;
        const slPnl = calcPnl(slDiff, contract!, displaySize);
        pnlText = `-$${Math.abs(slPnl).toFixed(2)}`;
        pnlBg = '#ff0000';
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
          const pnl = calcPnl(diff, contract!, sz);
          return {
            text: `-$${Math.abs(pnl).toFixed(2)}`,
            bg: '#ff0000',
          };
        };
      } else {
        // TP projected P&L — use individual TP size
        displaySize = previewTpSizes[role.index] ?? previewTotalSize;
        const entryPrice = refs.previewPrices.current[0] ?? 0;
        const tpDiff = pvSide === OrderSide.Buy ? price - entryPrice : entryPrice - price;
        const tpPnl = calcPnl(tpDiff, contract!, displaySize);
        pnlText = `+$${Math.abs(tpPnl).toFixed(2)}`;
        pnlBg = '#00c805';
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
          const pnl = calcPnl(diff, contract!, sz);
          return {
            text: `+$${Math.abs(pnl).toFixed(2)}`,
            bg: '#00c805',
            color: '#000',
          };
        };
      }

      const previewIdx = i;
      const isEntry = role.kind === 'entry';
      const entrySideBg = pvSide === OrderSide.Buy ? '#00c805' : '#ff0000';
      const sizeBg = isEntry ? entrySideBg : role.kind === 'sl' ? '#ff0000' : '#00c805';

      // Build sections array — entry label gets +SL/+TP buttons when no preset
      const sections: { text: string; bg: string; color: string }[] = [
        { text: pnlText, bg: pnlBg, color: isEntry ? '#000' : textFor(pnlBg) },
        { text: String(displaySize), bg: sizeBg, color: textFor(sizeBg) },
      ];

      // Track which cell indices are buttons (for hit-target registration)
      const buttonCells: { index: number; handler: () => void }[] = [];

      // +SL / +TP buttons on entry label when no preset is active
      if (isEntry && !hasPreset) {
        const curAdHocSl = snap2.adHocSlPoints;
        const allocatedTpSize = snap2.adHocTpLevels.reduce((sum, tp) => sum + tp.size, 0);
        const remainingContracts = previewTotalSize - allocatedTpSize;

        if (curAdHocSl == null) {
          const slBtnIdx = sections.length;
          sections.push({ text: '+SL', bg: '#ff444480', color: '#000' });
          buttonCells.push({ index: slBtnIdx, handler: () => useStore.getState().setAdHocSlPoints(10) });
        }
        if (remainingContracts > 0) {
          const tpBtnIdx = sections.length;
          sections.push({ text: '+TP', bg: '#00c80580', color: '#000' });
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
      sections.push({ text: '\u2715', bg: '#e0e0e0', color: '#000' });
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

    // --- Quick order pending preview labels (+ button brackets awaiting fill) ---
    if (qoPendingPreview) {
      const qo = qoPendingPreview;
      const qoEntryPrice = qo.entryPrice;

      // Initialize mutable prices ref (used by priceGetter during drag)
      refs.qoPreviewPrices.current = { entry: qo.entryPrice, sl: qo.slPrice, tps: [...qo.tpPrices] };

      // SL label — cancel removes SL from armed config + preview
      if (qo.slPrice != null) {
        const slLine = refs.qoPreviewLines.current.sl;
        if (slLine) {
          const slDiff = qo.side === OrderSide.Buy ? qoEntryPrice - qo.slPrice : qo.slPrice - qoEntryPrice;
          const slPnl = calcPnl(slDiff, contract!, qo.orderSize);
          const slPnlText = `-$${Math.abs(slPnl).toFixed(2)}`;
          const cancelSl = () => {
            // Destroy the SL PriceLevelLine
            const sl = refs.qoPreviewLines.current.sl;
            if (sl) {
              sl.destroy();
              refs.qoPreviewLines.current.sl = null;
            }
            bracketEngine.updateArmedConfig((cfg) => ({
              ...cfg,
              stopLoss: { ...cfg.stopLoss, points: 0 },
            }));
            const cur = useStore.getState().qoPendingPreview;
            if (cur) useStore.getState().setQoPendingPreview({ ...cur, slPrice: null });
          };

          slLine.setLabel([
            { text: slPnlText, bg: '#ff0000', color: '#000' },
            { text: String(qo.orderSize), bg: '#ff0000', color: '#000' },
            { text: '\u2715', bg: '#e0e0e0', color: '#000' },
          ]);

          const slCells = slLine.getCells();
          const slLabelEl = slLine.getLabelEl();

          // Cancel-X (priority 0)
          refs.hitTargets.current.push({
            el: slCells[2], priority: 0,
            handler: () => cancelSl(),
          });

          // Row drag (priority 2)
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

          // P&L updater
          pnlUpdaters.push(() => {
            const sp = refs.qoPreviewPrices.current.sl;
            if (sp == null) return;
            const ep = refs.qoPreviewPrices.current.entry;
            const diff = qo.side === OrderSide.Buy ? ep - sp : sp - ep;
            const pnl = calcPnl(diff, contract!, qo.orderSize);
            slLine.updateSection(0, `-$${Math.abs(pnl).toFixed(2)}`, '#ff0000');
          });
        }
      }

      // TP labels — each cancel removes that specific TP
      for (let ti = 0; ti < qo.tpPrices.length; ti++) {
        const tpPrice = qo.tpPrices[ti];
        const tpSize = qo.tpSizes[ti] ?? qo.orderSize;
        const tpLine = refs.qoPreviewLines.current.tps[ti];
        if (!tpLine) continue;

        const tpDiff = qo.side === OrderSide.Buy ? tpPrice - qoEntryPrice : qoEntryPrice - tpPrice;
        const tpPnl = calcPnl(tpDiff, contract!, tpSize);
        const tpPnlText = `+$${Math.abs(tpPnl).toFixed(2)}`;
        const tpIdx = ti;
        const cancelTp = () => {
          // Destroy the TP PriceLevelLine
          const tp = refs.qoPreviewLines.current.tps[tpIdx];
          if (tp) {
            tp.destroy();
            refs.qoPreviewLines.current.tps[tpIdx] = null;
          }
          bracketEngine.updateArmedConfig((cfg) => ({
            ...cfg,
            takeProfits: cfg.takeProfits.filter((_, i) => i !== tpIdx),
          }));
          const cur = useStore.getState().qoPendingPreview;
          if (cur) {
            const newTpPrices = cur.tpPrices.filter((_, i) => i !== tpIdx);
            const newTpSizes = cur.tpSizes.filter((_, i) => i !== tpIdx);
            refs.qoPreviewLines.current.tps = refs.qoPreviewLines.current.tps.filter((_, i) => i !== tpIdx);
            useStore.getState().setQoPendingPreview({
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

        // Cancel-X (priority 0)
        refs.hitTargets.current.push({
          el: tpCells[2], priority: 0,
          handler: () => cancelTp(),
        });

        // Row drag (priority 2)
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

        // P&L updater
        const capturedTpIdx = ti;
        const capturedTpSize = tpSize;
        pnlUpdaters.push(() => {
          const tp = refs.qoPreviewPrices.current.tps[capturedTpIdx];
          if (tp == null) return;
          const ep = refs.qoPreviewPrices.current.entry;
          const diff = qo.side === OrderSide.Buy ? tp - ep : ep - tp;
          const pnl = calcPnl(diff, contract!, capturedTpSize);
          tpLine.updateSection(0, `+$${Math.abs(pnl).toFixed(2)}`, '#00c805');
        });
      }
    }

    // --- Sync function (repositions all lines + updates P&L) ---
    function updatePositions() {
      // Sync all PriceLevelLine positions
      for (const line of refs.previewLines.current) line.syncPosition();
      for (const line of refs.orderLines.current) line.syncPosition();
      const qoLines = refs.qoPreviewLines.current;
      if (qoLines.sl) qoLines.sl.syncPosition();
      for (const tp of qoLines.tps) if (tp) tp.syncPosition();
      if (refs.posDragLine.current) refs.posDragLine.current.syncPosition();

      // Reposition raw posDragLabel if active
      if (refs.posDragLabel.current && refs.posDrag.current && refs.series.current) {
        const y = refs.series.current.priceToCoordinate(refs.posDrag.current.snappedPrice);
        if (y !== null) {
          refs.posDragLabel.current.style.top = `${y}px`;
          refs.posDragLabel.current.style.display = 'flex';
        } else {
          refs.posDragLabel.current.style.display = 'none';
        }
      }

      // Update P&L text on labels
      for (const updater of pnlUpdaters) updater();
    }

    updatePositions();
    refs.updateOverlay.current = updatePositions;

    // Subscribe to lastPrice changes directly (bypasses React render cycle → no DOM rebuild flicker)
    let prevLp = useStore.getState().lastPrice;
    const unsub = useStore.subscribe((state) => {
      if (state.lastPrice !== prevLp) {
        prevLp = state.lastPrice;
        updatePositions();
      }
    });

    return () => {
      unsub();
      if (hoverContainer) hoverContainer.removeEventListener('mousemove', onTpSizeHover);
      // Remove labels from all lines (don't destroy — that's the owning hook's job)
      for (const line of refs.previewLines.current) line.setLabel(null);
      for (const line of refs.orderLines.current) line.setLabel(null);
      // Only strip qo preview labels if this effect actually created them (qoPendingPreview path).
      // Hover-preview labels are baked in by useQuickOrder's createPreviewLines() — stripping them
      // here would leave lines without labels when unrelated deps (e.g. orderSize) change.
      if (qoPendingPreview) {
        const qoClean = refs.qoPreviewLines.current;
        if (qoClean.sl) qoClean.sl.setLabel(null);
        for (const tp of qoClean.tps) if (tp) tp.setLabel(null);
      }
      refs.hitTargets.current = [];
      refs.updateOverlay.current = () => {};
    };
  }, [isOrderChart, openOrders, positions, contract, activeAccountId, previewEnabled, previewSide, previewHideEntry,
    bracketPresets, activePresetId, orderType, limitPrice, orderSize,
    draftSlPoints, draftTpPoints, adHocSlPoints, adHocTpLevels, qoPendingPreview]);

  // -- Sync overlay positions on chart scroll/zoom/resize/price-scale-drag --
  useEffect(() => {
    const chart = refs.chart.current;
    const container = refs.container.current;
    if (!chart || !container) return;

    const handler = () => refs.updateOverlay.current();

    // Horizontal time-scale changes
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);

    // Container resize
    const ro = new ResizeObserver(handler);
    ro.observe(container);

    // rAF loop during any pointer interaction (covers vertical pan + price scale stretch)
    let rafId = 0;
    function rafLoop() {
      handler();
      rafId = requestAnimationFrame(rafLoop);
    }
    function onPointerDown() {
      cancelAnimationFrame(rafId);
      rafLoop();
    }
    function onPointerUp() {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    // Wheel zoom (vertical or horizontal)
    container.addEventListener('wheel', handler, { passive: true });

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
      ro.disconnect();
      cancelAnimationFrame(rafId);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('wheel', handler);
    };
  }, []);
}
