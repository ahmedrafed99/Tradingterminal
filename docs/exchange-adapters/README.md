# Exchange Adapter Architecture

## Overview

The trading terminal supports multiple exchanges through an **adapter pattern**. Both the backend and frontend define exchange-agnostic interfaces; each exchange provides its own implementation. Routes and UI components never reference exchange-specific code directly — they call the adapter layer, which dispatches to whichever exchange is active.

---

## Backend Adapter Pattern

### Interface (`backend/src/adapters/types.ts`)

Every exchange implements `ExchangeAdapter`:

```ts
interface ExchangeAdapter {
  readonly name: string;           // 'projectx' | 'hyperliquid'
  readonly auth: ExchangeAuth;     // connect, disconnect, isConnected, getStatus
  readonly accounts: ExchangeAccounts;   // list()
  readonly marketData: ExchangeMarketData; // retrieveBars, searchContracts, etc.
  readonly orders: ExchangeOrders;       // place, cancel, modify, searchOpen
  readonly positions: ExchangePositions; // searchOpen
  readonly trades: ExchangeTrades;       // search
  readonly realtime?: ExchangeRealtime;  // SignalR or WebSocket proxy
}
```

### Registry (`backend/src/adapters/registry.ts`)

Stores connected adapters by ID. Supports multiple simultaneous connections:

- `setAdapter(exchangeId, adapter)` — register after successful auth
- `getAdapter(exchangeId?)` — retrieve by ID, or the default
- `setDefaultExchangeId(id)` / `getDefaultExchangeId()`
- `listConnected()` — all active exchange IDs

### Order Placement Contract (`PlaceOrderParams`)

`ExchangeOrders.place()` accepts a typed `PlaceOrderParams` (defined in `adapters/types.ts`):

```ts
interface PlaceOrderParams {
  accountId: string;
  contractId: string;
  type: OrderType;
  side: OrderSide;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLossBracket?: BracketParam;
  takeProfitBrackets?: BracketParam[];  // always an array; adapters convert to exchange format
}

type BracketParam =
  | { ticks: number; type: number }    // ProjectX — tick offsets from entry
  | { price: number; size?: number };  // Hyperliquid — absolute prices
```

**Adapter responsibility:** each adapter must convert `takeProfitBrackets` (array) to its gateway's native format at the adapter boundary:

- **ProjectX**: gateway expects singular `takeProfitBracket` (object) — adapter takes `[0]`
- **Hyperliquid**: gateway accepts multiple legs natively — adapter passes the array through

> **Regression rule:** when adding a new exchange or renaming bracket fields in `PlaceOrderParams`, update the Zod schema in `orderRoutes.ts` and the frontend `PlaceOrderParams` in `orderService.ts` in the same commit. The `validateBody` middleware logs a warning when it strips unknown fields — that warning is a signal that the frontend and backend schemas have diverged.

### Factory (`backend/src/adapters/factory.ts`)

Maps exchange names to factory functions:

```ts
const factories = {
  projectx: createProjectXAdapter,
  hyperliquid: createHyperliquidAdapter,
};
```

`createAdapter(exchange)` instantiates the right adapter.

### Realtime Mode

`ExchangeRealtime` currently supports the **SignalR proxy** pattern only:

```ts
interface ExchangeRealtime {
  negotiateMiddleware: (req: Request, res: Response, next: NextFunction) => void;
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}
```

Hyperliquid uses a native WebSocket (not SignalR). The `ExchangeRealtime` interface exposes `handleUpgrade` — for HL this proxies to `wss://api.hyperliquid[-testnet].xyz/ws` instead of a SignalR hub. The frontend needs a matching `HyperliquidRealtimeAdapter` (not yet wired) to consume `/ws/hl` events.

---

## Frontend Adapter Pattern

### Interface (`frontend/src/adapters/types.ts`)

Every exchange implements `RealtimeAdapter`:

```ts
interface RealtimeAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  subscribeQuotes(contractId: string): void;
  unsubscribeQuotes(contractId: string): void;
  subscribeDepth(contractId: string): void;
  unsubscribeDepth(contractId: string): void;
  subscribeUserEvents(accountId: string): void;
  onQuote(handler): void;       // + off variants for all
  onDepth(handler): void;
  onOrder(handler): void;
  onPosition(handler): void;
  onAccount(handler): void;
  onTrade(handler): void;
  ping(): Promise<number>;
}
```

### Canonical Types

All adapters normalize data into exchange-agnostic shapes:

- `Quote` — last price, bid/ask, change, volume
- `DepthEntry` — price, volume, type (bid/ask)
- `RealtimeOrder` — id, status, type, side, size, prices
- `RealtimePosition` — id, contractId, size, averagePrice
- `RealtimeAccount` — id, balance, canTrade
- `RealtimeTrade` — id, price, side, size, fees

### Registry + Service

- `frontend/src/adapters/registry.ts` — `get/setRealtimeAdapter()`, `clearRealtimeAdapter()`
- `frontend/src/services/realtimeService.ts` — delegating facade; all consumers import this, never the adapter directly

`switchAdapter(exchange)` does not exist yet — it is part of the Hyperliquid re-integration plan. Currently only `projectx` is wired.

---

## Exchange Metadata (planned)

`exchangeMeta.ts` does not exist yet — it is part of the Hyperliquid re-integration plan. When added, each exchange will declare metadata used by the UI:

```ts
interface ExchangeMeta {
  id: string;
  displayName: string;
  category: 'futures' | 'crypto';
  is24h: boolean;
  defaultSymbol: string;
  quantityType: 'integer' | 'decimal';
  currencySymbol: string;
  credentialFields: { key: string; label: string; type: string }[];
  instrumentCategories: Record<string, {
    defaultFilter: string | null;
    filters: string[];
  }>;
}
```

This will drive:
- Which instrument selector categories are enabled
- Sub-filter tabs within each category
- Credential form fields in Settings
- Market hours behavior (24/7 vs scheduled)
- Currency symbol and quantity type in the order panel

---

## Adding a New Exchange

1. **Create adapter folder**: `backend/src/adapters/<exchange>/`
2. **Implement all sub-interfaces**: auth, accounts, marketData, orders, positions, trades, realtime
3. **Create factory function**: `create<Exchange>Adapter()` in `index.ts`
4. **Register in factory**: Add to `factories` map in `backend/src/adapters/factory.ts`
5. **Add exchange metadata**: Register in `exchangeMeta.ts`
6. **Create frontend adapter**: `frontend/src/adapters/<exchange>/realtimeAdapter.ts` implementing `RealtimeAdapter`
7. **Register in `switchAdapter()`**: Add case in `realtimeService.ts`
8. **Document**: Add `docs/crypto/<exchange>/README.md` (or `docs/futures/` if applicable)

---

## Current Exchanges

| Exchange | Status | Category | Realtime Mode | Auth Method |
|----------|--------|----------|--------------|-------------|
| [ProjectX](projectx.md) | ✅ Live | Futures | SignalR proxy | API key + username → JWT |
| [Hyperliquid](hyperliquid.md) | 🔄 Backend complete, frontend pending | Crypto | Native WebSocket | Private key → EIP-712 signing |
