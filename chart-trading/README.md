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

- **"+" button**: 20x20px, `background: #2a2e39`, `borderRadius: 2px`, text `#d1d4dc`
- **"+" hover state**: `background: #434651`, border radius changes to `0 2px 2px 0` (rounds only right side)
- **Label (buy)**: `background: #00c805`, `color: #000`
- **Label (sell)**: `background: #ff0000`, `color: #fff`
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
  if (!param.point) { /* hide with delay */ return; }

  const rawPrice = series.coordinateToPrice(param.point.y);
  const lastP = useStore.getState().lastPrice ?? lastBarRef.current?.close;

  snappedPrice = Math.round(rawPrice / contract.tickSize) * contract.tickSize;
  isBuy = lastP != null ? snappedPrice < lastP : true;

  el.style.display = 'flex';
  el.style.top = `${param.point.y}px`;
  el.style.right = `${chart.priceScale('right').width()}px`;
};
```

- **Price snapping**: rounds to the nearest tick size for valid order placement
- **Direction**: compares snapped price to market price (`lastPrice` from real-time, falls back to `lastBarRef.current.close` from historical data)
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

**On hover** — `createPreviewLines()` draws temporary dashed price lines + `createHoverLabels()` adds HTML overlay labels:
- Entry reference line (`#787b86` gray dashed)
- SL line (`#ff444480` red dashed) + overlay label with projected P&L (red)
- TP lines (`#00c805` green dashed) + overlay labels with projected P&L (green)

Price offsets computed via `points * tickSize * TICKS_PER_POINT`, same formula as the main preview system.

Overlay labels use the same `buildRow()` helper and styling as the main preview/order overlay labels: monospace 11px bold, positioned at `left:50%` with `transform: translate(-50%,-50%)`, Y from `series.priceToCoordinate(price)`.

**On leave** — `removePreviewLines()` + `removeHoverLabels()` tears down all temporary lines and labels.

**On click** — if a preset is active with SL/TP points >= 1:
1. Arms the bracket engine
2. Sets `qoPendingPreview` in the store with computed prices/sizes
3. Removes hover labels (permanent ones take over via overlay label effect)
4. Places the limit order
5. Subscribes to store for fill/cancel detection

```ts
bracketEngine.armForEntry({
  accountId, contractId, entrySide: side,
  entrySize: st.orderSize, config: bc, tickSize,
});

st.setQoPendingPreview({
  entryPrice, slPrice, tpPrices, side, orderSize, tpSizes,
});

const { orderId } = await orderService.placeOrder({ ... });
bracketEngine.confirmEntryOrderId(orderId);
```

The bracket engine then listens for the entry fill event and places SL + TP orders automatically.

**On error** — full cleanup: disarms bracket engine (`clearSession()`), clears `qoPendingPreview`, removes preview lines and hover labels, shows error toast.

**No preset selected** — places a naked limit order with no SL/TP.

### Click -> place limit order

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

Always visible (regardless of preview toggle):

- **Position entry**: solid grey `#cac8cb` at `averagePrice`
- **Order colors are profit/loss-based** when a position exists: green `#00c805` if the order price is in profit territory relative to position entry, red `#ff0000` if in loss territory. This means an SL moved above entry (long) turns green, and a TP is always green.
- **Without a position**: stop orders default to red, limit orders use side-based coloring (sell=red, buy=green)
- **Line color updates during drag**: as an order is dragged across the entry price, the line color flips between green and red in real-time
- Each line tracks its `Order` object via `orderLineMetaRef` for drag identification

### OrderLineLayer

- Reads open orders from Zustand store (kept fresh by SignalR)
- For each open order, renders a Lightweight Charts `ISeriesApi` price line:
  - Label: `#{orderId}  {size}ct  @{price}`
  - Colour: green for buy-side, red for sell-side; dashed for TP/SL
  - Right-click or X icon button -> calls `orderService.cancelOrder()`
  - Drag (mousedown + mousemove + mouseup on the line) -> calls
    `orderService.modifyOrder()` with the new price on mouseup
- **Label styling**: all text is black (`#000`), cells separated by `1px solid #000` border
- Order lines are removed from the chart series when the corresponding order
  is no longer in the open-orders list (detected via SignalR)

---

## Preview Overlay

Rendered when `previewEnabled = true` (set from OrderPanel checkbox):
- Entry line always shown when preview is on (even with no preset)
- SL/TP lines shown when a bracket preset is active **or** ad-hoc SL/TP have been added
- Dashed price lines for Entry (grey `#787b86`), SL (semi-transparent red `#ff444480`), each TP (solid green `#00c805`)
- `resolvePreviewConfig()` helper unifies preset+draft and ad-hoc state into a single `BracketConfig`
- Two-effect pattern: structural effect creates/destroys lines on config change; price-update effect calls `applyOptions()` in-place to avoid flicker
- Initial prices read imperatively via `useStore.getState()` to avoid flash-at-bottom on first toggle

Shows ghost price lines (semi-transparent) for:
  - **Entry** at the last price or current limit price
  - **SL** at `entry +/- stopLossTicks * tickSize`
  - **TP1..TPN** at respective offsets
- Lines update live as bracket settings change

---

## Overlay Label System

HTML labels positioned over price lines. Imperative DOM (`document.createElement`) — avoids React render cycles for smooth 60fps updates.

Each label is a row of colored cells: `[P&L or label] [size] [X]`

**All overlay labels use `pointer-events: none`** — mouse events pass through to the LWC canvas so the crosshair stays visible when hovering over any label. Interactions (click, drag) are detected via coordinate-based hit testing at the chart container level using `getBoundingClientRect()`.

### Hit-target registry

Each interactive element (button cell, draggable row) is registered in `hitTargetsRef` with a priority:

| Priority | Target | Action |
|----------|--------|--------|
| 0 | Button cells (close-X, +SL, +TP) | Click — fires immediately |
| 1 | Entry label firstCell | Click-vs-drag — stores downX/downY, checked on mouseup (< 4px = click) |
| 1 | Order row drag | Drag — starts order drag state (higher priority than position to win when overlapping, e.g. SL at breakeven) |
| 2 | Position / preview row drag | Drag — starts position or preview drag state |

A container-level `mousedown` handler (`onOverlayHitTest`) iterates sorted hit targets, checks `getBoundingClientRect()` vs mouse coordinates, skips hidden elements (`el.offsetParent === null`), and fires the first match. The `onHandleHover` mousemove handler also checks hit targets to show `cursor: pointer` when hovering over interactive areas.

### Position label
- Real-time P&L (green/red), contract size, X to close position (market order)
- Drag-to-create: mousedown on position label starts a drag — dragging in the loss direction creates a stop order (full position size), dragging in the profit direction creates a limit TP order (1 contract per drag)

### Order labels
- **P&L cell**: colored by profit/loss relative to position — green if order is in profit territory, red if in loss. Updates dynamically during drag as the price crosses the entry.
- **Size cell**: colored by order side — sell = red `#ff0000`, buy = green `#00c805`. Stays constant regardless of order position (reflects that it's a market sell/buy order).
- When no position exists, label shows "SL"/"Buy Limit"/"Sell Limit" in grey (`#cac9cb`) with black text
- X to cancel order

### Preview labels
- Entry shows "Limit Buy"/"Limit Sell" in grey (`#cac9cb`) with black text (clickable to execute), size cell colored by side (green buy / red sell)
- SL/TP show projected P&L relative to entry price
- Each TP shows its **individual** contract size from the preset or ad-hoc level (not total orderSize). SL shows total size
- When no preset is active, entry label includes **+SL** and **+TP** buttons to add ad-hoc bracket lines

### Real-time P&L updates
- P&L values update in real-time via direct Zustand subscription (bypasses React render cycle)
- `updateOverlayRef` stores the position-update function, called by the sync effect

---

## Overlay Sync

Smooth label positioning during interaction:

- `requestAnimationFrame` loop runs during any pointer interaction (pointerdown -> rAF loop -> pointerup stops)
- Also listens to `visibleLogicalRangeChange` (horizontal scroll), `ResizeObserver`, and `wheel` events
- Zero overhead when idle — rAF loop only active during pointer drag

---

## Label-Initiated Drag

Click label to edit price:

- All labels are `pointer-events: none` — interaction is detected by the container-level `onOverlayHitTest` handler via coordinate hit testing
- `onOverlayHitTest` fires the registered drag handler, which sets shared drag state refs (`previewDragStateRef` or `orderDragStateRef`)
- `mousemove` / `mouseup` listeners on `window` handle the drag (works even when mouse leaves the label)
- Cursor switches to `grabbing` during drag, resets to `pointer` on release
- Close-X buttons are registered as priority-0 hit targets, so they fire before row drag (priority 2)
- **Crosshair stays visible during drag**: drag mousemove handlers do NOT call `stopPropagation()`, allowing LWC to see mouse events. Instead, `chartRef.applyOptions({ handleScroll: false, handleScale: false })` is set on drag start to prevent chart panning, and re-enabled on mouseup.

### Preview drag
- Entry -> sets `orderType: 'limit'` + `limitPrice`
- SL/TP -> writes to `draftSlPoints` / `draftTpPoints` (preset mode) or `adHocSlPoints` / `updateAdHocTpPoints` (ad-hoc mode)

### Order drag
- On mouse up calls `orderService.modifyOrder()` with new `stopPrice` or `limitPrice`

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

---

## Quick-Order Pending Preview

After placing via the + button with brackets armed, SL/TP preview lines and labels persist until the entry fills:

### Persistent preview after order placement

Two mechanisms keep the preview visible:

1. **Chart price lines** (`qoPreviewLines`): kept alive by skipping `removePreviewLines()` on click/leave when `pendingFillUnsub` is set.

2. **Overlay labels** (`qoPendingPreview` in store): the overlay label effect reads this state and creates HTML labels (same style as main preview labels) for SL and TP lines. Labels show projected P&L and size.

A Zustand `subscribe()` watches for the entry order to fill (status 2) or cancel (status 3):

```ts
pendingFillUnsub = useStore.subscribe((state) => {
  const o = state.openOrders.find((ord) => ord.id === orderId);
  if (!o || o.status === 2 || o.status === 3) {
    pendingFillUnsub?.();        // unsubscribe FIRST (prevents recursive re-entry)
    pendingFillUnsub = null;
    removePreviewLines();
    setQoPendingPreview(null);   // clears overlay labels
  }
});
```

**Important**: The unsubscribe must happen *before* `setQoPendingPreview(null)` — otherwise the store update re-triggers the subscriber (still subscribed), causing `Maximum call stack size exceeded`.

Each label has an independent X cancel button — cancelling a single TP/SL removes only that line and updates the bracket engine's armed config via `bracketEngine.updateArmedConfig()`. A no-op `pendingFillUnsub` placeholder is set synchronously before the async `placeOrder` call so that `onLeave` does not prematurely remove preview lines.

### Quick-order pending preview drag

SL/TP labels from the + button pending preview are draggable (same pattern as order panel preview lines). Drag uses `qoPreviewPricesRef` for flicker-free movement; on mouseup the new price is committed to `qoPendingPreview` store state and `bracketEngine.updateArmedConfig()` so the actual bracket orders use the adjusted prices when the entry fills.

### Store state

`qoPendingPreview` in `useStore`:
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

Set on click (with brackets), cleared on fill/cancel/effect cleanup. The overlay label effect includes `qoPendingPreview` in its dependency array so labels rebuild automatically.

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
- Entry label shows `[Limit Buy] [1] [+SL] [+TP] [X]`
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
  qoPendingPreview: { ... } | null
}
```

---

## Files

| File | Role |
|------|------|
| `frontend/src/components/chart/CandlestickChart.tsx` | All chart-trading interactions: order/position/preview line effects, overlay label system, rAF sync, label-initiated drag, position drag-to-create, + button effect |
| `frontend/src/components/order-panel/OrderPanel.tsx` | SignalR event wiring, limit order cancel cleanup, position close auto-cancel |
| `frontend/src/components/order-panel/BuySellButtons.tsx` | Bracket arming, draft/ad-hoc merge, order placement |
| `frontend/src/services/orderService.ts` | placeOrder, cancelOrder, modifyOrder, searchOpenOrders |
| `frontend/src/services/bracketEngine.ts` | Bracket engine (arm/confirm/fill handling) |
| `frontend/src/store/useStore.ts` | Chart trading state, preview state, draft overrides, ad-hoc brackets, qoPendingPreview |

---

## API Calls

| Action | Proxy Route | ProjectX Endpoint |
|--------|------------|-------------------|
| Place order | POST /orders/place | POST /api/Order/place |
| Cancel order | POST /orders/cancel | POST /api/Order/cancel |
| Modify order | PATCH /orders/modify | POST /api/Order/modify |
| Open orders (for lines) | Zustand (fed by SignalR) | /hubs/user -> GotOrder |
| Search open orders | GET /orders/open?accountId= | POST /api/Order/searchOpen |
