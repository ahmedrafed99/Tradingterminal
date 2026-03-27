# Chart Trading: Resolved Issues

## Ghost TP/SL Lines on Bracket Order Entry Drag

**Date resolved**: 2026-03-27

**Severity**: High (visual glitch affecting live trading UX)

### Symptom

After placing a limit order with brackets (TP/SL) via quickorder (+ button) or order panel, dragging the entry line caused ghost TP/SL lines: the original TP/SL remained at their initial prices while new ones appeared at the dragged positions — resulting in duplicate lines on the chart.

This did **not** occur when placing via the chart preview label (preview checkbox checked).

### Root Cause

Two separate line-rendering systems were drawing TP/SL:

1. **`useOrderLines`** — renders real Suspended bracket order lines from `openOrders`, plus "phantom" bracket lines from `pendingBracketInfo` for prices not covered by real orders.
2. **`usePreviewLines`** — renders preview TP/SL lines from bracket config + `limitPrice`.

The ghost lines were caused by `pendingBracketInfo` in the Zustand store. On drag mouseUp, the code called `setPendingBracketInfo(shiftedPrices)`. Since `pendingBracketInfo` is a dependency of the `useOrderLines` effect, this triggered a full teardown and rebuild of all order lines. The Suspended bracket orders in `openOrders` still had their old server-assigned prices (the server hadn't confirmed the bracket adjustment yet), so the effect recreated bracket lines at the original positions — the ghost lines. Meanwhile, phantom lines were created at the new shifted prices, producing visible duplicates.

### Why the Preview Checkbox Path Worked

The chart preview label placement (`buildPreviewLabels.onExecute`) calls `orderService.placeOrder()` directly and **never sets `pendingBracketInfo`**. Without it:

- The drag mouseUp handler's `prevBi` check evaluates to `null`
- `setPendingBracketInfo(shifted)` is never called
- `useOrderLines` is never triggered to rebuild with stale prices
- The preview TP/SL lines (from `usePreviewLines`) handle the visual — they compute from bracket config + `limitPrice`, which updates correctly on drag via `setLimitPrice(newPrice)`

### Fix

Made the `placeOrderWithBrackets` flow match the chart preview label flow. Since `placeOrderWithBrackets` is the shared placement function used by both the order panel (BuySellButtons) and quickorder (+ button), the fix applies to all placement paths.

| File | Change |
|------|--------|
| `placeOrderWithBrackets.ts` | After order placement, clear `pendingBracketInfo` and activate the preview line system: `previewHideEntry: true`, `previewSide`, `limitPrice`, `orderType: 'limit'` |
| `usePreviewLines.ts` | Widen activation gate: `(!previewEnabled && !previewHideEntry)` so preview lines render when `previewHideEntry` is set even without the preview checkbox |
| `usePreviewDrag.ts` | Same gate widening so individual TP/SL drag adjusts bracket config points |
| `BuySellButtons.tsx` | Don't clear ad-hoc bracket config when `previewHideEntry` is active (needed by `resolvePreviewConfig()`) |

### Architecture Note

The chart now has a single visual path for TP/SL lines after bracket order placement: the **preview line system** (`usePreviewLines` + `usePreviewDrag`). The real Suspended bracket order lines from `useOrderLines` still exist underneath (for server-price accuracy and label rendering), but the preview lines act as the visual truth layer during drag operations. This is the same architecture used when the preview checkbox is manually checked — the only difference is `previewEnabled` stays `false` (no market-price tracking, no preview checkbox side effects).

### Key Files

- `frontend/src/services/placeOrderWithBrackets.ts` — order placement with bracket handling
- `frontend/src/components/chart/hooks/usePreviewLines.ts` — preview line lifecycle
- `frontend/src/components/chart/hooks/usePreviewDrag.ts` — preview line drag interaction
- `frontend/src/components/chart/hooks/useOrderLines.ts` — real order line lifecycle (unchanged)
- `frontend/src/components/chart/hooks/useOrderDrag.ts` — real order line drag (unchanged)
- `frontend/src/components/order-panel/BuySellButtons.tsx` — order panel placement
- `frontend/src/components/chart/hooks/buildPreviewLabels.ts` — chart preview label placement (reference implementation)
