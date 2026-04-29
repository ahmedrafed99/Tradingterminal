# Chart Trading: Issues

# Resolved Issues

## Draft SL/TP Persists After Bracket Order Cancel — Next Order Uses Edited Positions / Preview Lines Flash Then Persist on Cancel

**Date resolved**: 2026-04-27

**Severity**: Medium (wrong bracket prices on re-entry after cancel; visual flash on cancel)

### Symptoms

1. Place limit bracket order (preset active), drag SL/TP to new position, cancel, place again → new order's SL/TP appear at dragged positions not preset defaults (`draftSlPoints`/`draftTpPoints` persisting)
2. On cancel: SL/TP preview lines briefly flash to preset values before disappearing
3. (Regression during fix attempts) On cancel: preview SL/TP lines persist on screen and require hard reload to clear

### Root Cause

**Persistence (symptom 1):** Broader cancel cleanup in `OrderPanel.tsx` called `clearAdHocBrackets()` but never `clearDraftOverrides()`. `draftSlPoints`/`draftTpPoints` survived across cancel and fill, causing `resolvePreviewConfig()` to return stale edited values on next placement. `pendingEntryOrderId: null` for chart-label placements means the gated block at line ~291 never fires — the broader cancel path at line ~430 is the only reliable cleanup site.

**Flash (symptom 2):** The broader cancel cleanup made three separate Zustand `set()` calls (`clearAdHocBrackets()`, `clearDraftOverrides()`, `setState({previewEnabled, previewHideEntry})`). Each `set()` triggers a synchronous Zustand notification. After `clearDraftOverrides()` fires but before `previewHideEntry=false`, `usePreviewLines` Effect 2 runs `doUpdate()` → `resolvePreviewConfig()` returns preset defaults → preview lines snap to preset positions for one frame.

**Lines persist regression (symptom 3):** Attempting to fix the flash by deferring `setPendingBracketInfo(null)` to the broader cancel cleanup caused persistence: if the broader cancel cleanup didn't fire for any reason (e.g. contract mismatch, wrong order event ordering), `previewHideEntry` stayed `true` and preview lines never cleared.

### Key Insight

`useOrderLines` uses a **side-based skip** (`previewHideEntry && order.side === oppositeSide → skip`) that does NOT depend on `pendingBracketInfo`. So `setPendingBracketInfo(null)` firing in the gate is safe — the Suspended bracket legs remain hidden because `previewHideEntry` is still `true` and `previewSide` hasn't changed. The flash is exclusively from preview lines (not order lines).

### Fix

- `OrderPanel.tsx` gate (line ~294): restore `setPendingBracketInfo(null)` for both Filled and Cancelled — gate handles it reliably
- `OrderPanel.tsx` broader cancel cleanup: merge `clearAdHocBrackets()`, `clearDraftOverrides()`, and `setState({previewEnabled, previewHideEntry})` into **one atomic `useStore.setState({...})`** call — single Zustand `set()` = single notification = no intermediate render where preview lines flash to preset positions
- `OrderPanel.tsx` fill paths (lines ~379, ~382): same atomic merge — `draftSlPoints: null, draftTpPoints: []` included in the same `setState` call

### Key Files

- `frontend/src/components/order-panel/OrderPanel.tsx` — gate restore, atomic setState at all three cleanup sites

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

## Multiple Bracket Orders: Lines Disappear / Wrong Labels / Cancel Side Effects

**Date resolved**: 2026-04-29

**Severity**: High

### Symptoms

1. Place bracket order 1, place bracket order 2 → order 1's SL/TP lines disappear or show wrong labels
2. Cancel order 2 → order 1's SL/TP show "SL"/"TP" instead of projected P&L; TP line turns red
3. Cancel order 2 → order 1's entry line disappears (mixed Long/Short directions)
4. Cancel order 2 → order 1's SL/TP lines disappear entirely
5. Cancel order 1 → order 2's SL/TP are also cancelled
6. Cancel order 2 → order 1's SL/TP vanish then reappear (flash on cancel)
7. Brief "SL"/"TP" flash on entry 1's legs the moment entry 2 is placed
8. Entry drag: dragging one bracket's entry moves the other bracket's SL/TP

### Root Cause

The store holds a single `pendingBracketInfo` singleton tracking only the *current* (latest) bracket. All multi-bracket issues stem from the singleton not being able to represent two concurrent brackets simultaneously. The fix kept the singleton but added price-matching heuristics (`isCurrentBracketLeg`) to distinguish current vs other-bracket Suspended orders.

**Symptom 1 (disappear/wrong labels):** After order 2 is placed, `pendingBracketInfo` points to order 2's prices. Order 1's Suspended legs no longer match → `computeOrderDesired` hit the `!pos && pendingBracketInfo == null` guard and filtered them out; labels had no PnL path.

**Symptom 2 (wrong labels after cancel):** After clearing `pendingBracketInfo`, `buildOrderLabels` had no bracket context → fell to generic "SL"/"Sell Limit" text. TP color was red because `classifyOrderLine` only used bracket colors when `pendingBracketInfo != null`.

**Symptom 3 (entry disappears, mixed direction):** `hideBracketSide` for a Short entry = Buy side. Entry 1's Long entry (Buy, Working) was caught by the "non-suspended opposite-side suppressed" branch.

**Symptom 4 (legs vanish on cancel):** `handleCancel` cleared `pendingBracketInfo` but not `previewHideEntry`. With `previewHideEntry=true` and `pendingBracketInfo=null`, a "hide as fallback" branch in `computeOrderDesired` suppressed all remaining Suspended orders.

**Symptom 5 (wrong legs cancelled):** `handleCancel` collected ALL Suspended orders on the contract, not just the cancelled entry's legs.

**Symptom 6 (flash on cancel):** After the `previewHideEntry` fix, a `!pos && pendingBracketInfo==null` guard still filtered Suspended legs when no position existed, and `labelPosCache` had pre-populated 'mid' for the TP.

**Symptom 7 (flash on placement):** `pendingBracketInfo` was updated to order 2's bi before `pendingEntryOrderId` changed. The "other bracket" sibling lookup excluded `pendingEntryOrderId` (still order 1's ID) → no sibling found → "SL"/"TP" fallback for one render.

**Symptom 8 (wrong legs follow drag):** Sibling-follow in `onDrag` moved legs by XOR condition (`isDraggingCurrentEntry !== legIsCurrentBracket`), and `bracketEngine.handleLegModify` was called for all Suspended orders including other-bracket legs, corrupting `pendingBracketInfo`.

### Fix

Kept the `pendingBracketInfo` singleton. All other-bracket awareness uses `isCurrentBracketLeg` price-matching.

| File | Change |
|------|--------|
| `buildOrderLabels.ts` | Cancel handler: scope cancellation to current-bracket legs (matching `pendingBracketInfo`) or other-bracket legs (not matching), never all. On cancel of current entry: also clear `previewHideEntry` + `pendingEntryOrderId` atomically. Add `else if (isSuspended && !pendingBracketInfo)` PnL branch that finds the sibling entry by side. "Other bracket" sibling lookup now excludes `pendingEntryOrderId` correctly. |
| `useOrderLines.ts` | `computeOrderDesired`: don't suppress non-Suspended Working orders on `hideBracketSide` (was hiding other-direction entry). Suspend the `!pos && pendingBracketInfo==null` guard for Suspended orders. Add sibling-entry existence check before rendering orphaned Suspended legs (prevents flash). `bracketEngine.handleLegModify` guard: only call for current-bracket legs. Sibling-follow XOR fix: drag correct bracket's legs. Other-bracket entry drag-end: shift legs without touching `pendingBracketInfo`. |
| `usePreviewLines.ts` | SL/TP `onDragEnd`: sync matching Suspended order in store + API after updating `pendingBracketInfo`, preventing ghost lines from price mismatch. |
| `labelUtils.ts` | `classifyOrderLine`: use `order.status === Suspended` (not `pendingBracketInfo != null`) for color and sizeBg — Suspended legs always get SL/TP colors regardless of bracket context. |
| `placeOrderWithBrackets.ts` | Clear `pendingEntryOrderId` to null before overwriting `pendingBracketInfo` for the new order — prevents the "other bracket" sibling lookup from excluding order 1's entry during the brief window before order 2's ID is confirmed. |
| `OrderPanel.tsx` | WS suspended-override: always preserve the store's existing price for known orders — never let the gateway overwrite a user-adjusted price, even for other-bracket legs. |

### Key Architectural Constraint

`pendingBracketInfo` is a singleton and only tracks the most recently placed bracket. The "other bracket" path in `buildOrderLabels` must find its sibling entry purely by side-matching in `openOrders`, filtered by `pendingEntryOrderId` to exclude the current bracket's entry. This works for ≤2 concurrent brackets of the same direction; more than 2 same-direction pending brackets would require the `pendingBracketInfos[]` array approach originally planned.

### Key Files

- `frontend/src/components/chart/hooks/buildOrderLabels.ts`
- `frontend/src/components/chart/hooks/useOrderLines.ts`
- `frontend/src/components/chart/hooks/usePreviewLines.ts`
- `frontend/src/components/chart/hooks/labelUtils.ts`
- `frontend/src/services/placeOrderWithBrackets.ts`
- `frontend/src/components/order-panel/OrderPanel.tsx`
