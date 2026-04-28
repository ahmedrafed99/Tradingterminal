# DOM → Canvas Migration

## Status
Phases A–E complete and committed.
Phase F complete and committed (F8 / axis label collision avoidance still pending).
Phases G, H pending.

---

## Phase F — Condition lines + PriceLevelLine deletion (pending user test)

> **Known open issue:** condition-triggered bracket orders activate at preset prices instead of the custom SL/TP positions set during arming. Root cause and attempted fixes documented in [`issues.md`](issues.md#condition-triggered-bracket-price-bug).

#### F1 — conditionLineTypes.ts
- Replace `PriceLevelLine` type imports with `PriceLevelPrimitive`.
- Update `PreviewState` and related fields (`condLine`, `orderLine`, `slLine`, `tpLines`) to hold `PriceLevelPrimitive` instances.

#### F2 — useConditionPreview.ts
- Replace each `new PriceLevelLine({ label: [...] })` with `new PriceLevelPrimitive({ cellOrder, cells })`.
- After `series.attachPrimitive(primitive)`, call `primitive.setChartElement(refs.container.current)` so hover/click works on ARM/size/close cells.
- Drag interaction: remove `wireDrag` DOM-listener wiring; drag is now handled by the primitive's built-in `onDrag`/`onDragEnd` callbacks.
- `syncPosition()` calls in cleanup/update paths removed — canvas handles repositioning.
- ARM, size, and close buttons become `onClick`/`rightClick` handlers on the relevant cells (or `hoverBg` + `onClick` per-cell).

#### F3 — useArmedConditionLines.ts
- Same pattern as F2: `new PriceLevelLine(...)` → `new PriceLevelPrimitive(...)` with `series.attachPrimitive` + `setChartElement`.
- Armed-line drag (`wireDrag` + `wireX`) migrates to `onDrag`/`onDragEnd` callbacks and `onClick` on the close cell.
- Cleanup: `line.destroy()` → `series.detachPrimitive(line)`.

#### F4 — useConditionLinesSync.ts
- **Delete the file.** Canvas primitives auto-reposition on scroll/zoom/resize. The lastPrice P&L subscription moves into the individual builder hooks (mirroring how `buildPositionLabel`/`buildOrderLabels` expose `pnlUpdaters`), or into `useConditionLines.ts` as a thin store subscription.

#### F5 — useConditionPreviewDrag.ts + useArmedConditionDrag.ts
- Remove `syncPosition()` calls — no longer needed.
- If these hooks become empty after removing sync calls, delete them.

#### F6 — useQuickOrder.ts
- Replace `new PriceLevelLine(...)` for entry/SL/TP hover lines with `new PriceLevelPrimitive(...)`.
- Lifecycle: `series.attachPrimitive` on creation, `series.detachPrimitive` on destroy.
- No `setChartElement` needed — hover lines are non-interactive.
- Remove any `line.syncPosition()` calls.

#### F7 — Delete PriceLevelLine.ts
- Grep `frontend/src` for any remaining `PriceLevelLine` import before deleting.
- Then delete `PriceLevelLine.ts` and `primitives/OrderLinePrimitive.ts` (re-export shim).

#### F8 — Axis label collision avoidance for order lines
- The stacking logic in `DrawingsPrimitive.ts` (`priceAxisViews()`) currently only de-overlaps `hline` drawing labels and avoids the countdown/current-price zone. `PriceLevelPrimitive` axis labels are not included, so order line price badges overlap freely with each other and with drawings.
- Extract the de-overlapping pass into a shared utility, then feed order line prices into the same pass so all axis labels (drawings + order lines + current price) are stacked together.

---

## Phase G — CrosshairLabelPrimitive → pure LWC (pending)

**Files:** `CrosshairLabelPrimitive.ts`, `CandlestickChart.tsx`, `screenshot/chartRegistry.ts`, `screenshot/paintOverlays.ts`

The DOM-based crosshair price badge is replaced with an `ISeriesPrimitive` that renders via `priceAxisViews()` — the same mechanism used by `PriceLevelPrimitive` for order/position axis badges. The lag between the LWC crosshair paint and the DOM update is eliminated because the primitive is painted in the same LWC frame.

#### G1 — Rewrite `CrosshairLabelPrimitive.ts`
- Implement `ISeriesPrimitive` (remove all DOM creation).
- State: `_price: number | null`, `_suppressed: boolean`, `_decimals: number`, `_tickSize: number`.
- `attached()` captures `_series` and `_requestUpdate`; `detached()` clears them.
- `priceAxisViews()` returns a single `ISeriesPrimitiveAxisView` when `_price != null && !_suppressed`:
  - `coordinate()` → `_series.priceToCoordinate(snapped)` (tick-snapped price).
  - `text()` → formatted price string (same locale format as current).
  - `backColor()` / `textColor()` → same constants as current DOM version.
- `updateCrosshairPrice(price)`, `suppress(bool)`, `setDecimals()`, `setTickSize()` — same public API; each calls `_requestUpdate()`.
- Remove the `el` getter entirely.

All callers (`useChartWidgets`, `useChartBars`, `drawingHandlers`, `useQuickOrder`) are unchanged — they call the same methods.

#### G2 — `CandlestickChart.tsx`
- Replace `new CrosshairLabelPrimitive(overlay, series, chart)` with `new CrosshairLabelPrimitive()` + `series.attachPrimitive(crosshairLabel)`.
- Cleanup: `series.detachPrimitive` instead of `crosshairLabel.destroy()`.
- Remove `crosshairLabelEl: crosshairLabel.el` from the registry entry.

#### G3 — `screenshot/chartRegistry.ts`
- Remove `crosshairLabelEl: HTMLDivElement | null` field.

#### G4 — `screenshot/paintOverlays.ts`
- Delete the crosshair label painting block (~15 lines). The `priceAxisViews()` badge lives on LWC's price scale canvas; if it needs to appear in screenshots that can be revisited separately.

---

## Phase H — Quick Order `+` button → `QuickOrderPrimitive` (pending)

**Files:** `primitives/QuickOrderPrimitive.ts` (new), `hooks/useQuickOrder.ts`, `CandlestickChart.tsx`

The QO DOM widget (`data-qo-wrap/label/size/text/plus`) is replaced with a canvas primitive that LWC positions in the same render frame as the crosshair, eliminating the lag. All interactive behaviours (hover-expand, size −/+, drag, click-to-place) are preserved.

#### H1 — Create `primitives/QuickOrderPrimitive.ts`

New class implementing `ISeriesPrimitive`. Internally reuses the cell + zone rendering logic from `PriceLevelPrimitive` (extract shared canvas-drawing helpers if needed, or duplicate the small draw pass).

**State:**
- `_price: number | null` — current snapped crosshair price; `null` = hidden.
- `_isBuy: boolean` — determines cell colors.
- `_expanded: boolean` — false = only `+` cell visible; true = size + label cells also visible.
- `_orderSize: number`, `_maxSize: number | null` — for −/+ zone disable logic.
- `_sizeButtonsActive: boolean` — true while cursor is inside the size cell.

**Public API (called from `useQuickOrder`):**
- `setCrosshair(price: number | null, isBuy: boolean)` — updates price/side, calls `_requestUpdate()`.
- `setOrderSize(size: number, max: number | null)` — refreshes size cell text and zone states.
- `setExpanded(expanded: boolean)` — toggles collapsed/expanded layout.
- `onExecute: (price: number, isBuy: boolean) => void` — callback fired on click / drag-then-click.
- `onDragUpdate: (price: number) => void` — fired every drag step (update preview lines).
- `onDragEnd: (price: number, didDrag: boolean) => void` — fired on mouse-up.
- `onSizeChange: (delta: 1 | -1) => void` — fired by −/+ zone clicks.

**Cells (collapsed):**
- `plus` — draws the `+` circle icon; background `COLOR_BORDER`, hover brightens. Click triggers execute / drag.

**Cells (expanded, prepended via `setCellOrder`):**
- `size` — order size number; `leftText: '−'` / `rightText: '+'` inline zones (disabled = `transparent`); hover reveals zones (`leftColor`/`rightColor` brighten).
- `label` — "Buy Limit" / "Sell Limit" text; hover highlight.

**`priceAxisViews()`** — returns an axis badge at `_price` when visible (same style as crosshair badge from Phase G), so the axis price label moves with the `+` button as a unit.

**Drag:** uses the same window-mousemove / mouseup pattern as `PriceLevelPrimitive`, gated on a 3px threshold. `onDrag` calls `_requestUpdate()` + `onDragUpdate`.

**Hover tracking:** `setChartElement` wires the same `mousemove` listener used by `PriceLevelPrimitive`. Hover over the `plus` cell → `setExpanded(true)`; leave the whole primitive → `setExpanded(false)`.

#### H2 — Rewrite `useQuickOrder.ts`
- Remove all DOM queries (`data-qo-*`), `sizeMinusEl`/`sizePlusEl`/`sizeCountEl` creation, and manual `el.style` updates.
- Create `QuickOrderPrimitive` once; `series.attachPrimitive` on mount, `series.detachPrimitive` on cleanup.
- `crosshairMove` handler calls `primitive.setCrosshair(snappedPrice, isBuy)` (and still calls `refs.crosshairLabel.current?.updateCrosshairPrice` for the axis badge until G is done).
- Wire `onExecute` → `placeQuickOrder`, `onDragUpdate` → `updatePreviewPrices`, `onDragEnd` → drag-complete logic, `onSizeChange` → `st.setOrderSize` + `refreshLabel` + `createPreviewLines`.
- `onEnter`/`onLeave` logic (preview line creation/removal, `refs.qoHovered`) moves into `setExpanded` callback.
- `suppress` from `drawingHandlers` calls `primitive.setCrosshair(null, isBuy)` — same as hiding the widget today.

#### H3 — `CandlestickChart.tsx`
- Remove the `data-qo-*` JSX block entirely.
- Remove `quickOrderRef` (the ref is no longer needed; the primitive is owned by `useQuickOrder`).

---

## Key files

```
frontend/src/components/chart/
  hooks/conditionLineTypes.ts           ← F1
  hooks/useConditionPreview.ts          ← F2
  hooks/useArmedConditionLines.ts       ← F3
  hooks/useConditionLinesSync.ts        ← F4 (delete)
  hooks/useConditionPreviewDrag.ts      ← F5
  hooks/useArmedConditionDrag.ts        ← F5
  hooks/useQuickOrder.ts                ← F6, H2
  PriceLevelLine.ts                     ← F7 (delete)
  primitives/OrderLinePrimitive.ts      ← F7 (delete)
  CrosshairLabelPrimitive.ts            ← G1 (rewrite)
  screenshot/chartRegistry.ts           ← G3
  screenshot/paintOverlays.ts           ← G4
  primitives/QuickOrderPrimitive.ts     ← H1 (new)
  CandlestickChart.tsx                  ← G2, H3
```
