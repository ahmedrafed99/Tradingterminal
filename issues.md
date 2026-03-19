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
