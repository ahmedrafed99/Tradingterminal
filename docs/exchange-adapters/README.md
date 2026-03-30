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

### Factory (`backend/src/adapters/factory.ts`)

Maps exchange names to factory functions:

```ts
const factories = {
  projectx: createProjectXAdapter,
  hyperliquid: createHyperliquidAdapter,
};
```

`createAdapter(exchange)` instantiates the right adapter.

### Realtime Modes

The `ExchangeRealtime` interface supports two connection modes:

1. **SignalR proxy** (ProjectX) — `negotiateMiddleware` + `handleUpgrade` for HTTP-based SignalR negotiate + WebSocket upgrade
2. **Native WebSocket** (Hyperliquid) — `wsPath` + `handleWsConnection` for direct WebSocket at a custom path

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

- `frontend/src/adapters/registry.ts` — `get/setRealtimeAdapter()`
- `frontend/src/services/realtimeService.ts` — delegating facade; all consumers import this, never the adapter directly
- `switchAdapter(exchange)` — disconnects old adapter, creates + registers new one

---

## Exchange Metadata (`backend/src/adapters/exchangeMeta.ts`)

Each exchange declares metadata used by the UI:

```ts
interface ExchangeMeta {
  id: string;
  displayName: string;
  category: 'futures' | 'crypto';
  is24h: boolean;
  defaultSymbol: string;
  quantityType: 'integer' | 'decimal';
  currencySymbol: string;
  credentialFields: { key, label, type }[];
  instrumentCategories: Record<string, {
    defaultFilter: string | null;
    filters: string[];
  }>;
}
```

This drives:
- Which instrument selector categories are enabled
- Sub-filter tabs within each category
- Credential form fields in Settings
- Market hours behavior (24/7 vs scheduled)
- Currency symbol display

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

| Exchange | Category | Realtime Mode | Auth Method |
|----------|----------|--------------|-------------|
| [ProjectX](projectx.md) | Futures | SignalR proxy | API key + username → JWT |
| [Hyperliquid](hyperliquid.md) | Crypto | Native WebSocket | Private key → EIP-712 signing |
