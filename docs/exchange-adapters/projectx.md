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
