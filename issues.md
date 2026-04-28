# Phase B/C Migration — Issues Log

## What was attempted

Migrate live order/position lines from DOM (`PriceLevelLine`) to canvas (`PriceLevelPrimitive`).
Phase A (building the primitive) was already committed. Phase B was the live swap.

The core change:
- Replace `PriceLevelLine[]` in `refs.orderLines` with `PriceLevelPrimitive[]`
- Move drag logic from `useOrderDrag.ts` into `onDrag`/`onDragEnd` closures inside `buildOrderPrimitive()`
- Move label/P&L setup from `buildOrderLabels.ts` DOM methods to `primitive.setCell()`

---

## Issues caused

### 1. TP label briefly jumping to 'right' on position close
When position closed, the TP label briefly appeared at `labelPosition: 'right'` before vanishing.

**Root cause:** `buildOrderLabels` ran with `pos = null` (position just cleared) while the order primitives were being rebuilt with `labelPosCache` defaulting to `'right'`.

**Attempted fix:** `labelPosCache` ref (persist label position computed when `pos != null`, read it back when `pos == null`). Worked, but the next issue below still caused '---' flash.

---

### 2. '---' flash on TP/SL labels when closing a position
After closing a position with TP/SL brackets, the TP/SL lines briefly showed '---' placeholder before disappearing.

**Root cause:** The single `useEffect` in `useOrderLines` had `positions` in its deps. When position closed, the effect rebuilt ALL order primitives fresh (with `'---'` initial cell), then `buildOrderLabels` was called with `pos = null` and skipped setting proper P&L. The primitives sat at `'---'` until `openOrders` cleared and they were destroyed.

**Attempted fix:** Split into two effects:
- Effect 1 (deps: `positions`) — position line only
- Effect 2 (deps: `openOrders`, no `positions`) — order lines, reads pos from `useStore.getState()` synchronously

This prevented order primitives from rebuilding on position close. Partially worked but introduced the next issue.

---

### 3. Position entry label showing '---' (regression from split-effect)
After the two-effect split, the position entry line briefly showed `'---'` on each rebuild.

**Root cause:** Effect 1 always created the position primitive with `text: '---'` as initial cell value, relying on `buildPositionLabel` (from `useOverlayLabels`) to overwrite it. The ordering was correct but the canvas rendered one frame with `'---'` before `buildPositionLabel` ran.

**Fix applied:** Compute initial P&L from `useStore.getState().lastPrice` / `refs.lastPnlCache` directly in Effect 1, so the primitive is created with the correct value. Eliminated the flash.

---

### 4. TP/SL still briefly visible after position close (before openOrders clears)
Even with the split-effect fix, there was a window where position was closed but `openOrders` had not yet updated. During this window, the TP/SL canvas primitives were still attached and showed stale P&L values.

**Fix applied:** In Effect 1, when `pos` is null, call `detachPositionDependentLines()` immediately. This removes Stop, TrailingStop, Suspended, and phantom-bracket lines from refs and detaches them from the series right away — before `openOrders` state catches up.

---

### 5. Non-filled entry order label showing '---'
Standalone pending limit orders (no position) showed `'---'` instead of "Buy Limit" / "Sell Limit".

**Root cause:** The `!pos` branch in `buildOrderLabels` did a blanket `continue` to prevent flashing labels during the position-close transition. But this also skipped setting labels for standalone entry orders that legitimately have no position.

**Fix applied:** Changed `!pos` branch to only skip Stop/Suspended orders (which are detached by `detachPositionDependentLines` anyway); non-Suspended Limit orders now show "Buy Limit" / "Sell Limit".

---

### 6. TP/SL blinking when dragging the entry order line
When dragging a pending entry limit order, the TP/SL bracket lines blinked/flickered.

**Root cause (suspected):** The entry's `onDrag` moved Suspended bracket primitives via `setPrice()`. However, `useOverlayLabels` also fires `updatePositions` on every mouse move (via `scheduleSync`), which calls `pnlUpdaters` including ones for the bracket lines. Each `setCell` call on a canvas primitive triggers `requestUpdate()`, causing LWC to call `paneViews()` on ALL attached primitives. The interleaving of `setPrice` (from drag) and `requestUpdate` (from pnlUpdaters) on the same frame may cause the bracket lines to visually oscillate between their dragged position and some other computed position.

**Additionally:** the bracket move in `onDrag` was guarded by `if (st.pendingBracketInfo)` — if that was null for any reason, brackets would not move at all.

**Status:** Not fully resolved before revert. The fix attempt (removing the `pendingBracketInfo` guard) did not fully eliminate the blink.

---

## Recommendation for next attempt

The TP/SL blink during drag is likely caused by `pnlUpdaters` and `setPrice` racing on the same canvas repaint cycle. A cleaner fix would be:

- During drag of entry order, suspend the `pnlUpdaters` for bracket lines (or skip calling `setCell` on a primitive that is currently being moved programmatically).
- OR: use a `isDragging` ref flag checked inside pnlUpdaters to skip updates while drag is in progress.
- OR: move bracket P&L recomputation into a single update pass that also handles position, so there's only one `requestUpdate` call per frame.
