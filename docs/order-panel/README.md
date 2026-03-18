# Feature: Order Panel

Sidebar panel for manually entering orders.
Controls instrument selection, order type, size, bracket configuration,
and the preview toggle that overlays ghost lines on the chart.

- **Position**: Left or right side — toggled via the ↔ swap icon next to the Instrument label. Persisted as `orderPanelSide` (`'left' | 'right'`) in `layoutSlice`, saved to localStorage.
- **Background**: `bg-black`, border toward chart (`border-r` when left, `border-l` when right), width 240px
- All section titles use `SECTION_LABEL` constant from `constants/styles.ts` (`text-[10px] uppercase tracking-wider text-[#787b86]`), centred (`text-center`), with `marginTop: 6` gap between label and content
- All input fields use `bg-[#111] border-[#2a2e39]`, focus: `border-[#1a3a6e]`

---

## UI Layout

```
┌───────────────────────────┐
│  Instrument               │
│  [NQ ▼ (search…)    ]     │
│                           │
│  Order Type               │
│  [ Market ]  [ Limit  ]   │
│                           │
│  Limit Price  (Limit tab) │
│  [  18 420.00          ]  │
│                           │
│  Contracts                │
│  [ ▼ ]  [ 1 ]  [ ▲ ]     │
│                           │
│  Bracket Settings  ⚙      │
│  SL: 20 ticks             │
│  TP1: 30 ticks            │
│  TP2: 60 ticks            │
│                           │
│  [ Preview ]  ☐           │
│                           │
│  [  Buy +1 Market  ]      │  (dark green)
│  [  Sell -1 Market ]      │  (dark red)
│                           │
│                           │
│  ── Position ─────────    │
│  Long  2 ct               │
│  P&L   +$140.00           │
└───────────────────────────┘
```

---

## Sub-Components

### `InstrumentSelector`
- Searchable dropdown backed by `/api/Contract/search`
- Typing debounces 300 ms then fetches matching contracts
- Shows contract name + description in options
- Uses `fixed` prop to bind to `orderContract`
- When linked to a chart, selecting an instrument here also updates the linked chart's contract
- Selection is persisted across refreshes (both localStorage and backend file)
- On change: chart reloads bars for the new contract

### `LinkChartButton`
- Chain-link icon positioned absolutely in the upper-right corner of the Instrument section (`top: -2, right: -4`)
- Toggles `orderLinkedToChart` between `null` and the currently selected chart (`'left'` | `'right'`)
- When active for the selected chart: orange (`#f0a830`); otherwise dim (`#787b86`)
- Smooth stroke color transition (`transition: stroke 0.2s ease`) for a polished toggle effect
- Same SVG icon for both states — color-only toggle
- Bidirectional sync: chart→order panel (via `useEffect`) and order panel→chart (via `setLinkedChartContract` in `InstrumentSelector`)

### `OrderTypeTabs`
- Two tabs: **Market** | **Limit**
- Selected tab: `bg-[#c8891a] text-black font-medium` (orange accent), unselected: `bg-[#111] text-[#787b86]`
- Limit tab reveals a `LimitPriceInput` (number field, respects tick size) with `marginTop: 20px` gap

### `ContractsSpinner`
- Integer input with circular `rounded-full` +/− buttons (`w-7 h-7`), min = 1
- Button text: `text-base font-medium text-(--color-text)`, uses proper minus sign `−`
- Value stored as `orderSize` in Zustand

### `BracketSummary`
- Preset dropdown (no chevron arrow) + read-only config summary (SL, TPs, conditions)
- Dropdown styled like timeframe selector: `bg-black border-(--color-border) rounded-lg`, items `rounded-md`, selected item `text-(--color-warning) bg-(--color-hover-row)`, hover `bg-(--color-hover-row)`
- SL values: `text-(--color-btn-sell-hover)` (draft: `text-(--color-sell)`), TP values: `text-(--color-btn-buy-hover)` (draft: `text-(--color-buy)`), conditions: `text-(--color-accent-text)`
- Plus icon opens new preset; hover reveals edit (pencil) and delete (trash) icons per preset
- Delete button: `hover:text-(--color-error)`, auto-deselects if deleting the active preset
- **Suspended state**: When a position is open (`suspendPreset` sets `activePresetId` to null and stores the previous id in `suspendedPresetId`), the config summary remains visible but dimmed (`opacity-35`, `pointer-events-none`) to prevent layout shift. The dropdown still shows the suspended preset name. When the position closes, `restorePreset` re-activates the preset and the summary returns to full opacity.

### `PreviewCheckbox`
- Toggles `previewEnabled` in Zustand
- When enabled the `PreviewOverlay` in the chart renders ghost lines

### `BuySellButtons`
- **Buy** (`bg-(--color-btn-buy)`, hover `bg-(--color-btn-buy-hover)`): label `Buy +{size} {Market|Limit}`
- **Sell** (`bg-(--color-btn-sell)`, hover `bg-(--color-btn-sell-hover)`): label `Sell -{size} {Market|Limit}`
- `text-[11px] font-bold text-(--color-text)`, side-by-side layout
- Both use `activeAccountId`, `activeContractId`, `orderSize`, and the active
  bracket configuration from the store
- Buttons disabled when: not connected, no instrument selected, **or market is closed**
- **Market-closed state**: `useMarketStatus()` (1 s reactive hook) drives `canPlace`. When closed, buttons are `disabled:opacity-50` and a full-width amber banner appears below (12px gap): warning icon + "Market closed — reopens Sun 18:00 ET", styled with `text-(--color-warning)` on a subtle `color-mix(in srgb, var(--color-warning) 8%, transparent)` background. A second `isFuturesMarketOpen()` call inside `handlePlace` guards against the race where the hook value is stale at click time.
- On placement failure: shows error toast alongside inline error text

### `PositionDisplay`
- Shows current net position for the active account + instrument
- Net size and unrealised P&L from SignalR positions feed (both centred)
- **Position lookup** filters by both `activeAccountId` and `contractId` (with `String()` coercion — SignalR may send contractId as number while REST API returns string)
- **Close** button: market order to flatten position, always visible when position exists. Shows error toast on failure.
- **SL to BE** button: always visible when a position exists, disabled when not in profit. Shows error toast on failure. Three paths:
  1. **Bracket session active**: delegates to `bracketEngine.moveSLToBreakeven()` (modifies tracked SL order)
  2. **Existing SL order found** (stop type 4/5 on same contract): modifies it to entry price via `orderService.modifyOrder()`
  3. **No SL exists** (naked position): places a new stop order at entry price via `orderService.placeOrder()` (sell stop for long, buy stop for short)
- Button styling matches Buy/Sell: `py-2.5 text-[11px] font-bold`, outlined variant (`border-(--color-hover-toolbar)`)

---

## State (Zustand)

Order-panel trading state lives in `tradingSlice`. Panel position state (`orderPanelSide`) lives in `layoutSlice`. See `docs/frontend/` for the full slice breakdown.

```ts
interface OrderPanelState {
  orderContract: Contract | null
  orderLinkedToChart: 'left' | 'right' | null  // which chart is linked (null = independent)
  orderType: 'market' | 'limit'
  limitPrice: number | null
  orderSize: number                   // contracts
  previewEnabled: boolean
  previewSide: OrderSide              // Long / Short for preview lines
  previewHideEntry: boolean           // true when limit order placed with preview
  bracketPresets: BracketPreset[]
  activePresetId: string | null
  suspendedPresetId: string | null    // preset suspended while position is open
  lastPrice: number | null

  // Draft overrides (ephemeral — for preview line dragging)
  draftSlPoints: number | null
  draftTpPoints: (number | null)[]
  setDraftSlPoints: (p: number | null) => void
  setDraftTpPoints: (idx: number, p: number | null) => void
  clearDraftOverrides: () => void

  // Ad-hoc brackets (no preset selected — +SL/+TP from entry label)
  adHocSlPoints: number | null
  adHocTpLevels: { points: number; size: number }[]
  setAdHocSlPoints: (p: number | null) => void
  addAdHocTp: (points: number, size: number) => void
  removeAdHocTp: (index: number) => void
  updateAdHocTpPoints: (index: number, points: number) => void
  clearAdHocBrackets: () => void

  // Quick Order pending preview (tracks SL/TP while entry is pending fill)
  qoPendingPreview: {
    entryPrice: number; slPrice: number | null;
    tpPrices: number[]; side: OrderSide;
    orderSize: number; tpSizes: number[];
  } | null
  setQoPendingPreview: (preview: ...) => void

  // Actions
  setOrderContract: (contract: Contract) => void
  setOrderType: (t: 'market' | 'limit') => void
  setLimitPrice: (p: number | null) => void
  setOrderSize: (n: number) => void
  togglePreview: () => void
  setPreviewSide: (side: OrderSide) => void
  setActivePresetId: (id: string | null) => void
  suspendPreset: () => void
  restorePreset: () => void
  savePreset: (preset: BracketPreset) => void
  deletePreset: (id: string) => void
  setLastPrice: (p: number | null) => void
}
```

---

## Order Placement Flow

```
User clicks BUY
  └─► client-side guard: isFuturesMarketOpen() → toast + return if closed
  └─► build payload:
        { accountId, contractId, type: 2 (market) or 1 (limit),
          side: 0 (Bid), size, limitPrice? }
  └─► buildNativeBracketParams(config, side, contract)
        ├─► <= 1 TP: returns { stopLossBracket?, takeProfitBracket? }
        │     └─► merged into payload (atomic gateway placement)
        └─► 2+ TPs: returns null
              └─► Arm bracket engine BEFORE HTTP call (buffers early fills)
  └─► POST /proxy/orders/place
  └─► response: { orderId }  (assertSuccess checks gateway success field)
  └─► If 2+ TP path: confirm orderId with bracket engine
  └─► SignalR GotOrder event → updates open orders in store
  └─► On failure → error toast shown, bracket engine disarmed if armed
```

**Native brackets** (0-1 TP): SL and TP are attached atomically to the entry order via gateway-native bracket params. Requires "Auto OCO Brackets" enabled on the account. Gateway handles OCO (SL fill cancels TP, and vice versa).

**Client-side brackets** (2+ TPs): SL + TPs placed as separate orders after entry fill via `BracketEngine`.

**Position close cleanup**: `bracketEngine.clearSession()` returns the set of order IDs it's already cancelling. The subsequent `searchOpenOrders` cleanup pass skips those IDs to avoid double-cancel warning toasts.

**Reconnect resync**: On user hub reconnect, `OrderPanel` re-fetches open orders via `searchOpenOrders()` and replaces the store. This recovers from events missed during the disconnect window.

**Position inference trades**: `inferPositionsFromOrders` reads `sessionTrades` from the store (loaded by `App.tsx`) instead of making its own `searchTrades` API call.

**Last price seed optimization**: The `lastPrice` bars seed is skipped when the chart has the same contract loaded — the chart's quote subscription fills `lastPrice` almost immediately, making the extra bars fetch redundant. The seed only fires when the order panel contract differs from the chart contract.

---

## SignalR Order Event Handler — Bracket Leg Handling

`OrderPanel.tsx` processes every `GotOrder` SignalR event and applies special handling for native bracket legs (SL/TP orders placed atomically alongside the entry via `stopLossBracket`/`takeProfitBracket`).

### Bracket leg detection

Bracket legs are identified by the presence of `order.customTag`:
- **Bracket leg**: `order.customTag` is a non-empty string (e.g. `AutoBracket{guid}-SL` or `AutoBracket{guid}-TP`)
- **Regular order**: `order.customTag` is `undefined` or `null`

All special handling below keys on this distinction.

### REST refresh guard

After any Working (status=1) order event, a 1.5-second delayed `searchOpenOrders` REST call fires to hydrate the store with externally-placed orders that weren't seen via SignalR.

This guard fires **only for `!order.customTag`** (regular Working orders). Bracket legs skip the REST refresh for two reasons:

1. While Suspended (status=8), bracket legs do not appear in `searchOpenOrders` at all — the endpoint only returns Working orders.
2. After transition to Working (post-fill), `searchOpenOrders` returns orders at their gateway-activated prices (the original bracket tick offset), which would overwrite the desired dragged prices stored in `qoPendingPreview`. The post-fill correction block handles price accuracy for bracket legs instead.

### Post-fill price correction

> **⚠ WARNING — Gateway limitation**: The ProjectX gateway activates SL/TP bracket legs at the original tick offset defined at placement time, regardless of any `modifyOrder` calls made while they were Suspended (status=8). The post-fill correction block in this handler is the only reliable way to apply user-adjusted prices to native bracket orders. Do not remove this block.

When `order.status === OrderStatus.Working && order.customTag`, the handler executes the post-fill correction:

1. Reads `qoPendingPreview` and `activeAccountId` from the store.
2. For an `-SL` bracket leg: compares `order.stopPrice` against `qoPendingPreview.slPrice`. If they differ by more than 0.001, calls `orderService.modifyOrder()` with `stopPrice: qo.slPrice` and calls `upsertOrder()` optimistically with the desired price, then returns early.
3. For a `-TP` bracket leg: compares `order.limitPrice` against `qoPendingPreview.tpPrices[0]`. If they differ by more than 0.001, calls `orderService.modifyOrder()` with `limitPrice: qo.tpPrices[0]` and calls `upsertOrder()` optimistically with the desired price, then returns early.

The early return skips the normal `upsertOrder` path that would write the wrong gateway-activated price into the store. The optimistic update ensures the chart and orders tab show the user's intended price immediately while the `modifyOrder` API call is in flight.

The correction fires exactly once per bracket leg at the moment it transitions to Working — this is the earliest the gateway will honor a `modifyOrder` call, and also the only window before the UI reflects the (incorrect) gateway price.

---

## Limit Order Cancel Cleanup

When a limit order is placed with preview enabled (`previewHideEntry: true`), the SL/TP preview lines remain visible while the order is pending. If the order is cancelled (status 3/4/5):

```
SignalR GotOrder (status = cancelled)
  └─► if previewHideEntry && contractId matches orderContract
        └─► bracketEngine.clearSession()
        └─► clearAdHocBrackets()
        └─► set previewEnabled = false, previewHideEntry = false
```

This cleanup runs in `OrderPanel.tsx`'s order event handler.

---

## API Calls

| Action | Proxy Route | ProjectX Endpoint |
|--------|------------|-------------------|
| Search contracts | GET /contracts/search?q= | POST /api/Contract/search |
| Place order | POST /orders/place | POST /api/Order/place |
| Real-time positions | SignalR user feed | /hubs/user → GotPosition |
