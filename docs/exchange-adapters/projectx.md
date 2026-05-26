# ProjectX (TopstepX) Adapter

## Overview

ProjectX is the gateway for TopstepX futures trading. It provides REST APIs and SignalR hubs for real-time data.

- **Base URL**: `https://api.topstepx.com`
- **Realtime**: `wss://rtc.topstepx.com/hubs/market` + `/hubs/user`
- **Auth**: API key + username → JWT token

## Authentication

1. `POST /api/Auth/loginKey` with `{ userName, apiKey }`
2. Returns JWT token stored in backend memory
3. Token injected as `Authorization: Bearer` on all subsequent requests
4. RTC base URL derived from API base URL (`api.` → `rtc.`)
5. After login, OCO brackets are **auto-enabled** on all active accounts (fire-and-forget)

### Auto OCO Brackets

After a successful login, `auth.ts` fetches all active accounts and calls:

```
POST https://userapi.topstepx.com/TradingAccount/setAutoOcoBrackets
{ tradingAccountId: <id>, autoOcoBrackets: true }
```

This runs in the background (non-fatal if it fails) so bracket orders work immediately without requiring a manual toggle in the TopstepX UI. The `userapi` subdomain is derived automatically from the configured base URL (`api.` → `userapi.`).

## Trading Account Details — `GET /TradingAccount`

Returns the full per-account state used by TopstepX to compute eligibility, drawdown, lockouts, and rule-violation/blown status. The `userapi` subdomain is **separate** from `api.topstepx.com` — this data is not exposed via the standard `POST /api/Account/search` endpoint.

```
GET https://userapi.topstepx.com/TradingAccount
Authorization: Bearer <jwt>
```

Response: array of trading-account objects (one per account on the user). Used by `projectXAccounts.eligibility()` in [backend/src/adapters/projectx/accounts.ts](backend/src/adapters/projectx/accounts.ts) — today only `accountId` + `ineligible` are extracted; the remaining fields are available for drawdown / blown-account detection.

### Sample response

Two accounts: a `50KTC-V2` Combine in personal lockout (PDLL hit), and a `PRAC-V2` practice account.

```json
[
  {
    "realizedDayPnl": 439.8000,
    "updatedAt": "2026-05-26T17:15:53.336185+00:00",
    "personalDailyLossLimit": null,
    "personalDailyLossLimitAction": 0,
    "personalDailyLossLimitTrailing": false,
    "pdllTrailingType": 0,
    "pdllTrailingBalance": null,
    "pdllTrailingStartingBalance": null,
    "personalDailyProfitTarget": null,
    "personalDailyProfitTargetAction": 0,
    "totalProfit": 2440.500000000,
    "totalLoss": -1192.000000000,
    "totalTrades": 79,
    "dailyTrades": 10,
    "isFollower": false,
    "isLeader": false,
    "openPnl": 0.0000,
    "highestBalance": 50662.3800,
    "highestUnrealizedBalance": 51130.8000,
    "highestRealizedBalance": 51102.1800,
    "ineligible": false,
    "templateId": 1,
    "currentDayTrades": 3,
    "currentWeekTrades": 3,
    "accountName": "50KTC-V2-93360-91313032",
    "nickname": null,
    "userId": 93360,
    "startingBalance": 50000.0000,
    "balance": 51102.1800,
    "status": 0,
    "lockoutExpiration": "2026-05-26T22:00:00+00:00",
    "lockoutReason": "Personal",
    "dailyTradeLimit": null,
    "weeklyTradeLimit": null,
    "marketDataLevel": 0,
    "accountId": 23212177,
    "winRate": 0.5443,
    "profitAndLoss": 1102.1800,
    "startDate": "2026-05-20T14:00:50.140956+00:00",
    "closedDate": null,
    "dailyLoss": 0.0,
    "overrideDailyLossLimit": null,
    "overrideMaxLossLimit": null,
    "maximumLoss": 48662.3800,
    "drawDownLimit": 0.0000,
    "combineDailyLoss": 0.0000,
    "maxPositions": 0,
    "type": 1,
    "startOfDayBalance": 50662.3800,
    "combineName": "",
    "platformId": 0,
    "platformAccountId": null,
    "platformUserName": null,
    "maxMargin": 50000.0000,
    "minimumMll": null,
    "isSharing": false,
    "availableCash": null,
    "totalSubscriptionCost": 4.6500,
    "hasInsufficientFunds": false,
    "autoOcoBrackets": true,
    "bracketAutoApply": null,
    "bracketAmountToRisk": null,
    "bracketAmountToMake": null
  },
  {
    "realizedDayPnl": 0.0000,
    "updatedAt": "2026-05-26T17:15:53.340315+00:00",
    "personalDailyLossLimit": null,
    "personalDailyLossLimitAction": 0,
    "personalDailyLossLimitTrailing": false,
    "pdllTrailingType": 0,
    "pdllTrailingBalance": null,
    "pdllTrailingStartingBalance": null,
    "personalDailyProfitTarget": null,
    "personalDailyProfitTargetAction": 0,
    "totalProfit": 305.000000000,
    "totalLoss": -281.500000000,
    "totalTrades": 27,
    "dailyTrades": 0,
    "isFollower": false,
    "isLeader": false,
    "openPnl": 0.0000,
    "highestBalance": 150000.0000,
    "highestUnrealizedBalance": 150026.9000,
    "highestRealizedBalance": 150000.0000,
    "ineligible": false,
    "templateId": 7,
    "currentDayTrades": 0,
    "currentWeekTrades": 27,
    "accountName": "PRAC-V2-93360-86078286",
    "nickname": null,
    "userId": 93360,
    "startingBalance": 150000.0000,
    "balance": 149962.7400,
    "status": 0,
    "lockoutExpiration": null,
    "lockoutReason": null,
    "dailyTradeLimit": null,
    "weeklyTradeLimit": null,
    "marketDataLevel": 0,
    "accountId": 23310630,
    "winRate": 0.2593,
    "profitAndLoss": -37.2600,
    "startDate": "2026-05-22T13:23:30.477299+00:00",
    "closedDate": null,
    "dailyLoss": 0.0,
    "overrideDailyLossLimit": null,
    "overrideMaxLossLimit": null,
    "maximumLoss": 145500.0000,
    "drawDownLimit": 0.0000,
    "combineDailyLoss": 0.0000,
    "maxPositions": 0,
    "type": 1,
    "startOfDayBalance": 149962.7400,
    "combineName": "",
    "platformId": 0,
    "platformAccountId": null,
    "platformUserName": null,
    "maxMargin": 150000.0000,
    "minimumMll": null,
    "isSharing": false,
    "availableCash": null,
    "totalSubscriptionCost": 4.6500,
    "hasInsufficientFunds": false,
    "autoOcoBrackets": true,
    "bracketAutoApply": null,
    "bracketAmountToRisk": null,
    "bracketAmountToMake": null
  }
]
```

### Field reference

#### Identity
| Field | Type | Notes |
|-------|------|-------|
| `accountId` | number | Internal TopstepX account ID |
| `accountName` | string | Display name e.g. `50KTC-V2-93360-91313032` (template-funded-id-userid). `PRAC-…` = practice |
| `nickname` | string \| null | User-set label |
| `userId` | number | Owning user ID |
| `templateId` | number | Account template (1 = 50K Combine, 7 = Practice, etc.) |
| `type` | number | Account type code |
| `combineName` | string | Combine identifier (empty on practice) |
| `platformId` | number | 0 for default platform |
| `platformAccountId` | string \| null | External platform mapping |
| `platformUserName` | string \| null | External platform user |

#### Balance & P&L
| Field | Type | Notes |
|-------|------|-------|
| `startingBalance` | number | Initial account balance (e.g. 50000) |
| `balance` | number | Current account balance (realized) |
| `startOfDayBalance` | number | Balance at session open — basis for daily P&L |
| `profitAndLoss` | number | Lifetime realized P&L (`balance - startingBalance`) |
| `realizedDayPnl` | number | Today's realized P&L |
| `openPnl` | number | Unrealized P&L on open positions |
| `dailyLoss` | number | Today's loss (positive number) — basis for PDLL checks |
| `totalProfit` | number | Sum of winning trades (lifetime) |
| `totalLoss` | number | Sum of losing trades (negative, lifetime) |
| `winRate` | number | 0.0-1.0 fraction of winning trades |

#### Highs (used for trailing drawdown)
| Field | Type | Notes |
|-------|------|-------|
| `highestBalance` | number | Peak **realized** balance ever reached. Used by gateway to trail MLL upward |
| `highestRealizedBalance` | number | Usually equal to `highestBalance` |
| `highestUnrealizedBalance` | number | Peak realized + unrealized ever reached |

#### Drawdown & MLL (key for "blown" detection)
| Field | Type | Notes |
|-------|------|-------|
| `maximumLoss` | number | **Current MLL floor.** If `balance <= maximumLoss` → account blown. Trails up with `highestBalance` until the account reaches profit |
| `drawDownLimit` | number | Trailing drawdown allowance (e.g. 2000 on 50K Combine). 0 on this sample — populated based on account template |
| `maxMargin` | number | Margin cap for the account |
| `minimumMll` | number \| null | Floor for MLL (locks the trail once profit hits a threshold) |
| `combineDailyLoss` | number | Combine-specific daily-loss tally |

#### Daily-loss limits (PDLL — Personal Daily Loss Limit)
| Field | Type | Notes |
|-------|------|-------|
| `personalDailyLossLimit` | number \| null | User-set daily loss cap |
| `personalDailyLossLimitAction` | number | Action on hit (0 = none, otherwise lockout type) |
| `personalDailyLossLimitTrailing` | boolean | If true, PDLL trails with balance |
| `pdllTrailingType` | number | Trailing algorithm code |
| `pdllTrailingBalance` | number \| null | Current trailing reference |
| `pdllTrailingStartingBalance` | number \| null | Anchor for trailing PDLL |
| `personalDailyProfitTarget` | number \| null | User-set daily profit target |
| `personalDailyProfitTargetAction` | number | Action on hit (auto-lockout when target reached) |
| `overrideDailyLossLimit` | number \| null | Admin override |
| `overrideMaxLossLimit` | number \| null | Admin override |

#### Status & lockout
| Field | Type | Notes |
|-------|------|-------|
| `status` | number | 0 = active. Non-zero indicates suspended/closed |
| `ineligible` | boolean | True → account cannot trade (failed rules, pending review, etc.) |
| `closedDate` | string \| null | ISO timestamp when account was closed (non-null = blown / passed / closed) |
| `lockoutExpiration` | string \| null | ISO timestamp when current lockout ends |
| `lockoutReason` | string \| null | `"Personal"` (PDLL hit), `"DailyLoss"`, or other server-defined reason |
| `hasInsufficientFunds` | boolean | True if account can't cover margin/fees |
| `isSharing` | boolean | Account is being copy-traded |
| `isFollower` / `isLeader` | boolean | Copy-trading role |

#### Trading activity
| Field | Type | Notes |
|-------|------|-------|
| `totalTrades` | number | Lifetime trade count |
| `dailyTrades` | number | Trades today (may differ from `currentDayTrades` by counting method) |
| `currentDayTrades` | number | Round-trip trades today |
| `currentWeekTrades` | number | Round-trip trades this week |
| `dailyTradeLimit` | number \| null | Max trades per day (null = unlimited) |
| `weeklyTradeLimit` | number \| null | Max trades per week |
| `maxPositions` | number | Concurrent open-position cap (0 = unlimited) |

#### Bracket defaults
| Field | Type | Notes |
|-------|------|-------|
| `autoOcoBrackets` | boolean | Whether gateway-native brackets are enabled (toggled by `setAutoOcoBrackets`) |
| `bracketAutoApply` | boolean \| null | Auto-apply default bracket on entry |
| `bracketAmountToRisk` | number \| null | Default SL distance |
| `bracketAmountToMake` | number \| null | Default TP distance |

#### Misc
| Field | Type | Notes |
|-------|------|-------|
| `updatedAt` | string | ISO timestamp of last state change |
| `startDate` | string | ISO timestamp account was opened |
| `marketDataLevel` | number | Data subscription tier |
| `totalSubscriptionCost` | number | Monthly subscription fee charged to the account |
| `availableCash` | number \| null | Cash balance (live accounts only) |

### Deriving "blown" / drawdown UI

The endpoint doesn't return a single `isBlown` flag. Derive from these fields:

| Condition | Meaning |
|-----------|---------|
| `closedDate !== null` | Account permanently closed (blown, passed, or withdrawn) |
| `balance <= maximumLoss` | Hit MLL → blown |
| `ineligible === true` | Cannot place orders (rule violation pending, account under review) |
| `lockoutExpiration > now` | Temporarily locked (PDLL, manual, etc.) — check `lockoutReason` |
| `hasInsufficientFunds === true` | Margin/fee shortfall |

**Drawdown distance** = `balance - maximumLoss` (dollars to MLL).
**Daily distance** = `personalDailyLossLimit - dailyLoss` when PDLL set, else `startOfDayBalance - balance - drawDownLimit` for trailing accounts.

## Realtime (SignalR)

Two hubs proxied through the backend:

- **Market Hub** (`/hubs/market`): Quote subscriptions, depth data
- **User Hub** (`/hubs/user`): Order updates, position changes, account balance, trade fills

The backend proxies SignalR negotiate requests and upgrades WebSocket connections to the exchange, injecting the JWT as a query parameter.

## Key Behaviors

- All IDs are numeric but converted to strings at the adapter boundary
- Contract IDs follow CME format: `CON.F.US.ENQ.H26`
- Orders support native brackets (SL/TP attached to entry) for single-TP scenarios
- Suspended bracket orders arrive without prices — corrected via `pendingBracketInfo`
- Market hours: CME schedule (Sun 6pm – Fri 5pm ET, daily halt 5-6pm ET)

## Fee Normalization

ProjectX API reports `fees` and `commissions` on **every trade** (both entry and exit legs). TopstepX charges per leg, so the true round-trip cost = entry fees + exit fees.

The frontend accumulates both when building trade groups:
- `totalFees = exits.reduce(fees) + entry.fees`
- `totalCommissions = exits.reduce(commissions) + entry.commissions`

This handles partial fills correctly (each leg has its own proportional fee). No doubling in the backend — raw per-leg values are passed through unchanged.

## Bar Data — Dual-Endpoint Fallback

`marketData.ts` fetches historical bars from the primary TopstepX REST endpoint and automatically falls back to `chartapi.topstepx.com` when the primary has gaps or fails entirely. The frontend receives one merged response and renders once — it is unaware which endpoint was used.

### Endpoints

| Role | Method | URL |
|------|--------|-----|
| Primary | `POST` | `https://api.topstepx.com/api/History/retrieveBars` |
| Fallback | `GET` | `https://chartapi.topstepx.com/History/v2` |

### Fallback Decision Tree

```
retrieveBars(params)
│
├─ Call primary (POST /api/History/retrieveBars)
│   │
│   ├─ HTTP error or success=false
│   │   └─ HARD FAIL → fetch full range from chartapi → return
│   │
│   ├─ success=true, bars=[]
│   │   └─ PRIMARY EMPTY → fetch full range from chartapi
│   │       ├─ chartapi has bars → return chartapi bars
│   │       └─ chartapi also empty → return empty
│   │
│   └─ success=true, bars=[…]
│       │
│       ├─ latestBarTime + candlePeriod < endTime  (gap detected)
│       │   └─ SOFT GAP → fetch chartapi from (latestBar + 1 period) to endTime
│       │       ├─ gap filled → return [chartapiBars…, primaryBars…] (descending)
│       │       └─ supplement failed → return primary as-is
│       │
│       └─ no gap → return primary as-is
```

### Gap Detection

A gap is detected when the primary's most recent bar is stale by at least one candle period:

```
latestBarTime + candlePeriodMs < endTime
```

`candlePeriodMs` is derived from `unit` + `unitNumber` (Second=1, Minute=2, Hour=3, Day=4, Week=5, Month=6). The gap fetch starts from `latestBarTime + candlePeriodMs` to skip to the next expected candle, avoiding duplicate timestamps from chartapi's inclusive `From` boundary.

### Parameter Mapping (Primary → Fallback)

| Primary param | chartapi param | Conversion |
|---------------|----------------|------------|
| `contractId` (`CON.F.US.ENQ.M26`) | `Symbol` (`/NQ`) | `PRODUCT_TO_CHART_SYMBOL` map in `marketData.ts` |
| `unit` + `unitNumber` | `Resolution` | Second→`NS`, Minute→`N`, Hour→`N*60`, Day→`D`, Week→`W`, Month→`M`, Tick→`NT` |
| `startTime` (ISO) | `From` (Unix s) | `Math.floor(new Date(startTime).getTime() / 1000)` |
| `endTime` (ISO) | `To` (Unix s) | `Math.floor(new Date(endTime).getTime() / 1000)` |
| `limit` | `Countback` | Direct (omitted if not specified — chartapi returns full range) |
| `live` | `Live` | Boolean → `"true"/"false"` |
| — | `SessionId` | Always `"extended"` |

### Tick Bar Minimum (100T)

chartapi silently returns **1-minute bars** for tick resolutions below `100T` — no error, `code: 0`, wrong data. `fetchFromChartApi` rejects these early with an explicit error:

> `Tick resolution 50T rejected — chartapi minimum is 100T`

Verified resolutions: `100T`, `233T`, `500T`, `1000T`, `2000T`. Do not request `1T`–`99T`.

### Response Normalization

chartapi returns `{ bars: Bar[], code: number }`. Each bar is normalized to the primary format:

| chartapi field | Primary format | Conversion |
|----------------|----------------|------------|
| `t` (Unix ms) | `t` (ISO string) | `new Date(ms).toISOString()` |
| `o`, `h`, `l`, `c`, `v` | same | direct |
| `tv` (tick volume) | — | dropped |

### Supported Symbol Mappings

Configured in `PRODUCT_TO_CHART_SYMBOL` in `marketData.ts`:

| Contract product | chartapi Symbol |
|------------------|-----------------|
| `ENQ` | `/NQ` |
| `EP` | `/ES` |
| `MNQ` | `/MNQ` |
| `MES` | `/MES` |
| `MCL` | `/MCL` |
| `MGC` | `/MGC` |

Add entries here when onboarding new instruments.

### Debug Logging

All fallback paths write to `log/debug-YYYY-MM-DD.log` via `backend/src/utils/debugLog.ts`. Nothing is logged when the primary returns complete data.

| Tag | Condition |
|-----|-----------|
| `bars:hard-fail` | Primary threw HTTP error |
| `bars:chartapi-full` | Starting full-range chartapi fetch after hard fail |
| `bars:chartapi-full:ok` | Full fallback succeeded — logs bar count |
| `bars:primary-empty` | Primary returned 0 bars |
| `bars:chartapi-empty-fill:ok` | chartapi filled the empty — logs bar count |
| `bars:chartapi-empty-fill:fail` | chartapi also failed |
| `bars:soft-gap` | Gap detected — logs `latestBar`, `gapMs`, `periodMs` |
| `bars:soft-gap:filled` | Gap filled — logs `added` + `total` bar count |
| `bars:soft-gap:chartapi-empty` | Gap fetch returned 0 bars |
| `bars:soft-gap:fail` | Supplement threw — primary returned as-is |
| `bars:chartapi-unexpected` | chartapi returned unexpected shape — logs raw response |

## Adapter Files

```
backend/src/adapters/projectx/
├── index.ts       — createProjectXAdapter() factory
├── auth.ts        — JWT token management
├── accounts.ts    — Account listing
├── marketData.ts  — Bars (dual-endpoint fallback), contract search, contract by ID
├── orders.ts      — Place, cancel, modify, search open
├── positions.ts   — Search open positions
├── trades.ts      — Trade history search
└── realtime.ts    — SignalR negotiate + WebSocket upgrade proxy
```
