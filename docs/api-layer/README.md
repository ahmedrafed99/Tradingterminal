# Feature: API Layer

All communication with exchange gateways is centralised here.
The frontend never calls exchanges directly — it calls the local Express proxy,
which adds credentials and forwards the request.

---

## Structure

```
frontend/src/services/
├── authService.ts          ← connect / disconnect / status / listExchanges
├── accountService.ts       ← list accounts
├── marketDataService.ts    ← bars history + contract search
├── orderService.ts         ← place / cancel / modify / list
├── realtimeService.ts      ← realtime hub manager (delegates to active adapter)
├── positionService.ts      ← open positions (REST)
├── tradeService.ts         ← trade history
└── persistenceService.ts   ← load / save settings to backend file

frontend/src/adapters/
├── types.ts                ← Canonical types (Quote, RealtimeOrder, etc.) + RealtimeAdapter interface
├── registry.ts             ← get/set active RealtimeAdapter
└── projectx/
    └── realtimeAdapter.ts  ← ProjectX SignalR implementation (normalizes IDs to strings)

backend/src/
├── index.ts                ← Express app, mounts routes + adapter realtime handlers
├── validate.ts             ← Zod validation middleware (validateBody, validateQuery)
├── middleware/
│   └── withConnection.ts   ← Auth guard: checks adapter is connected, returns 401 if not
├── types/enums.ts          ← OrderType, OrderSide enums
├── adapters/
│   ├── types.ts            ← ExchangeAdapter interface (auth, accounts, orders, etc.)
│   ├── registry.ts         ← Multi-adapter map: getAdapter(id?) / setAdapter(id, adapter)
│   ├── factory.ts          ← createAdapter(exchange) — routes to correct factory
│   └── projectx/           ← ProjectX implementation of ExchangeAdapter
│       ├── index.ts        ← createProjectXAdapter() factory
│       ├── auth.ts         ← JWT token store + /api/Auth/loginKey
│       ├── accounts.ts     ← /api/Account/search
│       ├── marketData.ts   ← bars + contract search/available/byId
│       ├── orders.ts       ← place / cancel / modify / searchOpen (converts string IDs → numeric)
│       ├── positions.ts    ← /api/Position/searchOpen (converts string IDs → numeric)
│       ├── trades.ts       ← /api/Trade/search (converts string IDs → numeric)
│       └── realtime.ts     ← SignalR negotiate proxy + WS upgrade handler
├── routes/
│   ├── authRoutes.ts       ← multi-exchange connect/disconnect/status/exchanges/default
│   ├── accountRoutes.ts
│   ├── marketDataRoutes.ts
│   ├── orderRoutes.ts
│   ├── tradeRoutes.ts
│   ├── newsRoutes.ts       ← economic calendar proxy (GET /news/economic)
│   └── settingsRoutes.ts   ← file-based settings persistence (GET/PUT, Zod validated)
└── data/
    └── user-settings.json  ← persisted settings (gitignored, auto-created)
```

Routes are exchange-agnostic — they call `getAdapter().domain.method()` instead of axios directly. The adapter is selected during `/auth/connect` via `createAdapter(exchange)` from `factory.ts`. All authenticated routes use `withConnection()` middleware from `middleware/withConnection.ts` (auth guard — returns 401 if no adapter connected). Input validation uses `validateBody()` / `validateQuery()` from `validate.ts` with Zod schemas.

---

## Multi-Exchange Architecture

### ID System

All entity IDs (accounts, orders, positions, trades) are **strings** throughout the entire codebase. This supports exchanges that use non-numeric IDs (hex addresses, UUIDs). ProjectX adapters convert numeric IDs to strings at the boundary:
- **Backend**: `String(id)` / `Number(id)` in `backend/src/adapters/projectx/*.ts`
- **Frontend REST**: `String(id)` mapping in `accountService`, `orderService`, `positionService`, `tradeService`
- **Frontend SignalR**: `String(id)` in `realtimeAdapter.ts` event handlers

### Adapter Registry

The backend registry (`adapters/registry.ts`) is a `Map<string, ExchangeAdapter>`:
- `setAdapter(exchangeId, adapter)` — register a connected exchange
- `getAdapter(exchangeId?)` — get by ID, or default if omitted
- `removeAdapter(exchangeId)` — disconnect specific exchange
- `isConnected(exchangeId?)` — check specific or any
- `listConnected()` — all connected exchange IDs
- First connected exchange becomes the default; `setDefaultExchangeId()` to change

### Adapter Factory

`adapters/factory.ts` maps exchange names to factory functions:
```ts
createAdapter('projectx')  → createProjectXAdapter()
// Future: createAdapter('hyperliquid') → createHyperliquidAdapter()
```

### ConnectParams

Generic credential model — each adapter reads what it needs:
```ts
interface ConnectParams {
  exchange: string;
  credentials: Record<string, string>;  // exchange-specific key/value pairs
  baseUrl?: string;
}
```
ProjectX adapter reads `credentials.username` and `credentials.apiKey`.

### ExchangeRealtime (optional)

The `realtime` field on `ExchangeAdapter` is optional. Exchanges that don't use SignalR (e.g. crypto with raw WebSockets) can omit it. The server's hub proxy and WS upgrade handler check for existence before delegating.

---

## Frontend Services

### `authService.ts`

```ts
connect(userName: string, apiKey: string, baseUrl?: string, exchange?: string): Promise<void>
disconnect(exchange?: string): Promise<void>
getStatus(): Promise<AuthStatus>
listExchanges(): Promise<{ exchanges: string[]; connected: string[] }>
```

### `accountService.ts`

```ts
searchAccounts(): Promise<Account[]>   // IDs stringified at boundary, dedup()-wrapped
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

**Connection gate**: Both `retrieveBars` and `searchContracts` calls are gated on `connected` state in all consumer hooks/components. No market data requests fire while disconnected.

**`retrieveBars` cache** (keyed by `contractId:unit:unitNumber`, 60s TTL):
1. In-memory `Map` (fastest, lost on refresh) → 2. `sessionStorage` (survives refresh) → 3. In-flight dedup → 4. Network fetch.
Chart renders instantly on page refresh from sessionStorage cache.

**`searchContracts` cache** (keyed by `QUERY:live`, 2min TTL):
1. In-memory `Map` → 2. In-flight dedup → 3. Network fetch.
App.tsx resolves NQ in a single effect that sets both `contract` and `orderContract`. Pinned instrument resolution (`useInstrumentSearch`) hits the cache populated by this initial search.

**`credentialService` cache**: `load()` caches credentials in memory after first fetch; `save()`/`clear()` update the cache. Avoids re-fetching on SettingsModal re-opens.

**`getStatus` / `loadSettings` / `searchTrades` / `searchAccounts` / `conditionService.getAll` dedup**: All use in-flight promise dedup — concurrent calls (e.g. from React StrictMode double-mounting) share a single network request. `searchTrades` dedup is keyed by the full URL (account + timestamps).

### `orderService.ts`

```ts
placeOrder(params: {
  accountId: string
  contractId: string
  type: 1|2|4|5               // Limit|Market|Stop|TrailingStop
  side: 0|1                   // Bid(buy)|Ask(sell)
  size: number                // fractional allowed (crypto)
  limitPrice?: number
  stopPrice?: number
  stopLossBracket?: { ticks: number; type: number }
  takeProfitBracket?: { ticks: number; type: number }
}): Promise<{ orderId: string }>

cancelOrder(accountId: string, orderId: string): Promise<void>

modifyOrder(params: {
  accountId: string
  orderId: string
  size?: number
  limitPrice?: number
  stopPrice?: number
  trailPrice?: number
}): Promise<void>

searchOpenOrders(accountId: string): Promise<Order[]>   // IDs stringified at boundary
```

### `realtimeService.ts`

Singleton that delegates to whichever `RealtimeAdapter` is registered.
Currently connects through the backend proxy at `/hubs/*` — JWT is injected server-side.

```ts
connect(): Promise<void>
disconnect(): Promise<void>
isConnected(): boolean

// Market subscriptions
subscribeQuotes(contractId: string): void   // Also subscribes to SubscribeContractTrades
unsubscribeQuotes(contractId: string): void
subscribeDepth(contractId: string): void    // Volume profile data
unsubscribeDepth(contractId: string): void

// User subscriptions
subscribeUserEvents(accountId: string): void

// Event handlers (register/unregister)
onQuote(handler):    void    offQuote(handler):    void
onDepth(handler):    void    offDepth(handler):    void
onOrder(handler):    void    offOrder(handler):    void
onPosition(handler): void    offPosition(handler): void
onAccount(handler):  void    offAccount(handler):  void
onTrade(handler):    void    offTrade(handler):    void

// Reconnect callback
onUserReconnect(handler: () => void): void
offUserReconnect(handler: () => void): void

// Utility
ping(): Promise<number>   // WebSocket round-trip latency in ms
```

**Price update strategy:** `subscribeQuotes()` subscribes to both `SubscribeContractQuotes` and `SubscribeContractTrades` on the market hub. `GatewayQuote` events are the primary price source (carry full market snapshot: bid/ask/high/low/volume). `GatewayTrade` events are the fallback — when quotes go silent (e.g. stable spread, daily maintenance close), trade prices are used to synthesize quote objects so `lastPrice` stays current. Both feed into the same `quoteHandlers`. The adapter caches the last quote per contract so synthetic quotes from trades carry forward bid/ask/high/low values.

**Handler signatures:**
```ts
QuoteHandler    = (contractId: string, data: Quote) => void
DepthHandler    = (contractId: string, entries: DepthEntry[]) => void
OrderHandler    = (order: RealtimeOrder, action: number) => void
PositionHandler = (position: RealtimePosition, action: number) => void
AccountHandler  = (account: RealtimeAccount, action: number) => void
TradeHandler    = (trade: RealtimeTrade, action: number) => void
```

All IDs in realtime events are strings (converted from ProjectX numeric IDs in the adapter).

Automatically resubscribes all active subscriptions on reconnect.
Fires `userReconnectHandlers` after user hub reconnect (used by `OrderPanel` to re-fetch open orders and infer positions).
Null entries in `GatewayDepth` arrays are filtered before dispatching to handlers.

---

## Backend Proxy Routes (Express)

All routes call the active `ExchangeAdapter` via `getAdapter()` from the adapter registry. The routes handle Zod validation, auth guards, and error responses — the adapter handles the actual gateway communication.

### Auth

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | /auth/connect | { exchange?, credentials?, userName?, apiKey?, baseUrl? } | Creates adapter via factory, connects, registers in registry |
| POST | /auth/disconnect | { exchange? } | Disconnect specific exchange or all |
| GET | /auth/status | — | Connected exchanges + status from each adapter |
| GET | /auth/exchanges | — | List available + connected exchange types |
| POST | /auth/default | { exchange } | Set the default exchange for unqualified requests |

Legacy fields (`userName`, `apiKey`, `baseUrl`) are supported for backward compatibility and mapped into `credentials`.

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
| POST | /orders/place | order params (accountId: string) | `adapter.orders.place(params)` |
| POST | /orders/cancel | { accountId: string, orderId: string } | `adapter.orders.cancel(params)` |
| PATCH | /orders/modify | modify params (IDs: string) | `adapter.orders.modify(params)` |
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

No adapter call — these endpoints read/write directly to the local filesystem. See `../settings-persistence/README.md` for full details.

### WebSocket / SignalR

The adapter optionally provides two realtime handlers mounted by `index.ts`:
- **HTTP negotiate**: `app.use('/hubs', adapter.realtime.negotiateMiddleware)` — proxies SignalR negotiate calls
- **WS upgrade**: `server.on('upgrade', adapter.realtime.handleUpgrade)` — proxies WebSocket connections, injecting JWT as query param

Both check if `adapter.realtime` exists before delegating — exchanges without SignalR (e.g. crypto) can omit realtime entirely.

### Auto-Connect

Environment variables for headless/remote deployment:
```bash
# Generic (any exchange)
AUTO_CONNECT_EXCHANGE=projectx
AUTO_CONNECT_CREDENTIALS={"username":"...","apiKey":"..."}

# Legacy (ProjectX only, still supported)
TOPSTEP_USERNAME=...
TOPSTEP_PASSWORD=...
```

### ProjectX Base URLs

| Environment | REST Base URL |
|-------------|---------------|
| Default | `https://api.topstepx.com` |
| Custom | Pass `baseUrl` in connect payload or credentials |

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
- On user hub reconnect, `OrderPanel` re-fetches open orders and infers positions from orders + trades to recover from missed events
