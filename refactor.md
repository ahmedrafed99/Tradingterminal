# DOM → Canvas Order Lines Migration

## Status
Phase A complete and committed (`8002073`).
Phase B + C complete and committed (`2444caf`).
Phase B/C bug-fixes complete and committed (`4a5137e`).

## What was done
`PriceLevelPrimitive` (`frontend/src/components/chart/primitives/PriceLevelPrimitive.ts`) is built, tested, and committed. It is a generic `ISeriesPrimitive` that renders a horizontal price line + draggable label cells directly on LWC's canvas. No DOM involved.

Key API:
- `cellOrder: string[]` + `cells: Record<string, PriceLevelCell>` — variable cell count, any keys
- `onDragStart(originalPrice)` / `onDrag(price)` / `onDragEnd(price)` callbacks
- `allowPriceMove?: boolean` — when false, drag fires callbacks but line stays fixed (used for position line)
- `grab` / `grabbing` / `pointer` cursor management built-in (pointer for clickable cells)
- `setCell(key, patch)` for live cell updates (text, color, onClick, leftText/leftClick, rightText/rightClick)
- `setCellOrder(order)` for runtime layout changes
- `setChartElement(el)` must be called after `series.attachPrimitive(primitive)`
- Inline left/right zones within a cell (e.g. TP size redistribution − / + within the size cell)

`OrderLinePrimitive.ts` is now a re-export shim pointing to `PriceLevelPrimitive`.

---

## Lessons from failed Phase B attempt (see `issues.md`)

The attempted migration produced several cascading bugs. The root causes and required design decisions for the next attempt are documented here.

### Critical: P&L updater vs. drag race

**Problem:** `useOverlayLabels` fires `updatePositions()` on every mouse move (via `scheduleSync`). Each pnlUpdater calls `primitive.setCell()`, which calls `requestUpdate()`. This triggers LWC to repaint ALL attached primitives. If the entry's `onDrag` is simultaneously calling `setPrice()` on bracket primitives, the two update paths interleave on the same canvas frame — causing TP/SL to blink during drag.

**Actual fix (post-Phase B/C):** In `useOrderLines.ts`, the `onDrag` callback calls `refs.updateOverlay.current()` **synchronously** (not `scheduleOverlaySync` which defers via RAF). This puts `setPrice()` and all pnlUpdater `setCell()` calls into the same JS execution → LWC batches into one repaint frame. The `isDragging` guard is therefore NOT needed in order/bracket pnlUpdaters and was removed from `buildOrderLabels.ts`. The position P&L updater in `buildPositionLabel.ts` retains its `isDragging` guard because position P&L is market-price-based (not order-price-based) and should not tick during order drag.

---

### Critical: position close race (positions clears before openOrders)

**Problem:** React delivers `positions` and `openOrders` state updates in separate renders. When a position closes, `positions` clears first — but TP/SL order primitives are still attached because `openOrders` hasn't cleared yet.

**Required fix:** Use two effects:
- **Effect 1** (deps: `positions`) — manages the position line only. When `pos` becomes null, immediately call `detachPositionDependentLines()` to remove Stop, Suspended, and phantom-bracket primitives. This makes TP/SL disappear instantly, before `openOrders` catches up.
- **Effect 2** (deps: `openOrders`, no `positions`) — manages order lines. Reads pos synchronously from `useStore.getState()` at run time (not from React state), so it does not rerun — and does not flash `'---'` — when only `positions` changes.

`detachPositionDependentLines` removes entries where `kind === 'phantom-bracket'`, or `kind === 'order'` with `status === Suspended`, `type === Stop/TrailingStop`, or `type === Limit` where `labelPosCache.get(id) === 'mid'` (active TP orders).

Additionally, `computeOrderDesired` skips Stop/TrailingStop and Limit-'mid' orders when `pos` is null — this prevents Effect 2 re-runs (triggered by `pendingBracketInfo` clearing in the same batch) from re-creating those primitives and flashing stale labels.

---

### Critical: initial cell value must not be '---'

**Problem:** Every time Effect 1 recreates the position primitive it starts with `pnl: '---'`. Even though `buildPositionLabel` overwrites it shortly after, there can be a visible frame with `'---'` on the canvas.

**Required fix:** In Effect 1, compute the initial P&L directly from `useStore.getState().lastPrice` and `refs.lastPnlCache` before constructing the primitive. The primitive is born with the correct value — `buildPositionLabel` then sets up the live updater as usual.

---

### Critical: bracket label position must survive the position-close race

**Problem:** When `pos` is null (position closed, orders pending cancellation), we can't determine whether a Limit order is a TP (mid) or standalone entry (right). Recomputing from scratch gives the wrong result and causes a brief jump to `'right'`.

**Required fix:** A `labelPosCache = useRef<Map<string, 'right' | 'mid'>>(new Map())` keyed by `orderId`. Populate it (`set`) whenever `pos != null`. Read it (`get`) whenever `pos == null`. This preserves the correct label position across the race window.

---

### Important: entry label when no position

**Problem:** `buildOrderLabels` used a blanket `continue` for all orders when `pos == null`, leaving standalone entry orders at `'---'`.

**Required fix:** The `!pos` branch should only skip Stop/Suspended orders (which are detached by `detachPositionDependentLines` anyway). Non-Suspended Limit orders with no position should show "Buy Limit" / "Sell Limit".

---

### Important: bracket movement must not be gated on `pendingBracketInfo`

**Problem:** The entry's `onDrag` handler wrapped bracket movement in `if (st.pendingBracketInfo)`. If the store value was null for any reason, Suspended bracket orders did not follow the entry during drag.

**Required fix:** Always move all Suspended bracket orders (`findSuspendedBracketIndices`) when the entry is dragged, regardless of `pendingBracketInfo`.

---

### Important: TP size cell inline zones

**Problem:** Left/right zone buttons for TP size redistribution (`−`/`+`) rendered as visually separate cells due to separator fill-rects and a fixed `SIDE_ZONE_W = 20` constant, making the cell appear wider than needed.

**Fix:** In `PriceLevelPrimitive.ts`: removed separator fill-rects between zones, replaced fixed `SIDE_ZONE_W` with text-measured widths, used symmetric `max(leftRaw, rightRaw)` so the main digit stays centered regardless of which zones are active. Zones with `transparent` color take up reserved space without drawing — so the digit never shifts when `−` appears/disappears. Per-zone hover highlights the hovered zone with a brightened background and 14px font.

In `buildOrderLabels.ts`: always passes `leftText: '−'` and `rightText: '+'` (disabled zones use `transparent` color rather than `undefined` text) to keep the reserved width stable.

---

## What's next

### Phase D — Preview lines ✓ complete (committed)
**Files touched:** `hooks/usePreviewLines.ts`, `hooks/buildPreviewLabels.ts`, `hooks/useOrderLines.ts`, `hooks/useOverlayLabels.ts`, `hooks/types.ts`, `CandlestickChart.tsx`, `hooks/drawingInputHandlers.ts`

- `refs.previewLines` is now `PriceLevelPrimitive[]` — each line is a canvas primitive with built-in drag
- `onDrag` moves sibling lines synchronously and calls `refs.updateOverlay.current()` for P&L batching
- Entry click-vs-drag handled by primitive's 4px threshold: `onClick` on pnl cell fires execute, drag moves the line
- `onDragEnd` on SL/TP calls `bracketEngine.updateArmedConfig` / `setPendingBracketInfo` when `previewHideEntry`
- **Deleted `usePreviewDrag.ts`** — all drag logic is in `onDrag`/`onDragEnd` callbacks
- Removed `refs.previewDragState`, `refs.entryClick`, `refs.activeDragRow` from `types.ts` and `CandlestickChart.tsx`
- `buildPreviewLabels.ts` rewritten to use `setCell`/`setCellOrder` canvas API; no DOM hit targets

### Phase D post-commit fixes

**SL/TP drag killing mid-drag (ad-hoc mode):** In ad-hoc bracket mode, dragging SL/TP called `setAdHocSlPoints`/`updateAdHocTpPoints`, which changed `adHocSlPoints`/`adHocTpLevels` — both in Effect 1's deps. Effect 1 tore down and recreated all primitives mid-drag, detaching the dragged primitive and killing `_onWindowMove`. Fix: Effect 1 now depends on `adHocSlExists` (`adHocSlPoints != null`) and `adHocTpCount` (`adHocTpLevels.length`) instead of the raw values — structural shape only. Effect 2 keeps the raw values for price updates.

**TP size cell too wide when all buttons disabled:** `buildOrderLabels` always passed `leftText: '−'` and `rightText: '+'` on TP size cells (even when both were transparent/disabled), reserving ~44px for a single digit. Fix: only include zone text when `showZones = !minusDisabled || !plusDisabled` — both-or-none keeps the digit centered; when both are disabled the cell is compact.

**`usePositionDrag.ts` crash on unmount:** `abortDrag` referenced `refs.activeDragRow` which was removed in Phase D. Fixed by removing that cleanup block.

---

### Phase E — Ghost drag line + cleanup
**Files:** `hooks/usePositionDrag.ts`, `hooks/useOverlayLabels.ts`, `screenshot/paintOverlays.ts`

- `usePositionDrag.ts`: replace `PriceLevelLine` ghost with `PriceLevelPrimitive` — keep window-listener orchestration, just swap the line object. Replace `posDragLabel` DOM div with primitive cells.
- `useOverlayLabels.ts`: remove `syncPosition()` calls and scroll/resize subscriptions used for DOM repositioning — canvas handles coordinates automatically. Keep `lastPrice` subscription for P&L updates.
- `screenshot/paintOverlays.ts`: remove manual `paintToCanvas` loop (lines 48–53) — order lines are on the LWC canvas and captured automatically.
- Delete `PriceLevelLine.ts` once no imports remain anywhere.

---

## Key files

```
frontend/src/components/chart/
  primitives/PriceLevelPrimitive.ts   ← done (Phase A + B/C fixes)
  primitives/OrderLinePrimitive.ts    ← re-export shim, delete eventually
  PriceLevelLine.ts                   ← delete in Phase E
  hooks/types.ts                      ← done (Phase B)
  hooks/useOrderLines.ts              ← done (Phase B)
  hooks/useOrderDrag.ts               ← deleted (Phase B)
  hooks/buildOrderLabels.ts           ← done (Phase C)
  hooks/buildPositionLabel.ts         ← done (Phase C)
  hooks/buildPreviewLabels.ts         ← done (Phase D)
  hooks/usePreviewLines.ts            ← done (Phase D)
  hooks/usePreviewDrag.ts             ← deleted (Phase D)
  hooks/usePositionDrag.ts            ← Phase E (ghost line swap)
  hooks/useOverlayLabels.ts           ← Phase E (remove sync loop)
  screenshot/paintOverlays.ts         ← Phase E (remove paintToCanvas loop)
```
