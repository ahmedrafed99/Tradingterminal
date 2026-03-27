# Chart Trading: Resolved Issues

## Bracket SL/TP Snap Back to Preset Values After Limit Order Fill

**Date resolved**: 2026-03-27

**Severity**: High (bracket orders placed at wrong prices after fill)

### Symptom

After placing a limit order with bracket preset (e.g. SL=8pt, TP=40pt), dragging the SL/TP preview lines to adjusted positions, then waiting for the limit order to fill — the SL and TP orders snapped back to the original preset values instead of staying at the dragged positions.

### Root Cause

Regression from commit `f214d36` ("Unify order line rendering — eliminate dual QO preview system"). That refactoring stripped `modifyOrder` calls from `usePreviewDrag` with the note "handled by useOrderDrag". But after the ghost line fix (`422de05`), brackets in `previewHideEntry` mode render as **preview lines** — so `usePreviewDrag` handles the drag, which no longer called `modifyOrder`.

Additionally, the gateway recalculates bracket prices on entry fill using `fill_price + original_tick_offsets`, overwriting any pre-fill modifications. And native bracket legs arrive without `customTag`, so the existing post-fill correction logic (which required `customTag`) never triggered.

### Why previous fix attempts failed

1. **modifyOrder before fill**: Gateway overwrites bracket prices on fill using original tick offsets
2. **Post-fill correction via `customTag`**: Native bracket legs have no `customTag` — correction logic at `order.customTag` check never fired
3. **`searchOpenOrders` REST refresh**: Returned gateway prices (original offsets) and overwrote corrected store values
4. **`pendingBracketInfo` rebuild on drag**: Triggered `useOrderLines` re-render creating phantom line duplicates and visual snap-back flicker

### Fix

| File | Change |
|------|--------|
| `usePreviewDrag.ts` | On mouseUp in `previewHideEntry` mode, call `bracketEngine.updateArmedConfig()` to sync draft overrides (engine path). No `pendingBracketInfo` set (avoids phantom line duplication). |
| `OrderPanel.tsx` | Post-fill correction: on entry fill, compute desired prices from `resolvePreviewConfig()` + fill price. Immediately upsert corrected prices (visual). Track order IDs in `bracketCorrectionIds` ref to suppress incoming gateway events. After 500ms delay, call `modifyOrder` on the exchange. Clear suppression after 2.5s. |
| `OrderPanel.tsx` | Guard `searchOpenOrders` refresh with `!previewHideEntry` — skip during bracket correction window. |
| `useOrderLines.ts` | Hide bracket order lines (opposite side of `previewSide`) when `previewHideEntry` active — preview lines handle display. Skip phantom bracket lines from `pendingBracketInfo` when `previewHideEntry` active. |

### Key Insight

The gateway's bracket system is opaque: bracket legs arrive as Working orders with no `customTag`, and the gateway silently recalculates bracket prices on fill regardless of pre-fill modifications. The only reliable correction window is **after the fill**, with a delay for the gateway to finish processing, plus suppression of incoming SignalR events to prevent the gateway's original prices from overwriting the optimistic store update.

### Key Files

- `frontend/src/components/chart/hooks/usePreviewDrag.ts` — preview line drag, engine config sync
- `frontend/src/components/chart/hooks/useOrderLines.ts` — bracket line hiding during previewHideEntry
- `frontend/src/components/order-panel/OrderPanel.tsx` — post-fill correction, event suppression, REST guard
- `frontend/src/components/chart/hooks/resolvePreviewConfig.ts` — merges draft overrides with preset config

---

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
