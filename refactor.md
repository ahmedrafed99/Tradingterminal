# Multi-Exchange Integration — Refactoring Plan

Preparation work required before adding Hyperliquid, BitMEX, or any non-ProjectX exchange.

---

## Phase 1 — IDs to Strings ✅

Currently `id`, `accountId`, `orderId` are typed as `number` everywhere. Crypto exchanges use string IDs (hex addresses, UUIDs).

### 1.1 Backend adapter types

**File:** `backend/src/adapters/types.ts`

Change all ID params from `number` to `string`:
- `ExchangeOrders.cancel()` — `accountId: number, orderId: number` → `string`
- `ExchangeOrders.searchOpen(accountId)` — `number` → `string`
- `ExchangeOrders.modify()` — `accountId`, `orderId` → `string`
- `ExchangePositions.searchOpen(accountId)` — `number` → `string`
- `ExchangeTrades.search()` — `accountId` → `string`

### 1.2 Backend route validation

**File:** `backend/src/routes/orderRoutes.ts`

- `PlaceOrderSchema.accountId` — `z.number().int()` → `z.string()`
- `CancelOrderSchema` — both fields → `z.string()`
- `ModifyOrderSchema` — `accountId`, `orderId` → `z.string()`
- `OpenOrdersQuery.accountId` — remove regex, use `z.string()`

Same for `positionRoutes.ts`, `tradeRoutes.ts`, `accountRoutes.ts`.

### 1.3 Frontend canonical types

**File:** `frontend/src/adapters/types.ts`

- `RealtimeOrder.id` — `number` → `string`
- `RealtimeOrder.accountId` — `number` → `string`
- `RealtimePosition.id`, `accountId` — `number` → `string`
- `RealtimeAccount.id` — `number` → `string`
- `RealtimeTrade.id`, `accountId`, `orderId` — `number` → `string`

### 1.4 Frontend services

- `orderService.ts` — `PlaceOrderParams.accountId`, `ModifyOrderParams.accountId/orderId`, `cancelOrder(accountId, orderId)` → `string`
- `positionService.ts` — `searchOpen(accountId)` → `string`
- `tradeService.ts` — `search(accountId)` → `string`

### 1.5 Store slices & components

Grep for `: number` on any field named `accountId`, `orderId`, `id` in position/order contexts. Update types in:
- `store/slices/connectionSlice.ts` (selected account ID)
- `store/slices/tradingSlice.ts`
- Any component that passes these as props

### 1.6 ProjectX adapter — convert at boundary

ProjectX returns numeric IDs. Convert to strings inside the ProjectX adapter (`String(id)`) so the rest of the app never sees numbers. Parse back to numbers when calling ProjectX API endpoints.

---

## Phase 2 — Registry → Multi-Adapter Map ✅

Currently both registries hold exactly one adapter. Need to support simultaneous connections.

### 2.1 Backend registry

**File:** `backend/src/adapters/registry.ts`

```ts
// Before
let currentAdapter: ExchangeAdapter | null = null;
export function getAdapter(): ExchangeAdapter { ... }

// After
const adapters = new Map<string, ExchangeAdapter>();
export function getAdapter(exchangeId: string): ExchangeAdapter { ... }
export function setAdapter(exchangeId: string, adapter: ExchangeAdapter): void { ... }
export function removeAdapter(exchangeId: string): void { ... }
export function listConnected(): string[] { ... }
```

### 2.2 Backend routes — add exchange param

Every route that calls `getAdapter()` needs to know which exchange. Options:
- **Request param**: `/orders/place` body gets `exchange: "projectx"` field
- **URL prefix**: `/exchange/projectx/orders/place` (cleaner, less body pollution)
- **Header**: `X-Exchange: projectx`

Recommendation: URL prefix — mount exchange-specific routes under `/x/:exchangeId/`, keep exchange-agnostic routes (settings, news, health) at root.

```
POST /x/projectx/orders/place
GET  /x/projectx/positions/open?accountId=...
GET  /x/hyperliquid/orders/open?accountId=0x...
```

### 2.3 `withConnection` middleware update

**File:** `backend/src/middleware/withConnection.ts`

Read `req.params.exchangeId`, call `getAdapter(exchangeId)`. Return 404 if exchange not connected.

### 2.4 Frontend registry

**File:** `frontend/src/adapters/registry.ts`

Same pattern — map of `exchangeId → RealtimeAdapter`. Frontend needs to know which adapter to use for the active instrument.

### 2.5 Frontend service layer

`api` calls need the exchange prefix. Either:
- Global active exchange in store → `api` interceptor prepends `/x/${activeExchange}`
- Or pass exchange explicitly per call

---

## Phase 3 — Generic ConnectParams + Adapter Factory ✅

### 3.1 Backend `ConnectParams`

**File:** `backend/src/adapters/types.ts`

```ts
// Before
export interface ConnectParams {
  username: string;
  apiKey: string;
  baseUrl?: string;
}

// After
export interface ConnectParams {
  exchange: string;                    // "projectx" | "hyperliquid" | "bitmex"
  credentials: Record<string, string>; // exchange-specific key/value pairs
  baseUrl?: string;
}
```

Each adapter validates its own required credentials internally.

### 3.2 Adapter factory

**File:** `backend/src/adapters/factory.ts` (new)

```ts
export function createAdapter(exchange: string): ExchangeAdapter {
  switch (exchange) {
    case 'projectx': return createProjectXAdapter();
    case 'hyperliquid': return createHyperliquidAdapter();
    case 'bitmex': return createBitMEXAdapter();
    default: throw new Error(`Unknown exchange: ${exchange}`);
  }
}
```

### 3.3 Auth route — remove hardcoded ProjectX

**File:** `backend/src/routes/authRoutes.ts`

```ts
// Before
const adapter = createProjectXAdapter();

// After
const adapter = createAdapter(body.exchange);
```

### 3.4 Auto-connect generalization

**File:** `backend/src/index.ts`

Replace `TOPSTEP_USERNAME`/`TOPSTEP_PASSWORD` with:
```
AUTO_CONNECT_EXCHANGE=projectx
AUTO_CONNECT_CREDENTIALS={"username":"...","apiKey":"..."}
```

---

## Phase 4 — Make ExchangeRealtime Generic ✅

### 4.1 Current problem

**File:** `backend/src/adapters/types.ts:69-76`

```ts
export interface ExchangeRealtime {
  negotiateMiddleware: ...  // SignalR-specific
  handleUpgrade: ...        // SignalR-specific
}
```

Hyperliquid and BitMEX use raw WebSockets — no negotiate step.

### 4.2 Solution — make optional + add generic WS

```ts
export interface ExchangeRealtime {
  // SignalR-style proxy (ProjectX)
  negotiateMiddleware?: (req, res, next) => void;
  handleUpgrade?: (req, socket, head) => void;

  // Generic WS proxy (crypto exchanges)
  // Returns upstream WS URL for the backend to proxy, or null if
  // the frontend should connect directly (public endpoints).
  getMarketWsUrl?(): string | null;
  getUserWsUrl?(credentials: Record<string, string>): string | null;
}
```

Alternative: crypto adapters may not need backend WS proxy at all (public data, no token injection). Frontend adapter connects directly. Make the entire `realtime` field optional on `ExchangeAdapter`.

### 4.3 Update `index.ts` upgrade handler

Only call `negotiateMiddleware` / `handleUpgrade` if they exist on the active adapter.

---

## Phase 5 — Order Size Validation ✅

### 5.1 Remove `.int()` constraint

**File:** `backend/src/routes/orderRoutes.ts:19`

```ts
// Before
size: z.number().int().positive(),

// After
size: z.number().positive(),
```

Same for `ModifyOrderSchema.size`.

### 5.2 Frontend order entry

Ensure quantity input allows decimals. Check `quantityStep` and `quantityPrecision` from the contract model (already present on the `Contract` type).

---

## Phase 6 — Exchange-Aware UI

### 6.1 Dynamic connection UI

**Files:** `App.tsx`, `SettingsModal.tsx`

- Replace "Connect to TopstepX" with exchange name from store
- Credential form fields change per exchange:
  - ProjectX: username + API key
  - Hyperliquid: wallet private key (or connect via browser wallet)
  - BitMEX: API key + API secret
- Add exchange selector dropdown to connection panel

### 6.2 Instrument selector

**File:** `InstrumentSelectorPopover.tsx`

- Replace hardcoded `exchanges: ['ProjectX']` with dynamic list from connected adapters
- Add category for perpetuals (no expiry) alongside futures
- Show funding rate for perp instruments

### 6.3 Exchange-specific trading controls

New UI elements needed for crypto exchanges (can be added per-adapter):
- Leverage selector (1x–100x)
- Margin mode toggle (cross / isolated)
- Reduce-only checkbox on order entry
- Funding rate display

### 6.4 Realtime adapter initialization

**File:** `frontend/src/services/realtimeService.ts`

Replace hardcoded `createProjectXRealtimeAdapter()` with factory that reads active exchange from store.

---

## Phase 7 — Enum Translation Layer

### 7.1 Current state

**File:** `frontend/src/types/enums.ts`

Canonical enums use ProjectX numeric values (`OrderType.Limit = 1`, `OrderSide.Buy = 0`). These are fine as internal values — no need to change them.

### 7.2 Adapter translation

Each new adapter must translate between its exchange's values and the canonical enums:

```ts
// In hyperliquid adapter
function toCanonicalSide(side: "A" | "B"): OrderSide {
  return side === "B" ? OrderSide.Buy : OrderSide.Sell;
}
```

This already happens naturally in the adapter pattern — just document it as a requirement in the adapter interface.

---

## Completed Refactoring (Previous Work)

### Codebase Cleanup (Phases 1–5 done)

- **Phase 1** — Shared utilities (`formatters.ts`, `barUtils.ts`, `useClickOutside`, `TabButton`, icons, `withConnection` middleware, Zod validation)
- **Phase 2** — Service consolidation (`dedup()`, type name collisions, design tokens, section labels)
- **Phase 3** — Hook decomposition (`useConditionLines` → 7 files, `useOverlayLabels` → 5 files, `useChartDrawings` → 4 files)
- **Phase 4** — Structural (store split → 8 slices, shared `Modal` component, input constants)
- **Phase 5** — Order lines decomposition (`useOrderLines` → 5 focused hooks + shared utility)

### Initial Multi-Exchange Abstraction (done)

- Internal enums & types — replaced raw numeric literals with named enums
- Backend exchange adapter — `ExchangeAdapter` interface, ProjectX implementation in `/adapters/projectx/`
- Frontend realtime adapter — `RealtimeAdapter` interface, SignalR isolated in `/adapters/projectx/`
- Instrument model generalization — `calcPnl()`, `pointsToPrice()`, `ticksPerPoint`, `quantityStep`, `pricePrecision`
