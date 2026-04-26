# Chart Trading: Issues

# Resolved Issues

## Draft SL/TP Persists After Bracket Order Cancel — Next Order Uses Edited Positions

**Date resolved**: 2026-04-27

**Severity**: Medium (wrong bracket prices on re-entry after cancel)

### Symptom

1. Place limit bracket order (preset active)
2. Drag SL/TP preview line to new position — `draftSlPoints`/`draftTpPoints` set on mouseUp
3. Cancel entry limit order
4. Place another bracket order (same preset)
5. New order's SL/TP appear at dragged positions, not preset defaults

### Root Cause

Broader cancel cleanup in `OrderPanel.tsx` (lines ~430-438) called `clearAdHocBrackets()` (clears ad-hoc SL) but never `clearDraftOverrides()` (clears preset-based drafts). `draftSlPoints`/`draftTpPoints` survived across cancel, and `resolvePreviewConfig()` returned stale edited values on next placement.

Confirmed via console log: `pendingEntryOrderId: null` — chart-label placements never set it, so the `pendingEntryOrderId`-gated cancel block at line ~291 never fires. The broader cancel path at line ~430 is the only reliable cleanup site for both placement paths.

Also missing from fill paths (lines 379, 382 in the post-fill `setTimeout`) — same stale drafts would persist after a fill.

### Fix

Added `st.clearDraftOverrides()` to three sites in `OrderPanel.tsx`:
- Broader cancel cleanup (`~line 436`) — covers all placement paths
- Post-fill `setTimeout` (`line 379`) — clears on successful fill
- Post-fill fallback (`line 382`) — clears when no correction needed

### Key Files

- `frontend/src/components/order-panel/OrderPanel.tsx` — all three cleanup sites

---

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
| `placeOrderWithBrackets.ts` | After order placement, activate the preview line system: `previewHideEntry: true`, `previewSide`, `limitPrice`, `orderType: 'limit'`. **Do NOT clear `pendingBracketInfo`** — it must survive in sessionStorage for bracket line rendering after page refresh (see note below). |
| `usePreviewLines.ts` | Widen activation gate: `(!previewEnabled && !previewHideEntry)` so preview lines render when `previewHideEntry` is set even without the preview checkbox |
| `usePreviewDrag.ts` | Same gate widening so individual TP/SL drag adjusts bracket config points |
| `BuySellButtons.tsx` | Don't clear ad-hoc bracket config when `previewHideEntry` is active (needed by `resolvePreviewConfig()`) |

### Important: Do NOT clear `pendingBracketInfo` after placement

An earlier version of this fix cleared `pendingBracketInfo` in `placeOrderWithBrackets.ts` immediately after placement. This caused a regression where **TP/SL lines disappeared after page refresh**:

- `previewHideEntry` is in-memory only (not in `partialize()`, not persisted)
- On refresh it resets to `false`, so preview lines don't activate
- With `pendingBracketInfo` also cleared, `useOrderLines` has no data to render phantom bracket lines
- Suspended bracket orders from the gateway have no prices → lines vanish

The correct approach: keep `pendingBracketInfo` alive in sessionStorage. During drag, `previewHideEntry=true` prevents `useOrderLines` from using it (avoiding ghost lines). After refresh, `previewHideEntry` resets to `false` and `useOrderLines` falls back to `pendingBracketInfo` for phantom bracket rendering.

### Architecture Note

The chart has two visual paths for TP/SL lines after bracket order placement:

1. **Preview line system** (`usePreviewLines` + `usePreviewDrag`) — active when `previewHideEntry=true` (in-memory). Handles TP/SL display during drag operations. This is the same architecture used when the preview checkbox is manually checked.
2. **Phantom bracket lines** (`useOrderLines`) — active when `previewHideEntry=false` (i.e., after refresh). Renders from `pendingBracketInfo` in sessionStorage for prices not covered by real orders.

The `previewHideEntry` flag acts as the switch between these two paths. Since it's not persisted, refreshes always fall back to the phantom line path.

### Key Files

- `frontend/src/services/placeOrderWithBrackets.ts` — order placement with bracket handling
- `frontend/src/components/chart/hooks/usePreviewLines.ts` — preview line lifecycle
- `frontend/src/components/chart/hooks/usePreviewDrag.ts` — preview line drag interaction
- `frontend/src/components/chart/hooks/useOrderLines.ts` — real order line lifecycle (unchanged)
- `frontend/src/components/chart/hooks/useOrderDrag.ts` — real order line drag (unchanged)
- `frontend/src/components/order-panel/BuySellButtons.tsx` — order panel placement
- `frontend/src/components/chart/hooks/buildPreviewLabels.ts` — chart preview label placement (reference implementation)

---

## Bracket Lines Flash Red on Account Switch

**Date resolved**: 2026-03-27

**Severity**: Low (cosmetic flicker, no functional impact)

### Symptom

After placing a bracket order on Account A, switching to Account B briefly caused TP/SL lines to turn red and position P&L to disappear (showing as plain limit/stop orders) before the lines cleared.

### Root Cause

`useOrderLines` depends on both `activeAccountId` and `openOrders`. When the account switches:

1. `activeAccountId` changes immediately → effect re-runs
2. `openOrders` still contains the **old account's orders** (REST fetch hasn't returned yet)
3. Position lookup uses new `activeAccountId` → no position found (`pos = undefined`)
4. Old bracket orders are drawn via `computeOrderLineColor(order, price, undefined)` which falls back to type/side-based coloring — SL (Stop) → red, TP (Sell Limit) → red
5. ~200ms later REST returns new account's orders → effect re-runs correctly

The `openOrders` loop in `useOrderLines` only filters by `contractId`, not `accountId`, so stale orders from the old account are rendered during the transition window.

### Fix

Clear `openOrders` and `pendingBracketInfo` immediately on account switch, before the REST hydration call. This ensures the chart sees an empty order list during the transition instead of stale data.

### Key Files

- `frontend/src/components/order-panel/OrderPanel.tsx` — account-change effect: clear stale state before hydration

---

# Open / Known Issues

## 1 — SL/TP Preview Line Snap-Back on Drag

**Severity**: High (line jumps back to original position when released)

### Symptom

Dragging an SL or TP preview line and releasing causes the line to snap back to its pre-drag position for one frame before settling at the dropped price.

### Root Cause

`usePreviewDrag.onMouseMove` writes `setAdHocSlPoints` / `setDraftSlPoints` / `updateAdHocTpPoints` on every frame during drag. These values are dependencies of `usePreviewLines` Effect 1 (structural teardown+recreate). Every frame the store update fires Effect 1, which destroys and recreates all preview lines at the *new config* position — but Effect 1 reads `snap.limitPrice` as the entry, not the dragged position. So lines flash at the "default" computed price each frame.

### Required Fix

Move ALL store writes for SL/TP points out of `onMouseMove` and into `onMouseUp` only. During `onMouseMove`, only update the line's visual position via `pvLine.setPrice(snapped)` + `pvLine.syncPosition()` + write `drag.draggedPrice = snapped`. Commit to Zustand on mouseup using `drag.draggedPrice`. Also add a guard in `doUpdate` (Effect 2) that skips overwriting the dragged line's position while `refs.previewDragState.current` is set.

### Key Files

- `frontend/src/components/chart/hooks/usePreviewDrag.ts` — move store writes from mousemove to mouseup
- `frontend/src/components/chart/hooks/usePreviewLines.ts` — add `draggingIdx` guard in `doUpdate`
- `frontend/src/components/chart/hooks/types.ts` — add `draggedPrice: number` to `previewDragState` type

---

## 2 — Multiple Bracket Orders: First Bracket Lines Disappear / Wrong Labels

**Severity**: High (lines vanish, wrong P&L labels)

### Symptom A — Lines disappear

Place bracket order 1 (works fine). Place bracket order 2. Order 1's SL/TP preview lines disappear.

### Symptom B — Wrong labels after cancel

Cancel order 2. Order 1's SL/TP lines reappear but show "SL" / "Sell Limit" instead of projected P&L. The entry label also shifts left.

### Root Cause

The store holds a single `pendingBracketInfo` and `pendingEntryOrderId` tracking only the *current* (latest) pending entry. When order 2 is placed:

- `pendingBracketInfo` is overwritten with order 2's bracket data
- `pendingEntryOrderId` changes to order 2's ID
- `useOrderLines` guards against showing Suspended legs that match `pendingBracketInfo` — but now `pendingBracketInfo` is order 2's data, so order 1's Suspended legs are no longer guarded and appear as raw order lines
- Meanwhile `usePreviewLines` still shows preview lines based on the *current* config (order 2), so order 1's preview lines move to order 2's prices or disappear

When order 2 is cancelled and `pendingBracketInfo` is cleared, `buildOrderLabels` finds order 1's Suspended legs but has no bracket info to identify them → labels fall back to generic "SL" / "Sell Limit".

**Label shift**: `isEntryOrder` in `buildOrderLabels` does not account for the second bracket side, so the entry label logic breaks after cancel.

### Required Fix

Maintain a `pendingBracketInfos: PendingBracketEntry[]` array (each entry: `BracketInfo & { entryOrderId: string | null }`) alongside the existing `pendingBracketInfo` singleton (kept for backward compat / sessionStorage). Key changes:

- `setPendingBracketInfo(info)`: push to array (staging slot, `entryOrderId: null`); if null, only remove staging entry
- `setPendingEntryOrderId(id)`: if non-null, confirm staging slot with real ID; if null, remove that ID's entry from the array
- `updatePendingBracketInfoEntry(entryOrderId, patch)`: patch specific array entry
- `useOrderLines`: replace `pendingBracketInfo`-based color/guard with per-price lookup across full `pendingBracketInfos` array
- `buildOrderLabels`: add `findBracketInfoForPrice(price)` that searches full `pendingBracketInfos` array; fix `isEntryOrder` to check all entries' sides
- `usePreviewLines` Effect 1: `pendingEntryOrderId` must be in deps so lines are destroyed/recreated when a new entry takes over as the "current" preview entry (see Issue 3 for the complication this introduces)

### Key Files

- `frontend/src/store/slices/tradingSlice.ts` — add `pendingBracketInfos` array + CRUD actions
- `frontend/src/components/chart/hooks/useOrderLines.ts` — multi-bracket guard + color logic
- `frontend/src/components/chart/hooks/buildOrderLabels.ts` — `findBracketInfoForPrice`, `isEntryOrder` fix
- `frontend/src/components/order-panel/OrderPanel.tsx` — account-switch clear

---

## 3 — Preview Lines Lose X Button / Become Non-Draggable After Second Bracket

**Severity**: High (TP line unresponsive after second bracket placed)

### Symptom

After placing a second bracket order, the TP preview line of the new (current) entry loses its X button and cannot be dragged.

### Root Cause

Adding `pendingEntryOrderId` to `usePreviewLines` Effect 1 deps (required for Issue 2 fix) causes Effect 1 to re-run when a second bracket is placed. Effect 1 creates new preview lines but does **not** call `refs.updateOverlay.current()`. Effect 2 only re-runs if one of its own deps changed in the same render. If `pendingEntryOrderId` arrives in a separate render from `limitPrice`/`previewHideEntry` (which is possible — `setPendingEntryOrderId` is a separate Zustand `set` call from `useStore.setState({previewHideEntry, limitPrice})`), Effect 2 does not re-run, so `updateOverlay` is never called for the new lines. Labels are only built when the next `lastPrice` tick triggers the subscription's `doUpdate`.

### Required Fix

Call `refs.updateOverlay.current()` at the end of Effect 1 body in `usePreviewLines`, after the last preview line is pushed. This ensures the overlay always rebuilds labels immediately whenever Effect 1 creates new lines, regardless of whether Effect 2 also runs.

### Key Files

- `frontend/src/components/chart/hooks/usePreviewLines.ts` — add `refs.updateOverlay.current()` at end of Effect 1

---

## 4 — Dragging One Bracket's Entry Moves Another Bracket's Preview Lines

**Severity**: High (wrong lines move during drag)

### Symptom

With two bracket orders pending, dragging the first bracket's entry line causes the *second* bracket's SL/TP preview lines to move alongside it.

### Root Cause

`useOrderDrag.onMouseMove` shifts Suspended bracket legs and preview lines whenever an entry order is dragged. The Suspended leg shift uses `findSuspendedBracketIndices()` which returns ALL Suspended orders for the contract (not scoped to the dragged entry's bracket). The preview line shift is guarded by `st.previewHideEntry && draggedOrderId === st.pendingEntryOrderId` but `pendingEntryOrderId` points to the *second* order — so dragging the first also shifts the second's preview lines.

### Required Fix

- `findSuspendedBracketIndices()`: accept optional `bracketPrices` filter and only return legs whose price is within `tickSize` of one of those prices. On call site, pass `matchedBracket.slPrice + tpPrices` so only the dragged entry's legs move.
- Preview line shift guard: require `draggedOrderId === pendingEntryOrderId` AND that the preview lines were created for that specific entry (see Issue 3 / `previewCreatedForOrderId` ref).

### Key Files

- `frontend/src/components/chart/hooks/useOrderDrag.ts` — scope `findSuspendedBracketIndices` + guard preview shift

---

## 5 — Brief P&L Drift on Entry Line Drag (Two Brackets)

**Severity**: Low (cosmetic, settles correctly on mouseup)

### Symptom

While dragging a bracket entry line, the projected P&L label on the order label changes continuously (based on the dragging price), instead of staying at the last committed P&L. On mouseup it corrects.

### Root Cause

`buildOrderLabels` computes P&L using `ep = pendingBracketInfo.entryPrice` directly. During drag, `pendingBracketInfo.entryPrice` is updated optimistically from `orderLinePrices`, but that lookup uses `pendingEntryOrderId`-scoped data which may not match the dragged order.

### Required Fix

In `buildOrderLabels`, use `getOrderLinePrice(entryOrderId)` (look up from `refs.orderLinePrices.current`) as `liveEp` if the entry order ID is known, falling back to `pendingBracketInfo.entryPrice`. This keeps P&L stable (anchored to the live line position) during drag.

### Key Files

- `frontend/src/components/chart/hooks/buildOrderLabels.ts` — `getOrderLinePrice` fallback in P&L closure
