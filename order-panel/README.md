# Feature: Order Panel

Left sidebar panel for manually entering orders.
Controls instrument selection, order type, size, bracket configuration,
and the preview toggle that overlays ghost lines on the chart.

- **Background**: `bg-black`, border right `border-[#2a2e39]`, width 240px
- All section titles are centred (`text-center`), `text-[10px] text-[#787b86] uppercase tracking-wider`
- All input fields use `bg-[#111] border-[#222]`, focus: `border-[#1a3a6e]`

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
- Uses `fixed` prop to bind to `orderContract` (independent of chart selection)
- On change: chart reloads bars for the new contract

### `OrderTypeTabs`
- Two tabs: **Market** | **Limit**
- Selected tab: `bg-[#c8891a] text-black font-medium` (orange accent), unselected: `bg-[#111] text-[#787b86]`
- Limit tab reveals a `LimitPriceInput` (number field, respects tick size) with `marginTop: 20px` gap

### `ContractsSpinner`
- Integer input with circular `rounded-full` +/− buttons (`w-7 h-7`), min = 1
- Button text: `text-base font-medium text-[#d1d4dc]`, uses proper minus sign `−`
- Value stored as `orderSize` in Zustand

### `BracketSummary`
- Preset dropdown (no chevron arrow) + read-only config summary (SL, TPs, conditions)
- Dropdown styled like timeframe selector: `bg-black border-[#2a2e39] rounded-lg`, items `rounded-md`, selected item `text-[#f0a830] bg-[#1e222d]`, hover `bg-[#1e222d]`
- SL values: `text-[#a62a3d]` (draft: `text-[#c4475a]`), TP values: `text-[#22835b]` (draft: `text-[#3aa876]`), conditions: `text-[#4a80b0]`
- Plus icon opens new preset, edit icon (visible on hover) opens `BracketSettingsModal`

### `PreviewCheckbox`
- Toggles `previewEnabled` in Zustand
- When enabled the `PreviewOverlay` in the chart renders ghost lines

### `BuySellButtons`
- **Buy** (`bg-[#1b6b4a]`, hover `#22835b`): label `Buy +{size} {Market|Limit}`
- **Sell** (`bg-[#8b2232]`, hover `#a62a3d`): label `Sell -{size} {Market|Limit}`
- `text-[11px] font-bold text-[#d1d4dc]`, side-by-side layout
- Both use `activeAccountId`, `activeContractId`, `orderSize`, and the active
  bracket configuration from the store
- Buttons disabled when not connected or no instrument selected
- On placement failure: shows error toast alongside inline error text

### `PositionDisplay`
- Shows current net position for the active account + instrument
- Net size and unrealised P&L from SignalR positions feed (both centred)
- **contractId comparison** uses `String()` coercion — SignalR may send contractId as number while REST API returns string
- **Close** button: market order to flatten position, always visible when position exists. Shows error toast on failure.
- **SL to BE** button: always visible when a position exists, disabled when not in profit. Shows error toast on failure. Three paths:
  1. **Bracket session active**: delegates to `bracketEngine.moveSLToBreakeven()` (modifies tracked SL order)
  2. **Existing SL order found** (stop type 4/5 on same contract): modifies it to entry price via `orderService.modifyOrder()`
  3. **No SL exists** (naked position): places a new stop order at entry price via `orderService.placeOrder()` (sell stop for long, buy stop for short)
- Button styling matches Buy/Sell: `py-2.5 text-[11px] font-bold`, outlined variant (`border-[#363a45]`)

---

## State (Zustand)

```ts
interface OrderPanelState {
  orderContract: Contract | null      // independent from chart contract
  orderType: 'market' | 'limit'
  limitPrice: number | null
  orderSize: number                   // contracts
  previewEnabled: boolean
  previewSide: 0 | 1                  // Long / Short for preview lines
  previewHideEntry: boolean           // true when limit order placed with preview
  bracketPresets: BracketPreset[]
  activePresetId: string | null
  setOrderContract: (contract: Contract) => void
  setOrderType: (t: OrderType) => void
  setLimitPrice: (p: number) => void
  setOrderSize: (n: number) => void
  togglePreview: () => void
}
```

---

## Order Placement Flow

```
User clicks BUY
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
