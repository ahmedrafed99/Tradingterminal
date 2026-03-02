import { useEffect } from 'react';
import type { Contract } from '../../../services/marketDataService';
import { useStore } from '../../../store/useStore';
import { orderService, type PlaceOrderParams } from '../../../services/orderService';
import { bracketEngine } from '../../../services/bracketEngine';
import { showToast, errorMessage } from '../../../utils/toast';
import { resolvePreviewConfig } from './resolvePreviewConfig';
import type { ChartRefs, PreviewLineRole } from './types';

/**
 * Handles overlay HTML labels positioned over price lines:
 * - Position label (P&L, size, close-X)
 * - Open order labels (projected P&L, size, cancel-X)
 * - Preview labels (entry, SL, TP with +SL/+TP buttons)
 * - Quick-order pending preview labels
 * - Overlay sync (scroll/zoom/resize repositioning)
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

  // -- Overlay label system (HTML labels positioned over price lines) --
  useEffect(() => {
    if (!isOrderChart) return;
    const overlay = refs.overlay.current;
    const series = refs.series.current;
    if (!overlay || !series) return;

    // Clear previous labels + hit targets
    overlay.innerHTML = '';
    refs.hitTargets.current = [];

    const tickSize = contract?.tickSize || 0.25;
    const tickValue = contract?.tickValue || 0.50;

    type OverlayEl = {
      root: HTMLDivElement;
      priceGetter: () => number;
      pnlCell: HTMLDivElement | null;
      pnlCompute: (() => { text: string; bg: string; color?: string } | null) | null;
    };

    const overlayEls: OverlayEl[] = [];

    // Helper to build a row with sections.
    // All elements are pointer-events:none — interaction is handled via
    // coordinate-based hit testing at the container level (hitTargetsRef).
    function buildRow(
      sections: { text: string; bg: string; color: string; pointerEvents?: boolean; onClick?: () => void }[],
    ): { root: HTMLDivElement; firstCell: HTMLDivElement; cells: HTMLDivElement[] } {
      const row = document.createElement('div');
      row.style.cssText = 'position:absolute;left:50%;display:flex;height:20px;font-size:11px;font-weight:bold;font-family:-apple-system,BlinkMacSystemFont,Trebuchet MS,Roboto,Ubuntu,sans-serif;line-height:20px;transform:translate(-50%,-50%);white-space:nowrap;border-radius:3px;overflow:hidden;';
      let firstCell!: HTMLDivElement;
      const cells: HTMLDivElement[] = [];
      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        const cell = document.createElement('div');
        cell.style.cssText = `background:${sec.bg};color:${sec.color};padding:0 6px;${si > 0 ? 'border-left:1px solid #000;' : ''}`;
        cell.textContent = sec.text;
        if (si === 0) firstCell = cell;
        cells.push(cell);
        row.appendChild(cell);
      }
      overlay!.appendChild(row);
      return { root: row, firstCell, cells };
    }

    // Register button cells (close-X, +SL, +TP) as priority-0 hit targets
    function registerCellHitTargets(
      sections: { pointerEvents?: boolean; onClick?: () => void }[],
      cells: HTMLDivElement[],
    ) {
      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        if (sec.pointerEvents && sec.onClick) {
          const handler = sec.onClick;
          refs.hitTargets.current.push({
            el: cells[si],
            priority: 0,
            handler: () => handler(),
          });
        }
      }
    }

    // Text color helper: always black
    function textFor(_bg: string): string {
      return '#000';
    }

    // --- Position label ---
    if (contract) {
      const pos = positions.find(
        (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
      );
      if (pos) {
        const isLong = pos.type === 1;
        const sideBg = isLong ? '#00c805' : '#ff0000';

        // Compute initial P&L — use cached value if lastPrice not yet available
        const lp = useStore.getState().lastPrice;
        let initText: string;
        let initBg: string;
        if (lp != null) {
          const diff = isLong ? lp - pos.averagePrice : pos.averagePrice - lp;
          const initPnl = (diff / tickSize) * tickValue * pos.size;
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

        const posSections = [
          { text: initText, bg: initBg, color: textFor(initBg) },
          { text: String(pos.size), bg: sideBg, color: textFor(sideBg) },
          {
            text: '\u2715', bg: '#e0e0e0', color: '#000', pointerEvents: true,
            onClick: () => {
              const acct = useStore.getState().activeAccountId;
              if (!acct || !contract) return;
              orderService.placeOrder({
                accountId: acct, contractId: contract.id,
                type: 2, side: isLong ? 1 : 0, size: pos.size,
              }).catch((err) => {
                console.error('Failed to close position:', err);
                showToast('error', 'Failed to close position', errorMessage(err));
              });
            },
          },
        ];
        const { root, firstCell, cells } = buildRow(posSections);

        // Register close-X button + row drag via hit-target system (no pointer-events on DOM)
        registerCellHitTargets(posSections, cells);
        refs.hitTargets.current.push({
          el: root,
          priority: 2,
          handler: () => {
            refs.posDrag.current = {
              isLong,
              posSize: pos.size,
              avgPrice: pos.averagePrice,
              direction: null,
              snappedPrice: pos.averagePrice,
            };
            refs.activeDragRow.current = root;
            root.style.cursor = 'grabbing';
            if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
            // Disable LWC scroll/scale so the chart doesn't pan during drag
            if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
          },
        });

        overlayEls.push({
          root,
          priceGetter: () => pos.averagePrice,
          pnlCell: firstCell,

          pnlCompute: () => {
            const curPrice = useStore.getState().lastPrice;
            if (curPrice == null) return refs.lastPnlCache.current.text ? refs.lastPnlCache.current : null;
            const diff = isLong ? curPrice - pos.averagePrice : pos.averagePrice - curPrice;
            const pnl = (diff / tickSize) * tickValue * pos.size;
            const bg = pnl >= 0 ? '#00c805' : '#ff0000';
            const result = {
              text: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
              bg,
              color: textFor(bg),
            };
            refs.lastPnlCache.current = result;
            return result;
          },
        });
      }
    }

    // --- Open order labels (SL/TP show projected P&L) ---
    const pos = contract ? positions.find(
      (p) => p.accountId === activeAccountId && String(p.contractId) === String(contract.id) && p.size > 0,
    ) : undefined;

    for (const order of openOrders) {
      if (!contract || String(order.contractId) !== String(contract.id)) continue;
      let price: number | undefined;
      if (order.type === 4 || order.type === 5) {
        price = order.stopPrice;
      } else if (order.type === 1) {
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
          const isL = pos.type === 1;
          return (isL ? p >= pos.averagePrice : p <= pos.averagePrice) ? '#00c805' : '#ff0000';
        }
        return (oType === 4 || oType === 5) ? '#ff0000'
          : oSide === 1 ? '#ff0000' : '#00c805';
      }
      // Size cell color by order side (sell=red, buy=green)
      const sizeBg = oSide === 1 ? '#ff0000' : '#00c805';

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
      let pnlCompute: (() => { text: string; bg: string }) | null = null;

      if (pos) {
        const isLong = pos.type === 1;
        const diff = isLong ? price - pos.averagePrice : pos.averagePrice - price;
        const projPnl = (diff / tickSize) * tickValue * oSize;
        initPnlText = `${projPnl >= 0 ? '+' : ''}$${projPnl.toFixed(2)}`;
        initPnlBg = profitColor(price);

        pnlCompute = () => {
          const curPrice = getOrderRefPrice();
          const d = isLong ? curPrice - pos.averagePrice : pos.averagePrice - curPrice;
          const pnl = (d / tickSize) * tickValue * oSize;
          const bg = profitColor(curPrice);
          return {
            text: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
            bg,
            color: textFor(bg),
          };
        };
      } else {
        initPnlText = (oType === 4 || oType === 5) ? 'SL'
          : oSide === 0 ? 'Buy Limit' : 'Sell Limit';
        initPnlBg = (oType === 4 || oType === 5) ? '#ff0000' : '#cac9cb';
      }

      const orderSections = [
        { text: initPnlText, bg: initPnlBg, color: initPnlBg === '#cac9cb' ? '#000' : textFor(initPnlBg) },
        { text: String(oSize), bg: sizeBg, color: textFor(sizeBg) },
        {
          text: '\u2715', bg: '#e0e0e0', color: '#000', pointerEvents: true,
          onClick: () => {
            const acct = useStore.getState().activeAccountId;
            if (!acct) return;
            orderService.cancelOrder(acct, orderId).catch((err) => {
              console.error('[Chart] Failed to cancel order:', err);
              showToast('error', 'Failed to cancel order', errorMessage(err));
            });
          },
        },
      ];
      const { root, firstCell, cells } = buildRow(orderSections);

      // Register cancel-X button + row drag via hit-target system
      registerCellHitTargets(orderSections, cells);
      const dragOrder = order;
      refs.hitTargets.current.push({
        el: root,
        priority: 1, // higher than position row-drag (2) so order drag wins when overlapping (e.g. SL at BE)
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
          refs.activeDragRow.current = root;
          root.style.cursor = 'grabbing';
          if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
          if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
        },
      });

      overlayEls.push({
        root,
        priceGetter: getOrderRefPrice,
        pnlCell: pnlCompute ? firstCell : null,
        pnlCompute,
      });
    }

    // --- Preview labels ---
    const snap2 = useStore.getState();
    const pvSide = snap2.previewSide;
    const previewTotalSize = snap2.orderSize;
    const hasPreset = snap2.bracketPresets.some((p) => p.id === snap2.activePresetId);
    const previewPreset = snap2.bracketPresets.find((p) => p.id === snap2.activePresetId);
    const previewTpSizes = hasPreset
      ? (previewPreset?.config.takeProfits.map((tp) => tp.size) ?? [])
      : snap2.adHocTpLevels.map((tp) => tp.size);

    for (let i = 0; i < refs.previewRoles.current.length; i++) {
      const role = refs.previewRoles.current[i];
      const price = refs.previewPrices.current[i];
      if (price == null) continue;

      let onCancel: (() => void) | undefined;
      let onExecute: (() => void) | undefined;
      let pnlText: string;
      let pnlBg: string;
      let pvPnlCompute: (() => { text: string; bg: string }) | null = null;
      let displaySize: number;

      if (role.kind === 'entry') {
        // Skip entry label entirely when hidden (limit order already placed)
        if (snap2.previewHideEntry) continue;
        pnlText = pvSide === 0 ? 'Limit Buy' : 'Limit Sell';
        pnlBg = '#cac9cb';
        displaySize = previewTotalSize;
        onCancel = () => useStore.getState().togglePreview();
        onExecute = async () => {
          const st = useStore.getState();
          if (!st.activeAccountId || !contract) return;
          const side: 0 | 1 = st.previewSide;

          const params: PlaceOrderParams = {
            accountId: st.activeAccountId,
            contractId: contract.id,
            type: st.orderType === 'market' ? 2 : 1,
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

          if (bracketsActive && mergedConfig) {
            bracketEngine.armForEntry({
              accountId: st.activeAccountId,
              contractId: contract.id,
              entrySide: side,
              entrySize: st.orderSize,
              config: mergedConfig,
              tickSize: contract.tickSize || 0.25,
            });
          }

          try {
            const { orderId } = await orderService.placeOrder(params);
            if (bracketsActive) bracketEngine.confirmEntryOrderId(orderId);
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
            console.error('[Chart] Failed to place order from preview:', err);
            showToast('error', 'Order placement failed', errorMessage(err));
          }
        };
      } else if (role.kind === 'sl') {
        // SL projected P&L (always negative, full position size)
        displaySize = previewTotalSize;
        const entryPrice = refs.previewPrices.current[0] ?? 0;
        const slDiff = pvSide === 0 ? entryPrice - price : price - entryPrice;
        const slPnl = (slDiff / tickSize) * tickValue * displaySize;
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
          const diff = s1.previewSide === 0 ? ep - sp : sp - ep;
          const pnl = (diff / tickSize) * tickValue * sz;
          return {
            text: `-$${Math.abs(pnl).toFixed(2)}`,
            bg: '#ff0000',
          };
        };
      } else {
        // TP projected P&L — use individual TP size
        displaySize = previewTpSizes[role.index] ?? previewTotalSize;
        const entryPrice = refs.previewPrices.current[0] ?? 0;
        const tpDiff = pvSide === 0 ? price - entryPrice : entryPrice - price;
        const tpPnl = (tpDiff / tickSize) * tickValue * displaySize;
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
          const sz = presetCfg
            ? (presetCfg.config.takeProfits[tpIdx]?.size ?? s2.orderSize)
            : (s2.adHocTpLevels[tpIdx]?.size ?? 1);
          const diff = s2.previewSide === 0 ? tp - ep : ep - tp;
          const pnl = (diff / tickSize) * tickValue * sz;
          return {
            text: `+$${Math.abs(pnl).toFixed(2)}`,
            bg: '#00c805',
            color: '#000',
          };
        };
      }

      const previewIdx = i;
      const isEntry = role.kind === 'entry';
      const entrySideBg = pvSide === 0 ? '#00c805' : '#ff0000';
      const sizeBg = isEntry ? entrySideBg : role.kind === 'sl' ? '#ff0000' : '#00c805';

      // Build sections array — entry label gets +SL/+TP buttons when no preset
      const sections: { text: string; bg: string; color: string; pointerEvents?: boolean; onClick?: () => void }[] = [
        {
          text: pnlText, bg: pnlBg, color: isEntry ? '#000' : textFor(pnlBg),
          ...(onExecute ? { pointerEvents: true } : {}),
        },
        { text: String(displaySize), bg: sizeBg, color: textFor(sizeBg) },
      ];

      // +SL / +TP buttons on entry label when no preset is active
      if (isEntry && !hasPreset) {
        const curAdHocSl = snap2.adHocSlPoints;
        const allocatedTpSize = snap2.adHocTpLevels.reduce((sum, tp) => sum + tp.size, 0);
        const remainingContracts = previewTotalSize - allocatedTpSize;

        if (curAdHocSl == null) {
          sections.push({
            text: '+SL', bg: '#ff444480', color: '#000', pointerEvents: true,
            onClick: () => useStore.getState().setAdHocSlPoints(10),
          });
        }
        if (remainingContracts > 0) {
          sections.push({
            text: '+TP', bg: '#00c80580', color: '#000', pointerEvents: true,
            onClick: () => {
              const st = useStore.getState();
              const n = st.adHocTpLevels.length;
              st.addAdHocTp(20 * (n + 1), 1);
            },
          });
        }
      }

      sections.push({
        text: '\u2715', bg: '#e0e0e0', color: '#000', pointerEvents: true,
        onClick: onCancel,
      });

      const { root, firstCell, cells } = buildRow(sections);

      // Register button cells (+SL, +TP, close-X) via hit-target system
      registerCellHitTargets(sections, cells);

      const dragRole = role;
      const dragLineIdx = i;

      // Entry label firstCell: click-vs-drag detection (priority 1)
      if (onExecute) {
        const exec = onExecute;
        refs.hitTargets.current.push({
          el: firstCell,
          priority: 1,
          handler: (e: MouseEvent) => {
            refs.entryClick.current = { downX: e.clientX, downY: e.clientY, exec };
            refs.previewDragState.current = { role: dragRole, lineIdx: dragLineIdx };
            refs.activeDragRow.current = root;
            root.style.cursor = 'grabbing';
            if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
            if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
          },
        });
      }

      // Row drag (priority 2)
      refs.hitTargets.current.push({
        el: root,
        priority: 2,
        handler: () => {
          refs.entryClick.current = null;
          refs.previewDragState.current = { role: dragRole, lineIdx: dragLineIdx };
          refs.activeDragRow.current = root;
          root.style.cursor = 'grabbing';
          if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
          if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
        },
      });

      overlayEls.push({
        root,
        priceGetter: () => refs.previewPrices.current[previewIdx] ?? price,
        pnlCell: pvPnlCompute ? firstCell : null,
        pnlCompute: pvPnlCompute,
      });
    }

    // --- Quick order pending preview labels (+ button brackets awaiting fill) ---
    if (qoPendingPreview) {
      const qo = qoPendingPreview;
      const qoEntryPrice = qo.entryPrice;

      // Initialize mutable prices ref (used by priceGetter during drag)
      refs.qoPreviewPrices.current = { sl: qo.slPrice, tps: [...qo.tpPrices] };

      // SL label — cancel removes SL from armed config + preview
      if (qo.slPrice != null) {
        const slDiff = qo.side === 0 ? qoEntryPrice - qo.slPrice : qo.slPrice - qoEntryPrice;
        const slPnl = (slDiff / tickSize) * tickValue * qo.orderSize;
        const slPnlText = `-$${Math.abs(slPnl).toFixed(2)}`;
        const cancelSl = () => {
          // Remove the SL price line from chart
          const slLine = refs.qoPreviewLines.current.sl;
          if (slLine && refs.series.current) {
            refs.series.current.removePriceLine(slLine);
            refs.qoPreviewLines.current.sl = null;
          }
          bracketEngine.updateArmedConfig((cfg) => ({
            ...cfg,
            stopLoss: { ...cfg.stopLoss, points: 0 },
          }));
          const cur = useStore.getState().qoPendingPreview;
          if (cur) useStore.getState().setQoPendingPreview({ ...cur, slPrice: null });
        };
        const qoSlSections = [
          { text: slPnlText, bg: '#ff0000', color: '#000' },
          { text: String(qo.orderSize), bg: '#ff0000', color: '#000' },
          { text: '\u2715', bg: '#e0e0e0', color: '#000', pointerEvents: true, onClick: cancelSl },
        ];
        const { root, firstCell, cells } = buildRow(qoSlSections);

        // Register cancel-X + row drag via hit-target system
        registerCellHitTargets(qoSlSections, cells);
        refs.hitTargets.current.push({
          el: root,
          priority: 2,
          handler: () => {
            refs.previewDragState.current = { role: { kind: 'qo-sl' }, lineIdx: -1 };
            refs.activeDragRow.current = root;
            root.style.cursor = 'grabbing';
            if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
            if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
          },
        });

        const qoSlPnlCompute = () => {
          const sp = refs.qoPreviewPrices.current.sl;
          if (sp == null) return null;
          const diff = qo.side === 0 ? qoEntryPrice - sp : sp - qoEntryPrice;
          const pnl = (diff / tickSize) * tickValue * qo.orderSize;
          return { text: `-$${Math.abs(pnl).toFixed(2)}`, bg: '#ff0000' };
        };

        overlayEls.push({
          root,
          priceGetter: () => refs.qoPreviewPrices.current.sl!,
          pnlCell: firstCell,

          pnlCompute: qoSlPnlCompute,
        });
      }

      // TP labels — each cancel removes that specific TP
      for (let ti = 0; ti < qo.tpPrices.length; ti++) {
        const tpPrice = qo.tpPrices[ti];
        const tpSize = qo.tpSizes[ti] ?? qo.orderSize;
        const tpDiff = qo.side === 0 ? tpPrice - qoEntryPrice : qoEntryPrice - tpPrice;
        const tpPnl = (tpDiff / tickSize) * tickValue * tpSize;
        const tpPnlText = `+$${Math.abs(tpPnl).toFixed(2)}`;
        const tpIdx = ti;
        const cancelTp = () => {
          // Remove the TP price line from chart
          const tpLine = refs.qoPreviewLines.current.tps[tpIdx];
          if (tpLine && refs.series.current) {
            refs.series.current.removePriceLine(tpLine);
            refs.qoPreviewLines.current.tps[tpIdx] = null;
          }
          bracketEngine.updateArmedConfig((cfg) => ({
            ...cfg,
            takeProfits: cfg.takeProfits.filter((_, i) => i !== tpIdx),
          }));
          const cur = useStore.getState().qoPendingPreview;
          if (cur) {
            // Remove from both arrays and compact the ref tps array
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
        const qoTpSections = [
          { text: tpPnlText, bg: '#00c805', color: '#000' },
          { text: String(tpSize), bg: '#00c805', color: '#000' },
          { text: '\u2715', bg: '#e0e0e0', color: '#000', pointerEvents: true, onClick: cancelTp },
        ];
        const { root, firstCell, cells } = buildRow(qoTpSections);

        // Register cancel-X + row drag via hit-target system
        registerCellHitTargets(qoTpSections, cells);
        const qoTpIdx = ti;
        refs.hitTargets.current.push({
          el: root,
          priority: 2,
          handler: () => {
            refs.previewDragState.current = { role: { kind: 'qo-tp', index: qoTpIdx }, lineIdx: -1 };
            refs.activeDragRow.current = root;
            root.style.cursor = 'grabbing';
            if (refs.container.current) refs.container.current.style.cursor = 'grabbing';
            if (refs.chart.current) refs.chart.current.applyOptions({ handleScroll: false, handleScale: false });
          },
        });

        const capturedTpIdx = ti;
        const capturedTpSize = tpSize;
        const qoTpPnlCompute = () => {
          const tp = refs.qoPreviewPrices.current.tps[capturedTpIdx];
          if (tp == null) return null;
          const diff = qo.side === 0 ? tp - qoEntryPrice : qoEntryPrice - tp;
          const pnl = (diff / tickSize) * tickValue * capturedTpSize;
          return { text: `+$${Math.abs(pnl).toFixed(2)}`, bg: '#00c805', color: '#000' };
        };

        overlayEls.push({
          root,
          priceGetter: () => refs.qoPreviewPrices.current.tps[capturedTpIdx] ?? tpPrice,
          pnlCell: firstCell,

          pnlCompute: qoTpPnlCompute,
        });
      }
    }

    // Position + P&L update function (called on scroll, zoom, resize, drag, price tick)
    function updatePositions() {
      const s = refs.series.current;
      for (const el of overlayEls) {
        // Update Y position (needs series)
        if (s) {
          const p = el.priceGetter();
          const y = s.priceToCoordinate(p);
          if (y === null) {
            el.root.style.display = 'none';
          } else {
            el.root.style.display = 'flex';
            el.root.style.top = `${y}px`;
          }
        }
        // Always update P&L text + color (regardless of series availability)
        if (el.pnlCell && el.pnlCompute) {
          const result = el.pnlCompute();
          if (result) {
            el.pnlCell.textContent = result.text;
            el.pnlCell.style.background = result.bg;
            if (result.color) el.pnlCell.style.color = result.color;
          }
        }
      }
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
      overlay.innerHTML = '';
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
