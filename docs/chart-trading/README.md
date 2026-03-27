# Feature: Chart Trading

All interactive trading features rendered directly on the chart canvas — order placement, order/position line visualization, preview overlays, drag-to-modify, and the quick-order + button.

**Status**: Implemented

---

## UI Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  [NQ ▼]  1m  15m  ▼                    [□□] | [📷] | 12:34 New York │
│──────────────────────────────────────────────────────────────────────│
│                                                                      │
│  ════════════════════════════════════════════  ← TP1 (ghost, preview)│
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ← Entry (ghost)      │
│  ════════════════════════════════════════════  ← SL  (ghost, preview)│
│                                                                      │
│  - - - - - - - - - - - - - - - - - - - - - -  ← chart crosshair    │
│                                                                      │
│  ──── Limit #9056  1 ct  @18420.00  [✕]  ←── open order line        │
│  ──── TP1   #9057  1 ct  @18450.00  [✕]                             │
│  ──── SL    #9058  1 ct  @18400.00  [✕]                             │
│                                                                      │
│                        [Buy Limit 1][+]|24,881.00| ← + button       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Plus Button (Quick Limit Order)

One-click limit order button attached to the left side of the crosshair price label on the right price scale.

### UI

#### Default (crosshair active)

```
                                        [+]|24,886.75|
```

#### Hovered — below market price

```
                        [Buy Limit 1][+]|24,881.00|
```

#### Hovered — above market price

```
                       [Sell Limit 1][+]|24,891.00|
```

- **"+" button**: 20x20px, SVG circled-plus icon (16px, `stroke: var(--color-text)`), no background fill
- **"+" hover state**: `background: #434651`, border radius changes to `0 2px 2px 0` (rounds only right side)
- **Label text cell**: `background: #cac9cb`, `color: #000` (matches live order labels without a position)
- **Label size cell**: `background: #00c805` (buy) / `#ff0000` (sell), `color: #000`, separated by `1px solid #000` border
- **Label font**: `monospace`, 11px, bold
- **Label border radius**: `2px 0 0 2px` (rounds only left side)
- **Vertical position**: centered on the crosshair via `transform: translateY(-50%)`
- **Horizontal position**: right edge flush with the price scale, dynamically computed via `chart.priceScale('right').width()`

### DOM overlay approach (no React re-renders)

The button is a static JSX structure managed entirely through DOM manipulation in a `useEffect`. This avoids React state updates on every crosshair move.

```tsx
<div ref={quickOrderRef} className="absolute z-30 pointer-events-none"
     style={{ display: 'none', transform: 'translateY(-50%)' }}>
  <div data-qo-wrap style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
    <div data-qo-label style={{ display: 'none', ... }} />
    <div data-qo-plus style={{ width: 20, height: 20, ... }}>+</div>
  </div>
</div>
```

### Guard: order chart only

The button only renders on the chart whose contract matches the order panel's contract (`isOrderChart`). In dual-chart mode, it appears only on the chart tied to the order panel.

### Crosshair move handler

```ts
const onMove = (param) => {
  if (isDragging || awaitingClick) return;  // frozen during drag/await
  if (refs.labelHovered.current) { el.style.display = 'none'; return; } // suppress while over a label
  if (!param.point) { /* hide with delay */ return; }

  const rawPrice = series.coordinateToPrice(param.point.y);
  const lastP = useStore.getState().lastPrice ?? lastBarRef.current?.close;

  snappedPrice = Math.round(rawPrice / contract.tickSize) * contract.tickSize;
  if (!isHovered) {
    isBuy = lastP != null ? snappedPrice < lastP : true;
  }

  el.style.display = 'flex';
  el.style.top = `${param.point.y}px`;
  el.style.right = `${chart.priceScale('right').width()}px`;
};
```

- **Label suppression**: when the cursor is over any overlay label (`refs.labelHovered.current`), the + button is hidden entirely (`display: 'none'`). This prevents the z-30 button from intercepting clicks on label buttons (cancel-X, +SL, +TP, TP size ±) — critical in dual-chart layouts where small charts push labels close to the price scale.
- **Price snapping**: rounds to the nearest tick size for valid order placement
- **Direction**: compares snapped price to market price (`lastPrice` from real-time, falls back to `lastBarRef.current.close` from historical data). **Side is locked once hovered** — `isBuy` only recalculates when `!isHovered`, preventing the label from flipping between "Buy Limit" and "Sell Limit" if the market price crosses while the user is hovering.
- **Position**: `top` tracks the crosshair Y, `right` aligns with the price scale edge

### Hover behavior

Hover is handled via `mouseenter`/`mouseleave` on the `data-qo-wrap` container (covers both the label and the "+" button, preventing flicker when moving between them).

- **Enter**: shows the label, updates text/colors based on direction, highlights the "+" button. If a bracket preset is active, creates temporary SL/TP preview lines and overlay labels on the chart.
- **Leave**: hides the label, resets "+" button style, removes preview lines and hover labels.

### Flicker prevention

When the mouse moves from the chart canvas to the "+" button overlay, the chart fires a crosshair-move with no `param.point` (mouse left the canvas). A 50ms delay timer prevents hiding the button before the `mouseenter` event fires on the overlay:

```ts
if (!param.point) {
  hideTimer = window.setTimeout(() => {
    if (!isHovered) el.style.display = 'none';
  }, 50);
  return;
}
```

Similarly, `mouseleave` uses a 100ms delay before hiding, allowing re-entry without flicker.

### Bracket preset integration

When a bracket preset is active (`activePresetId` in the store), the button integrates with the bracket system:

**On hover** — `createPreviewLines()` creates `PriceLevelLine` instances with labels baked in:
- Entry reference line (`#787b86` gray dashed, no label)
- SL line (`#ff0000` red dashed) + label sections with projected P&L (red) and size
- TP lines (`#00c805` green dashed) + label sections with projected P&L (green) and size — trimmed via `fitTpsToOrderSize()` so only TPs that fit within `orderSize` are shown

Price offsets computed via `pointsToPrice(points, contract)` from `utils/instrument.ts`, same formula as the main preview system. Labels are passed as `LabelSection[]` to the `PriceLevelLine` constructor — no separate `buildRow()` or `createHoverLabels()` step.

**On leave** — `removePreviewLines()` calls `destroy()` on all `PriceLevelLine` instances, tearing down lines and labels together.

**On click** — if a preset is active with SL/TP points >= 1, uses a **dual-path strategy**:

**<= 1 TP (gateway-native brackets)**:
1. `buildNativeBracketParams(bc, side)` returns `{ stopLossBracket?, takeProfitBracket? }`
2. Bracket params are spread into the `placeOrder` call — gateway places SL/TP atomically
3. No bracket engine involvement (gateway handles OCO auto-cancel)

**2+ TPs (client-side engine)**:
1. Arms the bracket engine (buffers early fills)
2. Places the limit order
3. Confirms orderId with engine
4. Engine listens for fill and places SL + TPs as separate orders

Both paths:
- Set `pendingBracketInfo` in the store (persisted to sessionStorage) with computed prices/sizes, and store the entry order ID via `setPendingEntryOrderId`
- Remove hover labels (permanent ones take over via overlay label effect)
- Destroy the entry reference line immediately (the live order line replaces it); Suspended bracket lines are rendered by `useOrderLines` with dashed style
- Subscribe to store for fill/cancel detection to clean up `pendingBracketInfo`

```ts
// Dual-path decision
const nativeBrackets = buildNativeBracketParams(bc, side, contract);
if (!nativeBrackets) {
  bracketEngine.armForEntry({ ..., contract }); // 2+ TPs only
}

orderService.placeOrder({ ...baseParams, ...nativeBrackets });
```

**On error** — full cleanup: disarms bracket engine if armed (`clearSession()`), clears `pendingBracketInfo`, removes hover labels, shows error toast.

**Market-closed guard** — `placeQuickOrder()` calls `isFuturesMarketOpen()` before any bracket arming or API call. If closed: shows a warning toast, clears `pendingBracketInfo`, and returns.

**No preset selected** — places a naked limit order with no SL/TP.

### Click and drag-to-adjust

The + button supports click+drag to adjust the entry price before placing:

1. **Simple click** (< 3px movement): places limit order immediately at the hovered price
2. **Click + drag**: slides the entry price and all bracket preview lines (SL/TP) in real-time. During drag, chart scroll/scale is disabled. P&L labels update live via `updatePreviewPrices()`.
3. **Release after drag**: enters `awaitingClick` mode — the + button freezes in place, `onMove` and `onLeave` are blocked, preview lines stay visible.
4. **Click while awaiting** (< 3px movement): places the order at the adjusted price.
5. **Drag while awaiting**: re-adjusts the position (returns to step 3, does NOT place).
6. **Click outside the + button while awaiting**: cancels — cleans up preview lines and hides the button.

State machine flags: `isDragging` (true during mousedown→mouseup), `awaitingClick` (true after drag release until click or cancel), `didDrag` (3px threshold distinguishes click from drag).

### Place limit order

```ts
orderService.placeOrder({
  accountId: st.activeAccountId,
  contractId: contract.id,
  type: 1,           // limit order
  side: isBuy ? 0 : 1,  // 0 = buy, 1 = sell
  size: st.orderSize,    // reads from order panel's current size
  limitPrice: snappedPrice,
});
```

- **Order size**: reads `orderSize` from the store (matches the order panel's size selector)
- **Order type**: always limit (type 1)
- **Side**: 0 (buy) if crosshair is below market, 1 (sell) if above

### Effect dependencies

`[contract, timeframe, isOrderChart]` — re-subscribes when instrument, timeframe, or order chart binding changes.

---

## Live Order & Position Lines

Always visible (regardless of preview toggle). Each line is a `PriceLevelLine` instance — a unified imperative class that owns the horizontal line, axis label, and optional label pill as HTML elements in the chart overlay div.

- **Position entry**: solid grey `#cac8cb` at `averagePrice`
- **Order colors are profit/loss-based** when a position exists: green `#00c805` if the order price is in profit territory relative to position entry, red `#ff0000` if in loss territory. This means an SL moved above entry (long) turns green, and a TP is always green.
- **Same-side limit orders** (entries that add to a position, e.g. Buy Limit when Long) use **side-based coloring** (buy=green, sell=red) instead of profit/loss coloring — they are new entries, not take-profits.
- **Without a position**: stop orders default to red, limit orders use side-based coloring (sell=red, buy=green)
- **Line color updates during drag**: as an order is dragged across the entry price, `line.setLineColor()` flips between green and red in real-time
- Each line tracks its `Order` object via `orderLineMetaRef` for drag identification

### OrderLineLayer

- Reads open orders from Zustand store (kept fresh by SignalR)
- For each open order, creates a `PriceLevelLine`:
  - Horizontal line + axis label showing the price
  - Label pill added later by `useOverlayLabels` via `line.setLabel(sections)`
  - Colour: green for buy-side, red for sell-side
  - X icon button -> calls `orderService.cancelOrder()`
  - Drag (mousedown + mousemove + mouseup on the label) -> calls
    `orderService.modifyOrder()` with the new price on mouseup
- **Label styling**: all text is black (`#000`), cells separated by `1px solid #000` border
- Order lines are destroyed (`line.destroy()`) when the corresponding order
  is no longer in the open-orders list (detected via SignalR)

---

## Preview Overlay

Rendered when `previewEnabled = true` (set from OrderPanel checkbox). Each preview line is a `PriceLevelLine` instance:
- Entry line always shown when preview is on (even with no preset)
- SL/TP lines shown when a bracket preset is active **or** ad-hoc SL/TP have been added
- Dashed price lines for Entry (grey `#787b86`), SL (red `#ff0000`), each TP (green `#00c805`)
- `resolvePreviewConfig()` helper unifies preset+draft and ad-hoc state into a single `BracketConfig`, trimming TPs to fit within `orderSize` via `fitTpsToOrderSize()` (first TPs get priority; extras that exceed the order quantity are dropped)
- Two-effect pattern in `usePreviewLines`: structural effect creates/destroys `PriceLevelLine` instances on config change; price-update effect calls `line.setPrice()` in-place to avoid flicker
- The price-update effect's `doUpdate()` is skipped while a live order drag is active (`orderDragState` ref set) — the drag handler in `useOrderDrag` manages preview positions itself, and the store's `limitPrice` is stale until mouseup, so `doUpdate()` would snap SL/TP lines back to pre-drag positions on every market tick
- Initial prices read imperatively via `useStore.getState()` to avoid flash-at-bottom on first toggle

Shows ghost price lines (semi-transparent) for:
  - **Entry** at the last price or current limit price
  - **SL** at `entry +/- stopLossTicks * tickSize`
  - **TP1..TPN** at respective offsets
- Lines update live as bracket settings change

---

## Overlay Label System

Labels are managed by `PriceLevelLine.setLabel(sections)` — each line owns its own label pill as an HTML `<div>` in the overlay. `useOverlayLabels` configures the label sections (P&L, size, buttons) and registers hit targets, but does not create DOM elements directly.

Each label is a row of colored cells: `[│ P&L or label] [size] [X]`

### Drag-handle grip

The first cell (P&L) contains a 1px-wide vertical grip bar (14px tall, `#000`) on its left side, acting as a visual drag affordance. The bar lives inside cell 0 as a flex child (`<div>` bar + `<span>` text), sharing the cell's background color so it updates automatically with P&L color changes. The grip is not rendered in screenshots (`paintToCanvas` reads `cell.textContent` which returns only the span text).

### Label horizontal offset (anti-overlap)

Entry and position labels are positioned at 65% of the plot width (`setLabelLeft(0.65)`), while SL/TP labels stay centered at 50%. This prevents overlap when entry and SL/TP prices are close together (e.g. a tight 4-point stop loss when zoomed out). The offset applies to:
- Position labels (live position entry line)
- Preview entry labels (order panel preview)
- Pending entry order labels (+ button flow with `pendingBracketInfo`, or Buy/Sell flow with `previewHideEntry`)

**All overlay labels use `pointer-events: none`** — mouse events pass through to the LWC canvas so the crosshair stays visible when hovering over any label. Interactions (click, drag) are detected via coordinate-based hit testing at the chart container level using `getBoundingClientRect()`.

### Hit-target registry

Each interactive element (button cell, draggable row) is registered in `hitTargetsRef` with a priority:

| Priority | Target | Action |
|----------|--------|--------|
| 0 | Button cells (close-X, +SL, +TP) | Click — fires immediately |
| 1 | Entry label firstCell | Click-vs-drag — stores downX/downY, checked on mouseup (< 4px = click) |
| 1 | Order row drag | Drag — starts order drag state (higher priority than position to win when overlapping, e.g. SL at breakeven) |
| 2 | Position / preview row drag | Drag — starts position or preview drag state |

A container-level `mousedown` handler (`onOverlayHitTest`) iterates sorted hit targets, checks `getBoundingClientRect()` vs mouse coordinates, skips hidden elements (`el.offsetParent === null`), and fires the first match. This handler is registered **first** among all mousedown listeners (before drawing handlers) and uses `stopImmediatePropagation()` to prevent drawing interactions from capturing the same click — this ensures order/position line drags always win over drawings underneath. The `onHandleHover` mousemove handler checks hit targets to show `cursor: grab` for row-drag targets (priority ≥ 2) and `cursor: pointer` for button targets (priority 0/1).

### Plus button suppression on label hover

The quick-order + button (z-30, `pointer-events: auto`) sits above the overlay labels (z-20, `pointer-events: none`). On small charts (e.g. dual layout), labels near the price scale overlap the + button, causing it to steal clicks from cancel-X / drag targets.

Fix: `onHandleHover` in `useChartDrawings` sets a shared `refs.labelHovered` flag whenever the cursor is over any hit target. When true, the + button element is hidden (`display: 'none'`) and `useQuickOrder`'s crosshair move handler skips re-showing it. The flag resets to false as soon as the cursor moves off the label, restoring normal + button behavior.

### Position label
- Real-time P&L (green/red), contract size, X to close position (market order)
- Drag-to-create: mousedown on position label starts a drag — dragging in the loss direction creates a stop order (full position size), dragging in the profit direction creates a limit TP order (1 contract per drag)

### Order labels
- **P&L cell**: colored by profit/loss relative to position — green if order is in profit territory, red if in loss. Updates dynamically during drag as the price crosses the entry. **Same-side limit orders** (entries that add to a position) show "Buy Limit"/"Sell Limit" in grey (`#cac9cb`) with black text instead of P&L — they are new entries, not exits.
- **Size cell**: colored by order side — sell = red `#ff0000`, buy = green `#00c805`. Stays constant regardless of order position (reflects that it's a market sell/buy order).
- When no position exists, label shows "SL"/"Buy Limit"/"Sell Limit" in grey (`#cac9cb`) with black text
- X to cancel order

### TP size +/- buttons (live TP orders only)

For **multi-contract positions** (`pos.size > 1`), TP order labels show hover-reveal `−` / `+` buttons inside the size cell to redistribute contracts across TPs without cancelling/recreating orders.

```
Normal:      [│ +$50.00 ][ 2 ][ × ]
Size hover:  [│ +$50.00 ][ − 2 + ][ × ]
```

**Implementation**: The 3-cell label structure `[P&L, size, ×]` is unchanged. After `setLabel()`, the size cell (`cells[1]`) is customized with three sub-elements (`minusEl`, `countEl`, `plusEl`). The `−` and `+` are hidden by default (`display:none`) and revealed on hover via a coordinate-based `mousemove` listener. Hover state persists across label rebuilds via `hoveredTpOrderId` ref.

**Rules**:
- `+` adds 1 unallocated contract to this TP — never steals from another TP
- `−` removes 1 contract from this TP — the freed contract becomes unallocated, never auto-given to another TP
- `−` is disabled (`opacity: 0.5`) when size is 1 — user must use `×` to cancel
- `+` is disabled when no unallocated contracts remain (all contracts assigned to TPs)
- A TP can never be reduced below 1 contract
- SL is untouched — always keeps full position size
- Skipped entirely for 1-contract positions (both buttons would always be disabled)

**Handler**: Calls `orderService.modifyOrder()` for the clicked TP only. Guarded by `tpRedistInFlight` ref to prevent concurrent modifications. After each successful modify, calls `bracketEngine.updateTPSize()` to keep `normalizedTPs` in sync.

**Hit targets**: `−` and `+` sub-elements are registered as priority-0 hit targets (same as cancel-X), only when not disabled. Screenshot support: `data-screenshot-text` attribute on the size cell ensures `paintToCanvas` renders just the count number without `−`/`+` symbols.

### Preview labels
- Entry shows "Limit Buy"/"Limit Sell" in grey (`#cac9cb`) with black text (clickable to execute), size cell colored by side (green buy / red sell)
- **Execute button market-closed guard**: the entry label's execute handler (`onExecute` in `buildPreviewLabels.ts`) calls `isFuturesMarketOpen()` before arming the bracket engine or placing the order. If closed, shows a warning toast and returns immediately — no bracket engine arming, no API call.
- SL/TP show projected P&L relative to entry price
- Each TP shows its **individual** contract size from the preset or ad-hoc level (not total orderSize). SL shows total size. TPs are trimmed to fit within `orderSize` — if a preset has 2 TPs (1 ct each) but order size is 1, only the first TP is previewed
- When no preset is active, entry label includes **+SL** and **+TP** buttons to add ad-hoc bracket lines

### Real-time P&L updates
- P&L values update in real-time via `line.updateSection(index, text, bg, color)` — no DOM rebuild, direct text/color mutation
- Zustand subscription (bypasses React render cycle) feeds fresh P&L to updater closures
- `updateOverlayRef` stores the position-update function, called by the sync effect

---

## Overlay Sync

Smooth positioning for all `PriceLevelLine` instances during interaction:

- `updatePositions()` calls `line.syncPosition()` on every live line (preview, order, posDragLine), then runs P&L updater closures
- **Single RAF coalescing**: All sync triggers (lastPrice subscription, `visibleLogicalRangeChange`, drag mousemove, ResizeObserver, wheel) funnel through a single `scheduleSync()` that uses one `requestAnimationFrame` flag. This guarantees at most one `updatePositions()` call per frame, even when a price tick, a scroll event, and a drag mousemove all fire within the same 16ms window
- `scheduleOverlaySync` ref is shared between the label-config effect (price subscription) and the sync-loop effect (scroll/drag/resize) so both use the same coalescing flag
- Also listens to `visibleLogicalRangeChange` (horizontal scroll), `ResizeObserver`, and `wheel` events — all deferred to RAF
- Zero overhead when idle — mousemove listener only attached during pointer drag
- **Layout metric caching**: `PriceLevelLine.syncPosition()` uses a per-frame cache for `overlay.clientWidth` and `priceScale.width()` reads (via `getLayoutMetrics()`), so N lines in the same frame trigger only one layout reflow instead of N

---

## Label-Initiated Drag

Click label to edit price:

- All labels are `pointer-events: none` — interaction is detected by the container-level `onOverlayHitTest` handler via coordinate hit testing
- `onOverlayHitTest` fires the registered drag handler, which sets shared drag state refs (`previewDragStateRef` or `orderDragStateRef`)
- `mousemove` / `mouseup` listeners on `window` handle the drag (works even when mouse leaves the label)
- Cursor shows `grab` when hovering over a draggable label, switches to `grabbing` during drag, resets to crosshair on release
- Close-X buttons are registered as priority-0 hit targets, so they fire before row drag (priority 2)
- **Crosshair stays visible during drag**: drag mousemove handlers do NOT call `stopPropagation()`, allowing LWC to see mouse events. Instead, `chartRef.applyOptions({ handleScroll: false, handleScale: false })` is set on drag start to prevent chart panning, and re-enabled on mouseup.

### Preview drag
- Entry -> sets `orderType: 'limit'` + `limitPrice`
- SL/TP -> writes to `draftSlPoints` / `draftTpPoints` (preset mode) or `adHocSlPoints` / `updateAdHocTpPoints` (ad-hoc mode)

### Order drag
- On mouse up calls `orderService.modifyOrder()` with new `stopPrice` or `limitPrice`
- **Limit entry drag shifts bracket lines**: when dragging a pending limit entry order, all associated SL/TP lines (Suspended orders or phantom bracket lines from `pendingBracketInfo`) shift by the same delta. On mouseup, optimistically commits shifted prices to `pendingBracketInfo` store state and calls `modifyOrder`. On API error, reverts all positions.
  - *Preview with hidden entry* (Buy/Sell button flow): shifts `previewPrices` and `previewLines` refs using `resolvePreviewConfig()` offsets. On mouseup, updates `limitPrice` in store. On API error, reverts.

### Position drag
- Drag from position label to create SL/TP orders directly (see Position label above)
- Prices snap to tick size during drag

---

## Drag-to-Modify (Order Lines)

1. User mousedowns on an order line
2. App stores `startY` and `startPrice`
3. Mousemove: compute `newPrice = chart.coordinateToPrice(currentY)`
4. A ghost line follows the cursor; original line stays
5. **Mouseup — client-side validation (stop orders only)**:
   - Stop-sell (protects long) → new price must be **below** current price
   - Stop-buy (protects short) → new price must be **above** current price
   - Current price = `lastPrice` from store, falls back to `lastBar.close` from chart
   - If invalid: line reverts instantly, warning toast shown, **no API call**
6. Mouseup (valid): call `PATCH /orders/modify` -> proxy -> `/api/Order/modify`
7. On success the order line snaps to the confirmed price via the SignalR update
8. **On failure**: line reverts to `originalPrice` with correct profit/loss color, error toast shown

Lightweight Charts v4 does not have built-in draggable price lines;
drag behaviour is implemented with DOM event listeners + `priceToCoordinate`
/ `coordinateToPrice` helpers.

**Stale closure note**: The drag `mouseup` handler reads `lastPrice` and `positions` fresh from `useStore.getState()` (not from the effect closure), because the effect only re-mounts on `[isOrderChart, contract]` changes — position/price state captured in the closure would be stale.

---

## Position Drag-to-Create

Drag from position label on chart to create real SL/TP orders directly:
- Drag shows a live dashed price line + overlay label with projected P&L during drag
- Drag in loss direction -> stop order (type 4, full position size). Blocked if stop order already exists
- Drag in profit direction -> limit order (type 1, 1 contract per drag). Blocked if no remaining contracts
- Position drag uses capture-phase event listeners to ensure events aren't consumed by the chart canvas

**Position close -> auto-cancel all orders**: When a position closes (size=0), all open orders for that contract are cancelled automatically. Uses fresh API fetch (`searchOpenOrders`) rather than store state (which may be stale due to SignalR event ordering). Orders already being cancelled by the bracket engine (returned from `clearSession()`) are skipped to avoid double-cancel toasts. `contractId` comparison uses `String()` coercion (API may return number, SignalR sends string).

**Position size change -> SL size sync**: When a position's size changes (TP partial fill, manual partial close, or added contracts), the SL order size is automatically synced to match. Runs unconditionally (regardless of whether bracket engine has an active session) as both the primary handler for ad-hoc SL and a safety net for bracket engine failures. Duplicate modifies are harmless. Uses `useStore.getState().activeAccountId` (fresh read) to avoid stale closure issues.

---

## Native Bracket Order Lifecycle (Gateway Bracket Orders)

### How native brackets work

When a limit order is placed with `<= 1 TP` and no price-based conditions, the gateway creates bracket legs (SL/TP) via `stopLossBracket`/`takeProfitBracket` parameters on the `placeOrder` call. The bracket legs arrive via SignalR as **Working orders immediately** — they are live on the exchange from the moment the entry is placed.

Key gateway behaviors:
- Bracket legs arrive with **no `customTag`** — they cannot be reliably identified by a tag. Instead, they are matched by **opposite side + order type** (Stop/TrailingStop = SL, Limit = TP).
- On entry fill, the gateway **recalculates bracket prices** using `fill_price + original_tick_offsets`, overwriting any `modifyOrder` calls made before the fill.
- `modifyOrder` on bracket legs before fill is acknowledged but **silently reverted on fill** — the gateway always uses the original tick offsets from placement time.

### Post-fill bracket price correction

When a user drags SL/TP preview lines after placing a limit order (adjusting bracket positions), the gateway will reset those prices on fill. The correction flow handles this:

**Phase 1 — During drag** (`usePreviewDrag.ts`):
- `draftSlPoints`/`draftTpPoints` are updated in the Zustand store (same as pre-placement drag)
- `bracketEngine.updateArmedConfig()` is called for the engine path (2+ TPs)
- No `pendingBracketInfo` is set (avoids phantom line duplication and `useOrderLines` re-render flicker)

**Phase 2 — On entry fill** (`OrderPanel.tsx`):
1. `resolvePreviewConfig()` reads the current draft state to compute desired bracket prices relative to the fill price
2. **Immediate optimistic upsert**: bracket orders are updated in the store with corrected prices (no visual flash)
3. **Suppression**: bracket order IDs are tracked in `bracketCorrectionIds` ref — incoming SignalR events for these orders are suppressed to prevent the gateway's original prices from overwriting the optimistic update
4. **Delayed `modifyOrder`** (500ms): after the gateway finishes processing the fill, `modifyOrder` is called to correct the prices on the exchange
5. **Cleanup** (2.5s): suppression is lifted, `previewHideEntry` is cleared

### Line rendering during `previewHideEntry`

When `previewHideEntry` is active (limit order placed with brackets):
- **Bracket order lines are hidden** in `useOrderLines` — orders on the opposite side of `previewSide` are skipped
- **Phantom bracket lines are hidden** — `pendingBracketInfo` phantom lines are skipped when `previewHideEntry` is true
- **Preview lines handle SL/TP display** — `usePreviewLines` renders dashed lines at the bracket positions, and `usePreviewDrag` handles drag interaction
- This prevents duplicate lines during drag (preview line moving + order line stuck at original price)

### REST refresh guard

A 1.5-second delayed `searchOpenOrders` REST call fires after Working order SignalR events to hydrate externally-placed orders.

**Guard**: The refresh is skipped when `previewHideEntry` is active. This prevents the REST response (which returns bracket orders at gateway prices) from overwriting corrected prices in the store during the post-fill correction window.

### customTag note

The gateway may tag bracket legs as `AutoBracket{guid}-SL` / `-TP` in `customTag`, but this is **not reliable for native brackets** — the ProjectX realtime adapter does not always propagate `customTag`. All bracket identification uses **side + order type heuristics** as the primary method.

---

## Pending Bracket Info

After placing via the + button (or Buy/Sell button) with brackets armed, `pendingBracketInfo` tracks the expected bracket prices until the entry fills or is cancelled. This state is persisted to **sessionStorage** so it survives page refreshes.

### Store state

`pendingBracketInfo` in `useStore`:
```ts
{
  entryPrice: number;
  slPrice: number | null;
  tpPrices: number[];
  side: 0 | 1;
  orderSize: number;
  tpSizes: number[];
} | null
```

`pendingEntryOrderId` in `useStore`: `number | null` — the entry order ID, also persisted to sessionStorage.

Set on click (with brackets), cleared on entry fill/cancel by `OrderPanel.tsx`.

### How it integrates with rendering

- `useOrderLines` reads `pendingBracketInfo` and creates **phantom bracket lines** (dashed) at the expected SL/TP prices — but **only when `previewHideEntry` is false**. When `previewHideEntry` is true, preview lines handle SL/TP display instead.
- On entry fill, `OrderPanel.tsx` clears `pendingBracketInfo` and runs the post-fill bracket correction.
- On entry cancel, `OrderPanel.tsx` clears `pendingBracketInfo`.

### Bracket leg cancel

Cancel buttons on Suspended order labels use optimistic update with rollback: the order is removed from the store immediately, then `cancelOrder` is sent to the gateway. If the gateway call fails, the order is re-added via `upsertOrder` and an error toast is shown.

---

## Draft Overrides (Preview Line Dragging)

Ephemeral point overrides for bracket config, set by dragging preview lines on chart:
- `draftSlPoints: number | null` — overrides `config.stopLoss.points`
- `draftTpPoints: (number | null)[]` — overrides `config.takeProfits[i].points`
- Auto-cleared on: preview toggle off, preset change, preset suspend, order placement
- Used by: `BuySellButtons` (merged into bracket config), `BracketSummary` (visual indicator), `CandlestickChart` (line positions)

---

## Ad-Hoc Brackets (No Preset Required)

Ephemeral SL/TP state for orders without a bracket preset:
- `adHocSlPoints: number | null` — SL distance in points (null = no SL)
- `adHocTpLevels: { points: number; size: number }[]` — each TP with distance + contract count

### Pre-fill mode (preview on, no preset selected)
- Entry label shows `[│ Limit Buy] [1] [+SL] [+TP] [X]`
- **+SL**: creates SL line at default 10pt distance. Hidden once SL exists.
- **+TP**: creates TP line (1 contract, staggered distance 20/40/60pt). Hidden when all contracts allocated.
- SL/TP lines are draggable to reposition. X on each removes it.
- Clicking entry label executes with ad-hoc brackets via bracket engine.
- For limit orders, SL/TP preview lines persist after submission until the entry order fills.

### Post-fill mode (position drag-to-create)
- Drag from position label on chart to create real SL/TP orders directly.
- Drag shows a live dashed price line + overlay label with projected P&L during drag.
- Drag in loss direction -> stop order (type 4, full position size). Blocked if stop order already exists.
- Drag in profit direction -> limit order (type 1, 1 contract per drag). Blocked if no remaining contracts.
- Position drag uses capture-phase event listeners. Crosshair stays visible during drag (no `stopPropagation`); chart pan is disabled via `handleScroll: false` / `handleScale: false` during drag.

Auto-cleared on: preview toggle off, preset selection, position fill (real bracket orders take over).

---

## Limit Order Cancel Cleanup

When a limit order is placed with preview enabled (`previewHideEntry: true`), the SL/TP preview lines remain visible while the order is pending. If the order is cancelled (status 3/4/5):

```
SignalR GotOrder (status = cancelled)
  --> if previewHideEntry && contractId matches orderContract
        --> bracketEngine.clearSession()
        --> clearAdHocBrackets()
        --> set previewEnabled = false, previewHideEntry = false
```

This cleanup runs in `OrderPanel.tsx`'s order event handler.

---

## State (Zustand)

```ts
// OrderPanelState (chart-trading related fields)
interface OrderPanelState {
  previewEnabled: boolean
  previewSide: 0 | 1
  previewHideEntry: boolean       // true when limit order placed with preview
  draftSlPoints: number | null
  draftTpPoints: (number | null)[]
  adHocSlPoints: number | null
  adHocTpLevels: { points: number; size: number }[]
  pendingBracketInfo: { ... } | null    // persisted to sessionStorage
  pendingEntryOrderId: number | null     // persisted to sessionStorage
}
```

---

## Files

| File | Role |
|------|------|
| `frontend/src/components/chart/PriceLevelLine.ts` | Unified imperative class — owns horizontal line, label pill, and axis label as HTML elements. Used by all price lines (orders, positions, previews, QO hover). |
| `frontend/src/components/chart/CandlestickChart.tsx` | Orchestrator: declares refs, init effect, delegates to 6 hooks. Exposes `setCrosshairPrice()` for dual-chart sync. |
| `frontend/src/components/chart/hooks/useOrderLines.ts` | Orchestrator hook — renders ALL orders (Working + Suspended with dashed style) + phantom bracket lines from `pendingBracketInfo` |
| `frontend/src/components/chart/hooks/usePreviewLines.ts` | Preview line lifecycle: creates/destroys `PriceLevelLine` instances on config change + Zustand price subscription for flicker-free updates |
| `frontend/src/components/chart/hooks/usePreviewDrag.ts` | Preview line drag: handles entry/SL/TP drag for order panel preview lines |
| `frontend/src/components/chart/hooks/useOrderDrag.ts` | Live order drag (Working + Suspended): `orderService.modifyOrder()` with bracket line shift, SL validation, optimistic updates + rollback |
| `frontend/src/components/chart/hooks/usePositionDrag.ts` | Position drag-to-create: drag from position label to place SL/TP orders via `orderService.placeOrder()` |
| `frontend/src/components/chart/hooks/useOverlayLabels.ts` | Configures labels on PriceLevelLine instances via `setLabel()` / `updateSection()`, registers hit targets, runs sync loop |
| `frontend/src/components/chart/hooks/useQuickOrder.ts` | Quick-order + button: hover-preview-only; creates PriceLevelLine instances with baked-in labels for hover preview, no post-placement line tracking |
| `frontend/src/components/chart/hooks/labelUtils.ts` | Shared utilities: `computeOrderLineColor()` (profit/loss color logic), `installSizeButtons()` (hover-reveal +/- DOM factory), `formatSlPnl()`/`formatTpPnl()` (P&L text), `darken()`, shared color constants, drag helpers |
| `frontend/src/components/chart/hooks/resolvePreviewConfig.ts` | `resolvePreviewConfig()` — unified BracketConfig resolver; `fitTpsToOrderSize()` — trims TPs to fit within orderSize |
| `frontend/src/components/order-panel/OrderPanel.tsx` | SignalR event wiring, limit order cancel cleanup, position close auto-cancel |
| `frontend/src/components/order-panel/BuySellButtons.tsx` | Bracket arming, draft/ad-hoc merge, order placement |
| `frontend/src/services/orderService.ts` | placeOrder, cancelOrder, modifyOrder, searchOpenOrders |
| `frontend/src/services/bracketEngine.ts` | Bracket engine (arm/confirm/fill handling) |
| `frontend/src/store/useStore.ts` | Chart trading state, preview state, draft overrides, ad-hoc brackets, pendingBracketInfo (sessionStorage) |

---

## Size Adjustment +/- Buttons

Hover-reveal `−` / `+` buttons on the **size cell** of order labels.

### Implemented

#### Quick-order label (+ button hover)

The quick-order label's size cell shows `−` / `+` on hover to adjust `orderSize` in the store.

```
Normal:      [│ Buy Limit ][ 2 ][ + ]
Size hover:  [│ Buy Limit ][ − 2 + ][ + ]
Text hover:  [│ Buy Limit ][ − 2 + ][ + ]   (buttons visible, size bg not darkened)
```

**Behavior**:
- `prepareSizeButtons()` on wrap enter: injects `−`/count/`+` sub-elements into size cell (hidden)
- `revealSizeButtons()` on size cell `mouseenter`: shows buttons, darkens size bg
- `hideSizeButtons()` on size cell `mouseleave`: hides buttons, restores bg
- Hovering the text cell also reveals buttons (without darkening size bg)
- Min size = 1 (disable `−` via opacity 0.35 + cursor:default)
- `−` / `+` scale to 1.4× on individual hover with 0.15s transition
- Text cell darkens `#cac9cb` → `#b0afb1` on hover
- Size cell darkens `#00c805` → `#00a004` (buy) / `#ff0000` → `#cc0000` (sell)
- `mousedown` with `stopPropagation` prevents order placement clicks

**With preset active**: `+` is disabled (opacity 0.35) when `orderSize >= preset total TP size` — user cannot increase beyond the preset's configured size. `−` reduces `orderSize` and rebuilds preview lines via `createPreviewLines()`, which uses `fitTpsToOrderSize()` to drop the last TP when it no longer fits. Min size = 1 (1 TP with 1 contract). `getPresetMaxSize()` computes the cap from `preset.config.takeProfits`.

**Without preset**: `+` increases freely with no cap; `−` decreases to min 1.

**Files**: `useQuickOrder.ts` (lines ~170–340)

#### Live TP size redistribution (existing, polished)

Existing `−` / `+` buttons on live TP order size cells now have:
- Scale 1.4× on individual `−` / `+` hover (0.15s transition)
- Size cell bg darkens on hover (0.15s transition via `darken()` helper from `labelUtils.ts`)
- Darken persists across label rebuilds when hover is active

**Files**: `buildOrderLabels.ts` (TP size button creation + `onTpSizeHover`), `labelUtils.ts` (`darken()`, `installSizeButtons()`, `computeOrderLineColor()`)

### TODO — future contexts

#### Preview entry line — total order size

Entry label's size cell `−` / `+` to adjust `orderSize` + auto-redistribute TPs.

Redistribution rule: `floor(newSize / numTPs)` per TP, remainder to closest. When removing, take from furthest first, never below 1.

#### Preview TP lines — per-TP manual redistribution

Each TP preview line's size cell `−` / `+` for manual size override. Total stays capped at `orderSize`.

#### Live open orders — direct modify

Any open order gets `−` / `+` on size cell. Calls `orderService.modifyOrder()` with in-flight guard per order.

---

## API Calls

| Action | Proxy Route | ProjectX Endpoint |
|--------|------------|-------------------|
| Place order | POST /orders/place | POST /api/Order/place |
| Cancel order | POST /orders/cancel | POST /api/Order/cancel |
| Modify order | PATCH /orders/modify | POST /api/Order/modify |
| Open orders (for lines) | Zustand (fed by SignalR) | /hubs/user -> GotOrder |
| Search open orders | GET /orders/open?accountId= | POST /api/Order/searchOpen |
