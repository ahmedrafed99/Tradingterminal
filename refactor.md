# DOM → Canvas Migration

## Status
Phases A–H complete and committed.
Phase F8 (axis label collision avoidance) still pending.

---

## Phase F8 — Axis label collision avoidance for order lines

The stacking logic in `DrawingsPrimitive.ts` (`priceAxisViews()`) currently only de-overlaps `hline` drawing labels and avoids the countdown/current-price zone. `PriceLevelPrimitive` axis labels are not included, so order line price badges overlap freely with each other and with drawings.

- Extract the de-overlapping pass into a shared utility.
- Feed order line prices into the same pass so all axis labels (drawings + order lines + current price) are stacked together.

---

## Phase H — Quick Order `+` button → `QuickOrderPrimitive` (complete)

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

**`priceAxisViews()`** — returns an axis badge at `_price` when visible (same style as crosshair badge), so the axis price label moves with the `+` button as a unit.

**Drag:** uses the same window-mousemove / mouseup pattern as `PriceLevelPrimitive`, gated on a 3px threshold. `onDrag` calls `_requestUpdate()` + `onDragUpdate`.

**Hover tracking:** `setChartElement` wires the same `mousemove` listener used by `PriceLevelPrimitive`. Hover over the `plus` cell → `setExpanded(true)`; leave the whole primitive → `setExpanded(false)`.

#### H2 — Rewrite `useQuickOrder.ts`
- Remove all DOM queries (`data-qo-*`), `sizeMinusEl`/`sizePlusEl`/`sizeCountEl` creation, and manual `el.style` updates.
- Create `QuickOrderPrimitive` once; `series.attachPrimitive` on mount, `series.detachPrimitive` on cleanup.
- `crosshairMove` handler calls `primitive.setCrosshair(snappedPrice, isBuy)`.
- Wire `onExecute` → `placeQuickOrder`, `onDragUpdate` → `updatePreviewPrices`, `onDragEnd` → drag-complete logic, `onSizeChange` → `st.setOrderSize` + `refreshLabel` + `createPreviewLines`.
- `onEnter`/`onLeave` logic (preview line creation/removal, `refs.qoHovered`) moves into `setExpanded` callback.
- `suppress` from `drawingHandlers` calls `primitive.setCrosshair(null, isBuy)`.

#### H3 — `CandlestickChart.tsx`
- Remove the `data-qo-*` JSX block entirely.
- Remove `quickOrderRef` (the ref is no longer needed; the primitive is owned by `useQuickOrder`).

---

## Key files

```
frontend/src/components/chart/
  primitives/QuickOrderPrimitive.ts     ← H1 (new)
  hooks/useQuickOrder.ts                ← H2
  CandlestickChart.tsx                  ← H3
```
