# Feature: API Layer

All communication with the ProjectX Gateway is centralised here.
The frontend never calls ProjectX directly — it calls the local Express proxy,
which adds the JWT and forwards the request.

---

## Structure

```
frontend/src/services/
├── authService.ts          ← connect / disconnect / status
├── accountService.ts       ← list accounts
├── marketDataService.ts    ← bars history + contract search
├── orderService.ts         ← place / cancel / modify / list
├── realtimeService.ts      ← SignalR hub manager
└── persistenceService.ts   ← load / save settings to backend file

backend/src/
├── index.ts                ← Express app, mounts routes + adapter realtime handlers
├── validate.ts             ← Zod validation middleware
├── types/enums.ts          ← OrderType, OrderSide enums
├── adapters/
│   ├── types.ts            ← ExchangeAdapter interface (auth, accounts, orders, etc.)
│   ├── registry.ts         ← Singleton: getAdapter / setAdapter / isConnected
│   └── projectx/           ← ProjectX implementation of ExchangeAdapter
│       ├── index.ts        ← createProjectXAdapter() factory
│       ├── auth.ts         ← JWT token store + /api/Auth/loginKey
│       ├── accounts.ts     ← /api/Account/search
│       ├── marketData.ts   ← bars + contract search/available/byId
│       ├── orders.ts       ← place / cancel / modify / searchOpen
│       ├── trades.ts       ← /api/Trade/search
│       └── realtime.ts     ← SignalR negotiate proxy + WS upgrade handler
├── routes/
│   ├── authRoutes.ts       ← creates adapter on connect, clears on disconnect
│   ├── accountRoutes.ts
│   ├── marketDataRoutes.ts
│   ├── orderRoutes.ts
│   ├── tradeRoutes.ts
│   └── settingsRoutes.ts   ← file-based settings persistence (GET/PUT)
└── data/
    └── user-settings.json  ← persisted settings (gitignored, auto-created)
```

Routes are exchange-agnostic — they call `getAdapter().domain.method()` instead of axios directly. The adapter is selected during `/auth/connect` (currently hardcoded to ProjectX).

---

## Frontend Services

### `authService.ts`

```ts
connect(username: string, apiKey: string, env: 'demo' | 'live'): Promise<void>
disconnect(): Promise<void>
getStatus(): Promise<{ connected: boolean; environment: string }>
```

### `accountService.ts`

```ts
searchAccounts(): Promise<Account[]>
// GET /proxy/accounts
// → POST https://…/api/Account/search
```

### `marketDataService.ts`

```ts
retrieveBars(params: {
  contractId: string
  unit: 1|2|3|4|5|6          // Second|Minute|Hour|Day|Week|Month
  unitNumber: number
  startTime: string           // ISO 8601
  endTime: string
  limit?: number              // max 20,000
  includePartialBar?: boolean
}): Promise<Bar[]>

searchContracts(query: string): Promise<Contract[]>       // normalized with computed fields
listAvailableContracts(): Promise<Contract[]>              // normalized with computed fields
```

Cache hierarchy (all keyed by `contractId:unit:unitNumber`, 60s TTL):
1. In-memory `Map` (fastest, lost on refresh) → 2. `sessionStorage` (survives refresh) → 3. In-flight dedup → 4. Network fetch.
Chart renders instantly on page refresh from sessionStorage cache.

### `orderService.ts`

```ts
placeOrder(params: {
  accountId: number
  contractId: string
  type: 1|2|4|5               // Limit|Market|Stop|TrailingStop
  side: 0|1                   // Bid(buy)|Ask(sell)
  size: number
  limitPrice?: number
  stopPrice?: number
  stopLossBracket?: { ticks: number; type: number }
  takeProfitBracket?: { ticks: number; type: number }
}): Promise<{ orderId: number }>

cancelOrder(accountId: number, orderId: number): Promise<void>

modifyOrder(params: {
  accountId: number
  orderId: number
  size?: number
  limitPrice?: number
  stopPrice?: number
  trailPrice?: number
}): Promise<void>

searchOpenOrders(accountId: number): Promise<Order[]>
```

### `realtimeService.ts`

Singleton that manages both SignalR hub connections (Market + User).
Connects directly to `rtc.topstepx.com` using JWT from `GET /auth/token`.

```ts
connect(token: string): Promise<void>
disconnect(): Promise<void>
isConnected(): boolean

// Market Hub subscriptions
subscribeQuotes(contractId: string): void
unsubscribeQuotes(contractId: string): void
subscribeDepth(contractId: string): void      // Volume profile data
unsubscribeDepth(contractId: string): void

// User Hub subscriptions
subscribeUserEvents(accountId: number): void

// Event handlers (register/unregister)
onQuote(handler):    void    offQuote(handler):    void
onDepth(handler):    void    offDepth(handler):    void
onOrder(handler):    void    offOrder(handler):    void
onPosition(handler): void    offPosition(handler): void
onAccount(handler):  void    offAccount(handler):  void
onTrade(handler):    void    offTrade(handler):    void

// Reconnect callback (fires after user hub reconnects and resubscribes)
onUserReconnect(handler: () => void): void
offUserReconnect(handler: () => void): void

// Utility
ping(): Promise<number>   // WebSocket round-trip latency in ms
```

**Handler signatures:**
```ts
QuoteHandler    = (contractId: string, data: GatewayQuote) => void
DepthHandler    = (contractId: string, entries: DepthEntry[]) => void
OrderHandler    = (order: RealtimeOrder, action: number) => void
PositionHandler = (position: RealtimePosition, action: number) => void
AccountHandler  = (account: RealtimeAccount, action: number) => void
TradeHandler    = (trade: RealtimeTrade, action: number) => void
```

Automatically resubscribes all active subscriptions on reconnect.
Fires `userReconnectHandlers` after user hub reconnect (used by `OrderPanel` to re-fetch open orders).
Null entries in `GatewayDepth` arrays are filtered before dispatching to handlers.

---

## Backend Proxy Routes (Express)

All routes call the active `ExchangeAdapter` via `getAdapter()` from the adapter registry. The routes handle Zod validation, auth guards, and error responses — the adapter handles the actual gateway communication.

### Auth

| Method | Path | Body | Adapter call |
|--------|------|------|-------------|
| POST | /auth/connect | { username, apiKey, baseUrl? } | `createProjectXAdapter()` → `adapter.auth.connect()` → `setAdapter()` |
| POST | /auth/disconnect | — | `adapter.auth.disconnect()` → `clearAdapter()` |
| GET | /auth/status | — | `adapter.auth.getStatus()` |

### Accounts

| Method | Path | Adapter call |
|--------|------|-------------|
| GET | /accounts | `adapter.accounts.list()` |

### Market Data

| Method | Path | Body | Adapter call |
|--------|------|------|-------------|
| POST | /market/bars | retrieveBars params | `adapter.marketData.retrieveBars(params)` |
| GET | /market/contracts/search?q= | — | `adapter.marketData.searchContracts(q, live)` |
| GET | /market/contracts/available | — | `adapter.marketData.availableContracts(live)` |
| GET | /market/contracts/:id | — | `adapter.marketData.searchContractById(id, live)` |

### Orders

| Method | Path | Body | Adapter call |
|--------|------|------|-------------|
| POST | /orders/place | order params | `adapter.orders.place(params)` |
| POST | /orders/cancel | { accountId, orderId } | `adapter.orders.cancel(params)` |
| PATCH | /orders/modify | modify params | `adapter.orders.modify(params)` |
| GET | /orders/open?accountId= | — | `adapter.orders.searchOpen(accountId)` |

### Trades

| Method | Path | Adapter call |
|--------|------|-------------|
| GET | /trades/search?accountId=&startTimestamp= | `adapter.trades.search(params)` |

### Settings (File-Based Persistence)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | /settings | — | Read persisted settings from `backend/data/user-settings.json` (returns `{}` if file doesn't exist) |
| PUT | /settings | full settings object | Write settings to disk (no auth guard — local-only) |

No adapter call — these endpoints read/write directly to the local filesystem. See `settings-persistence/README.md` for full details.

### WebSocket / SignalR

The adapter provides two realtime handlers mounted by `index.ts`:
- **HTTP negotiate**: `app.use('/hubs', adapter.realtime.negotiateMiddleware)` — proxies SignalR negotiate calls
- **WS upgrade**: `server.on('upgrade', adapter.realtime.handleUpgrade)` — proxies WebSocket connections, injecting JWT as query param

### ProjectX Base URLs

| Environment | REST Base URL |
|-------------|---------------|
| Default | `https://api.topstepx.com` |
| Custom | Pass `baseUrl` in the connect payload |

SignalR RTC URL is derived automatically: `api.topstepx.com` → `rtc.topstepx.com`.

All REST endpoints use:
- `Content-Type: application/json`
- `Authorization: Bearer <jwt>`

---

## Error Handling

- All proxy routes return `{ success: boolean, errorCode: number, errorMessage: string | null }`
  matching the ProjectX response envelope
- The frontend `orderService` validates the `success` field via `assertSuccess()` — throws with `errorMessage` when `success === false` (gateway may return HTTP 200 with a failure payload)
- All four order methods (`placeOrder`, `cancelOrder`, `modifyOrder`, `searchOpenOrders`) check `success`
- 401 responses → trigger disconnect flow + prompt user to reconnect
- SignalR reconnects automatically with exponential backoff (built into
  `@microsoft/signalr` `withAutomaticReconnect()`)
- On user hub reconnect, `OrderPanel` re-fetches open orders to recover from missed events
