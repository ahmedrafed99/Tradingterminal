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

## Adapter Files

```
backend/src/adapters/projectx/
├── index.ts       — createProjectXAdapter() factory
├── auth.ts        — JWT token management
├── accounts.ts    — Account listing
├── marketData.ts  — Bars, contract search, contract by ID
├── orders.ts      — Place, cancel, modify, search open
├── positions.ts   — Search open positions
├── trades.ts      — Trade history search
└── realtime.ts    — SignalR negotiate + WebSocket upgrade proxy
```
