# Known Issues

## 1. TP/SL bracket lines vanish after page refresh

**Status:** Fixed (unified order line rendering refactor)
**Severity:** High — user loses visual confirmation of pending bracket orders

### Symptom

After submitting a quick order with TP/SL brackets (entry not yet filled), all three lines (entry, SL, TP) display correctly. On page refresh, only the entry line remains — SL and TP lines disappear.

### Root Cause

The old architecture used two separate rendering systems for bracket lines — `qoPreviewLines` (managed by `useQuickOrder.ts`) for pre-fill preview, and `useOrderLines` for real orders. `useOrderLines` unconditionally skipped Suspended orders, and `useOverlayLabels` skipped `buildQoPendingLabels()` when `qoPendingPreview` (now `pendingBracketInfo`) was `null`. Since `qoPendingPreview` was in-memory only (not persisted), on refresh the Suspended bracket orders existed in `openOrders[]` but no rendering path picked them up.

### Fix (Unified Order Line Rendering)

The dual rendering system was eliminated entirely:

1. **`pendingBracketInfo` persisted to sessionStorage** — survives page refresh.
2. **`pendingEntryOrderId` persisted to sessionStorage** — tracks entry order ID across refresh.
3. **`useOrderLines` now renders ALL orders** including Suspended (with dashed line style) + phantom bracket lines from `pendingBracketInfo`.
4. **`buildQoPendingLabels.ts` deleted** — its logic merged into `buildOrderLabels.ts`.
5. **`useQuickOrder.ts` is hover-preview-only** — no post-placement line tracking.
6. **`OrderPanel.tsx` clears `pendingBracketInfo`** on entry fill/cancel.

All order rendering now goes through one path: `openOrders[]` → `useOrderLines` → `buildOrderLabels`. The "quick order" + button is just a UI convenience for placing a limit order.

## 2. Position line and P&L missing after refresh with open position

**Status:** Fixed
**Severity:** High — user has no visual confirmation of open position after refresh

### Symptom

After an entry fills and brackets are active, refreshing the page loses the position entry line and bracket label P&L. SL/TP lines show but with no projected dollar amounts.

### Root Cause

Race condition between `App.tsx` session trades fetch and `OrderPanel.tsx` position hydration. `inferPositionsFromOrders` reads `sessionTrades` from the Zustand store, but `App.tsx` fetches trades asynchronously and hasn't resolved yet. `sessionTrades` is `[]`, so inference bails silently → no position in store → no position line, bracket labels fall back to generic text.

Originally fixed in commit `0989f98` (inline trade fetch fallback), but the fix was accidentally reverted during the bracket line refresh fix attempts.

### Fix

1. Re-applied the inline trade fetch in `inferPositionsFromOrders`: when `sessionTrades` is empty, fetch trades directly via `tradeService.searchTrades()` before bailing. This eliminates the dependency on `App.tsx` load order.
2. Fixed average price calculation: the weighted average now takes only the most recent opening trades (newest-first) up to the position size, excluding earlier trades from previous round trips in the same session.
