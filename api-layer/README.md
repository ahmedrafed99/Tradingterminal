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
└── realtimeService.ts      ← SignalR hub manager

backend/src/
├── proxy.ts                ← Express app with all proxy routes
├── auth.ts                 ← token store + loginKey call
├── routes/
│   ├── authRoutes.ts
│   ├── accountRoutes.ts
│   ├── marketDataRoutes.ts
│   └── orderRoutes.ts
└── signalrProxy.ts         ← WebSocket upgrade proxy to ProjectX
```

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

searchContracts(query: string): Promise<Contract[]>
listAvailableContracts(): Promise<Contract[]>
```

Bars are cached in memory per `(contractId, unit, unitNumber)`.
Cache is invalidated when the instrument or timeframe changes.

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

### Auth

| Method | Path | Body | Forwards to |
|--------|------|------|-------------|
| POST | /auth/connect | { username, apiKey, env } | POST /api/Auth/loginKey |
| POST | /auth/disconnect | — | (clears token) |
| GET | /auth/status | — | (local) |

### Accounts

| Method | Path | Forwards to |
|--------|------|-------------|
| GET | /accounts | POST /api/Account/search |

### Market Data

| Method | Path | Body | Forwards to |
|--------|------|------|-------------|
| POST | /market/bars | retrieveBars params | POST /api/History/retrieveBars |
| GET | /market/contracts/search?q= | — | POST /api/Contract/search |
| GET | /market/contracts/available | — | POST /api/Contract/available |

### Orders

| Method | Path | Body | Forwards to |
|--------|------|------|-------------|
| POST | /orders/place | order params | POST /api/Order/place |
| POST | /orders/cancel | { accountId, orderId } | POST /api/Order/cancel |
| PATCH | /orders/modify | modify params | POST /api/Order/modify |
| GET | /orders/open?accountId= | — | POST /api/Order/searchOpen |

### WebSocket

The proxy upgrades `/ws` to the ProjectX SignalR WebSocket endpoint and injects
the `Authorization: Bearer <token>` header server-side.

---

## ProjectX Base URLs

| Environment | REST Base URL |
|-------------|---------------|
| Demo | `https://gateway-api-demo.s2f.projectx.com` |
| Live | TBD (check ProjectX docs for production URL) |

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
