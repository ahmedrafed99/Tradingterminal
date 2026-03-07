# API Layer — Backend Documentation

Express proxy server running on `http://localhost:3001`.
All calls to TopstepX go through here so the API key never touches the browser.

---

## How to run

```bash
cd backend
npm install      # first time only
npm run dev      # starts with tsx watch (hot-reload)
```

**Important:** the JWT is stored in process memory. Every time the server
restarts you must call `POST /auth/connect` again before other endpoints work.

---

## File structure

```
backend/
├── src/
│   ├── index.ts                  ← Express app, SignalR WS proxy, server start
│   ├── auth.ts                   ← in-memory token store + connect/disconnect
│   ├── routes/
│   │   ├── authRoutes.ts         ← /auth/*
│   │   ├── accountRoutes.ts      ← /accounts
│   │   ├── marketDataRoutes.ts   ← /market/*
│   │   ├── orderRoutes.ts        ← /orders/*
│   │   ├── tradeRoutes.ts        ← /trades/*
│   │   └── newsRoutes.ts         ← /news/*
│   └── services/
│       └── newsService.ts        ← FXStreet calendar fetch + 4h cache
├── scripts/
│   ├── test-gateway-trade.ts    ← SignalR GatewayTrade event tester
│   └── test-gateway-depth.ts    ← SignalR GatewayDepth event tester
├── package.json
└── tsconfig.json
```

---

## Auth (`auth.ts`)

Holds the JWT and base URL in module-level memory.

| Export | Description |
|--------|-------------|
| `connect(username, apiKey, baseUrl?)` | Calls `/api/Auth/loginKey`, stores token |
| `disconnect()` | Clears the token |
| `isConnected()` | Returns `true` if a token is stored |
| `getToken()` | Returns raw JWT string or `null` |
| `getBaseUrl()` | Returns current gateway root URL |
| `authHeaders()` | Returns `{ Authorization, Content-Type, Accept }` headers object |

Default `baseUrl` = `https://api.topstepx.com`

---

## Endpoints

### Health

| Method | Path | Response |
|--------|------|----------|
| GET | `/health` | `{ ok: true, timestamp }` |

---

### Auth — `/auth/*`

#### `POST /auth/connect`
Authenticates with TopstepX and stores the JWT in memory.

**Body** (both `userName` and `username` accepted):
```json
{
  "userName": "your-projectx-username",
  "apiKey":   "your-api-key",
  "baseUrl":  "https://api.topstepx.com"
}
```
`baseUrl` is optional — defaults to `https://api.topstepx.com`.

**Success:** `{ "success": true }`
**Failure:** HTTP 401 `{ "success": false, "errorMessage": "..." }`

Common errorCode values from TopstepX:
- `0` = Success
- `3` = Login failed (wrong userName or apiKey)

---

#### `POST /auth/disconnect`
Clears the stored token. No body needed.

**Response:** `{ "success": true }`

---

#### `GET /auth/status`
Check connection state without making a TopstepX call.

**Response:**
```json
{ "connected": true, "baseUrl": "https://api.topstepx.com" }
```

---

#### `GET /auth/token`
Returns the raw JWT for frontend use (e.g. direct SignalR connection to `rtc.topstepx.com`).

**Success:** `{ "success": true, "token": "eyJhbG..." }`
**Not connected:** HTTP 401 `{ "success": false, "errorMessage": "Not connected" }`

---

### Accounts — `/accounts`

#### `GET /accounts`
Returns all accounts for the authenticated user.

**Response:**
```json
{
  "accounts": [
    { "id": 12345, "name": "Eval Account", "balance": 50000, ... }
  ],
  "success": true
}
```

---

### Market Data — `/market/*`

#### `POST /market/bars`
Fetch historical OHLCV candles.

**Body:**
```json
{
  "contractId":       "CON.F.US.MNQ.H25",
  "live":             false,
  "unit":             2,
  "unitNumber":       5,
  "startTime":        "2025-01-10T00:00:00Z",
  "endTime":          "2025-01-11T00:00:00Z",
  "limit":            500,
  "includePartialBar": true
}
```

`unit` values: `1`=Second `2`=Minute `3`=Hour `4`=Day `5`=Week `6`=Month
Max `limit`: 20,000 bars per request.

**Response:**
```json
{
  "bars": [
    { "t": "2025-01-10T09:30:00Z", "o": 21500.0, "h": 21520.0, "l": 21490.0, "c": 21510.0, "v": 1234 }
  ],
  "success": true
}
```

---

#### `GET /market/contracts/search?q=NQ&live=false`
Search for tradeable contracts by name.

| Query param | Required | Default | Description |
|-------------|----------|---------|-------------|
| `q` | yes | `""` | Search text (e.g. `NQ`, `ES`, `MNQ`) |
| `live` | no | `false` | `true` = live data contracts, `false` = sim |

**Response:**
```json
{
  "contracts": [
    {
      "id":             "CON.F.US.MNQ.H25",
      "name":           "MNQH5",
      "description":    "Micro E-mini NASDAQ-100: March 2025",
      "tickSize":       0.25,
      "tickValue":      0.50,
      "activeContract": true,
      "symbolId":       "F.US.MNQ"
    }
  ],
  "success": true
}
```

Returns up to 20 contracts.

---

#### `GET /market/contracts/available?live=false`
Lists all contracts the account has data subscriptions for.

| Query param | Required | Default | Description |
|-------------|----------|---------|-------------|
| `live` | no | `false` | `true` = live data contracts, `false` = sim |

**Response:**
```json
{
  "contracts": [
    {
      "id":             "CON.F.US.MNQ.H25",
      "name":           "MNQH5",
      "description":    "Micro E-mini NASDAQ-100: March 2025",
      "tickSize":       0.25,
      "tickValue":      0.50,
      "activeContract": true,
      "symbolId":       "F.US.MNQ"
    }
  ],
  "success": true
}
```

---

#### `GET /market/contracts/:id?live=false`
Look up a single contract by ID. Returns full contract details including `tickSize` and `tickValue`.

| Path param | Required | Description |
|------------|----------|-------------|
| `id` | yes | Contract ID (e.g. `CON.F.US.MNQ.H25`) |

| Query param | Required | Default | Description |
|-------------|----------|---------|-------------|
| `live` | no | `false` | `true` = live data contracts, `false` = sim |

**Response:**
```json
{
  "contract": {
    "id":             "CON.F.US.MNQ.H25",
    "name":           "MNQH5",
    "description":    "Micro E-mini NASDAQ-100: March 2025",
    "tickSize":       0.25,
    "tickValue":      0.50,
    "activeContract": true,
    "symbolId":       "F.US.MNQ"
  },
  "success": true
}
```

---

### Orders — `/orders/*`

#### `POST /orders/place`
Place a new order. Bracket fields are optional but recommended.

**Body:**
```json
{
  "accountId":   12345,
  "contractId":  "CON.F.US.MNQ.H25",
  "type":        2,
  "side":        0,
  "size":        1,
  "limitPrice":  21500.00,
  "stopLossBracket":   { "ticks": 20, "type": 4 },
  "takeProfitBracket": { "ticks": 30, "type": 1 }
}
```

`type`: `1`=Limit `2`=Market `4`=Stop `5`=TrailingStop
`side`: `0`=Buy (Bid) `1`=Sell (Ask)

**Response:** `{ "orderId": 9056, "success": true }`

---

#### `POST /orders/cancel`
Cancel an open order.

**Body:** `{ "accountId": 12345, "orderId": 9056 }`
**Response:** `{ "success": true }`

---

#### `PATCH /orders/modify`
Change price or size of an open order.

**Body:**
```json
{
  "accountId":  12345,
  "orderId":    9056,
  "limitPrice": 21490.00,
  "stopPrice":  21450.00,
  "trailPrice": null,
  "size":       1
}
```
All fields except `accountId` + `orderId` are optional.

---

#### `GET /orders/open?accountId=12345`
Get all open orders for an account.

**Response:**
```json
{
  "orders": [
    { "id": 9056, "contractId": "...", "type": 1, "side": 0, "size": 1, "limitPrice": 21500, ... }
  ],
  "success": true
}
```

---

### Trades — `/trades/*`

#### `GET /trades/search?accountId=12345&startTimestamp=2026-02-24T00:00:00Z`
Search for half-turn trades (fills) within a time range. Used to calculate daily realized P&L.

| Query param | Required | Default | Description |
|-------------|----------|---------|-------------|
| `accountId` | yes | — | Account ID |
| `startTimestamp` | yes | — | ISO 8601 start of time range |
| `endTimestamp` | no | — | ISO 8601 end of time range (omit for "up to now") |

**Response:**
```json
{
  "trades": [
    {
      "id": 2174021045,
      "accountId": 19302808,
      "contractId": "CON.F.US.ENQ.H26",
      "creationTimestamp": "2026-02-24T12:02:15Z",
      "price": 24958.5,
      "profitAndLoss": 12.50,
      "fees": 0.37,
      "side": 0,
      "size": 1,
      "voided": false,
      "orderId": 2499804656
    }
  ],
  "success": true,
  "errorCode": 0,
  "errorMessage": null
}
```

`profitAndLoss`: realized P&L for this fill — `null` for opening (half-turn) trades, a number for closing trades.
`side`: `0`=Buy `1`=Sell
`errorCode`: `0`=Success `1`=AccountNotFound

**Calculating daily Realized P&L (matching TopstepX display):**
- Use CME session start as `startTimestamp`: **6:00 PM New York time** (previous day if before 6 PM NY now). This equals `23:00 UTC` during EST or `22:00 UTC` during EDT.
- `Net RP&L = sum(profitAndLoss) - sum(fees)` for all non-voided trades
- `profitAndLoss` values are already in dollar amounts (no tick-value multiplication needed)
- Skip trades where `profitAndLoss` is `null` (opening half-turns) or `voided` is `true`

---

### News — `/news/*`

#### `GET /news/economic`
Returns upcoming and recent US economic calendar events from FXStreet. No authentication required (does not depend on TopstepX connection).

**Response:**
```json
[
  {
    "id": "835b3265-...",
    "title": "Consumer Price Index (MoM)",
    "date": "2026-03-11T13:30:00Z",
    "impact": "high",
    "category": "inflation",
    "actual": null,
    "consensus": 0.2,
    "previous": 0.2,
    "isBetterThanExpected": null,
    "country": "US",
    "currency": "USD"
  }
]
```

| Field | Description |
|-------|-------------|
| `impact` | `high`, `medium`, or `low` |
| `category` | `fed`, `inflation`, `employment`, or `other` (keyword-based) |
| `actual` | `null` for upcoming events, number after release |
| `isBetterThanExpected` | `null` before release, `true`/`false` after |

**Caching:** Results are cached server-side for 4 hours. The date range covers current month through end of next month.

**Upstream:** `GET https://calendar-api.fxstreet.com/en/api/v1/eventDates/{from}/{to}` — no API key needed, requires `Origin`/`Referer` headers.

---

### SignalR — Direct Connection (not proxied)

The SignalR hubs live on a **separate host** (`rtc.topstepx.com`), not on the
REST API host. The backend proxy cannot forward WebSocket connections there, so
the frontend connects directly using the JWT from `GET /auth/token`.

| Hub | URL | Data streamed |
|-----|-----|---------------|
| Market | `wss://rtc.topstepx.com/hubs/market` | Quotes, trades, market depth |
| User | `wss://rtc.topstepx.com/hubs/user` | Orders, positions, account updates |

**Connection setup** (must match exactly):
```js
const connection = new HubConnectionBuilder()
  .withUrl(`https://rtc.topstepx.com/hubs/market?access_token=${JWT}`, {
    skipNegotiation: true,
    transport: HttpTransportType.WebSockets,
    accessTokenFactory: () => JWT,
    timeout: 10000,
  })
  .withAutomaticReconnect()
  .build();
```

**Market Hub subscriptions:**

| Method | Param | Event callback |
|--------|-------|----------------|
| `SubscribeContractQuotes(contractId)` | contract ID string | `GatewayQuote(contractId, data)` |
| `SubscribeContractTrades(contractId)` | contract ID string | `GatewayTrade(contractId, data)` |
| `SubscribeContractMarketDepth(contractId)` | contract ID string | `GatewayDepth(contractId, data)` |

**User Hub subscriptions:**

| Method | Param | Event callback |
|--------|-------|----------------|
| `SubscribeAccounts` | (none) | `GatewayUserAccount(items)` |
| `SubscribeOrders(accountId)` | account ID number | `GatewayUserOrder(items)` |
| `SubscribePositions(accountId)` | account ID number | `GatewayUserPosition(items)` |
| `SubscribeTrades(accountId)` | account ID number | `GatewayUserTrade(items)` |

---

### Event Data Shapes (verified)

**`GatewayQuote` (Market Hub)** — two params: `(contractId, data)`
```json
{
  "symbol": "F.US.ENQ",
  "symbolName": "/NQ",
  "lastPrice": 24964.5,
  "bestBid": 24964.25,
  "bestAsk": 24965.75,
  "change": -103,
  "changePercent": -0.0041,
  "open": 25033.75,
  "high": 25059.75,
  "low": 24956.5,
  "volume": 7640,
  "lastUpdated": "2026-02-22T23:40:39Z",
  "timestamp": "2026-02-22T20:53:40Z"
}
```

**`GatewayDepth` (Market Hub)** — two params: `(contractId, entries[])`

Each entry: `{ price, volume, currentVolume, type, timestamp }`

`type` values: `3`=Best Ask, `4`=Best Bid, `5`=Volume at Price, `6`=Reset, `7`=Session Low, `8`=Session High

On subscribe, the first event is a reset (type 6, price=0), followed by a snapshot with all session price levels (type 5, 600+ entries typical). Subsequent events are incremental updates (1-4 entries). Some entries may be `null` — filter before processing.

```json
{
  "price": 25310,
  "volume": 408,
  "currentVolume": 0,
  "type": 5,
  "timestamp": "2026-02-26T09:46:21.295+00:00"
}
```

`volume`: total session volume at this price | `currentVolume`: 1 if a trade just occurred here, 0 otherwise

---

**User Hub events** — single array param: `[{ action, data }]`

`action` values: `0` = new, `1` = update/change

**`GatewayUserOrder`**
```json
{
  "action": 1,
  "data": {
    "id": 2499804656,
    "accountId": 18667281,
    "contractId": "CON.F.US.MNQ.H26",
    "symbolId": "F.US.MNQ",
    "creationTimestamp": "2026-02-22T23:54:35Z",
    "updateTimestamp": "2026-02-22T23:54:35Z",
    "status": 2,
    "type": 2,
    "side": 0,
    "size": 1,
    "fillVolume": 1,
    "filledPrice": 24958.5,
    "customTag": "e9733a88-..."
  }
}
```
`status`: `6`=pending, `2`=filled | `type`: `1`=Limit, `2`=Market | `side`: `0`=Buy, `1`=Sell
Two events fire per market order: first `status:6` (accepted, `fillVolume:0`), then `status:2` (filled, `filledPrice` set).

**`GatewayUserTrade`**
```json
{
  "action": 0,
  "data": {
    "id": 2162413192,
    "accountId": 18667281,
    "contractId": "CON.F.US.MNQ.H26",
    "creationTimestamp": "2026-02-22T23:54:35Z",
    "price": 24958.5,
    "fees": 0.37,
    "side": 0,
    "size": 1,
    "voided": false,
    "orderId": 2499804656
  }
}
```

**`GatewayUserPosition`**
```json
{
  "action": 1,
  "data": {
    "id": 593169304,
    "accountId": 18667281,
    "contractId": "CON.F.US.MNQ.H26",
    "creationTimestamp": "2026-02-22T23:54:35Z",
    "type": 1,
    "size": 1,
    "averagePrice": 24958.5
  }
}
```
`type`: `1`=Long, `2`=Short (assumed) | `size`=0 when position is closed

**`GatewayUserAccount`**
```json
{
  "action": 1,
  "data": {
    "id": 18667281,
    "name": "PRAC-V2-93360-47923526",
    "balance": 150256.61,
    "canTrade": true,
    "isVisible": true,
    "simulated": true
  }
}
```

---

### Important notes
- **Market Hub** callbacks receive **two parameters**: `(contractId, data)`
- **User Hub** callbacks receive **one array parameter**: `[{ action, data }]`
- Contract IDs must be for **active** contracts (e.g. `H26` in 2026, not `H25`)
- Resubscribe on reconnect (use `onreconnected` callback)
- A single market buy triggers events in order: Order(pending) → Order(filled) → Trade → Position → Account

---

## Error format

All endpoints return a consistent envelope on failure:
```json
{ "success": false, "errorMessage": "Human-readable reason" }
```

HTTP status codes used:
- `400` — missing required fields in request
- `401` — not connected (call `/auth/connect` first)
- `502` — upstream TopstepX call failed (check errorMessage for details)
