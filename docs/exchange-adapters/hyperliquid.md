# Hyperliquid Adapter

## Overview

Hyperliquid is a high-performance L1 DEX for perpetual futures, spot, and RWA trading. Uses direct REST + WebSocket (no SignalR).

- **Testnet REST**: `https://api.hyperliquid-testnet.xyz`
- **Testnet WebSocket**: `wss://api.hyperliquid-testnet.xyz/ws`
- **Auth**: Private key → EIP-712 typed data signing via `viem`

For full API reference, see [docs/crypto/hyperliquid/README.md](../crypto/hyperliquid/README.md).

## Status

**Not yet implemented.** The adapter infrastructure is ready (factory, registry, types) but `backend/src/adapters/hyperliquid/` and `frontend/src/adapters/hyperliquid/` do not exist. A full implementation was built and then reverted — see "Previous Implementation" below for the commit history, lessons learned, and audit of issues to fix.

## Planned Adapter Files

```
backend/src/adapters/hyperliquid/
├── index.ts       — createHyperliquidAdapter() factory
├── client.ts      — Axios + viem signing wrapper, nonce management
├── auth.ts        — Private key storage, wallet derivation
├── accounts.ts    — clearinghouseState → normalized account
├── marketData.ts  — meta, candleSnapshot → Contract, bars
├── orders.ts      — order/cancel/modify with EIP-712 signing
├── positions.ts   — clearinghouseState → positions
├── trades.ts      — userFills → normalized trades
└── realtime.ts    — Native WebSocket proxy at /ws/hyperliquid
```

## Key Differences from ProjectX

| Aspect | ProjectX | Hyperliquid |
|--------|----------|-------------|
| Auth | API key → JWT | Private key → per-request signing |
| Realtime | SignalR (dual hubs) | Native WebSocket |
| IDs | Numeric (converted to string) | String (coin symbols) |
| Contract format | `CON.F.US.ENQ.H26` | `BTC`, `ETH`, `NVDA` |
| Market hours | CME schedule | 24/7 |
| Quantities | Integer (contracts) | Decimal (e.g., 0.001 BTC) |
| Market orders | Native market type | IOC limit at best price |
| Brackets | Native SL/TP on entry | Separate trigger orders |
| Contract expiry | Quarterly rollover | Perpetual (never expires) |

## Instrument Categories

Hyperliquid serves three top-level instrument selector categories:

- **Perpetuals** → sub-filters: All, Crypto, Tradfi, HIP-3, Trending, Pre-launch
- **Spot** → sub-filter: Spot
- **Stocks** → sub-filter: Tradfi

## Re-Implementation Reference

A full Hyperliquid integration was built and then reverted due to architectural issues. The commits are still reachable and serve as a starting point — but the "Audit" section below lists the problems that must be fixed before re-implementing. Do not just re-apply these commits.

| SHA | Description |
|-----|-------------|
| `be5f615` | Add Hyperliquid backend adapter (tested against testnet) |
| `8c998ea` | Fix Hyperliquid adapter audit issues and update docs |
| `692b77d` | Route all backend endpoints through exchange-aware adapter lookup |
| `255dfba` | Add exchange metadata types and activeExchange to frontend store |
| `62360b7` | Fix: Hyperliquid getStatus() uses apiUrl instead of baseUrl |
| `b602722` | Add Hyperliquid as data feed provider in Settings modal |
| `0d7c2da` | Update data feed settings docs for multi-provider support |
| `4a8a967` | Pass exchange param through market data service and normalize responses |
| `6e789cc` | Remember last contract per exchange, persist across refreshes |
| `4c504e2` | Add Hyperliquid backend WebSocket proxy for realtime data |
| `ee65607` | Add live price streaming for Hyperliquid via WebSocket |
| `c683890` | Wire order placement, positions, and market hours for Hyperliquid |
| `389b106` | Update exchange adapter docs: explain frontend architecture |
| `f57f23d` | Polish UI for multi-exchange: market hours, currency, quantities, ping |
| `b2126b1` | Update docs for multi-exchange UI changes |
| `0a5a1b0` | Adapt order panel for crypto: Size label, hide brackets, USDC currency |
| `fa778c9` | Add crypto size selector with USD/coin toggle and % slider |
| `c3f3229` | Clamp fractional order size to integer when switching to futures |
| `716c981` | Add Hyperliquid bracket support and fix tick size rounding |

### Key lessons from this implementation

- **Tick size rounding**: Hyperliquid enforces max 5 significant figures on prices. Use `roundToSigFigs(price, 5)`, not decimal-place rounding. The `markPx` string's trailing zeros do NOT reliably indicate tick precision.
- **Native brackets**: Hyperliquid supports `grouping: 'normalTpSl'` to send entry + TP + SL atomically (3 order wires). This is preferred over client-side bracket engine for simple 1SL+1TP cases.
- **Order modify**: `batchModify` only works for limit orders. Trigger order modifications (SL move/resize) require cancel-and-replace. The modify endpoint must auto-lookup `contractId`/`side`/`size` from open orders when not provided.
- **WebSocket order events**: Subscribe to `orderUpdates` with `{ type: 'orderUpdates', user: walletAddress }`. Events arrive as `{ order: { coin, oid, side, sz, ... }, status: 'filled'|'open'|'canceled' }`. Order IDs use `SYMBOL:OID` format.

### Audit: issues to fix in re-implementation

#### Architecture

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | **Exchange-specific logic leaks into shared code** — hardcoded `activeExchange === 'projectx'` / `!== 'projectx'` checks scattered across `placeOrderWithBrackets.ts`, `orderService.ts`, `BuySellButtons.tsx` | Frontend shared services | Adding a 3rd exchange requires editing every shared file |
| 2 | **Duplicate bracket params in Zod schema** — `stopLossBracket`/`takeProfitBracket` (ProjectX ticks format) AND `bracketSlPrice`/`bracketTpPrice` (Hyperliquid absolute prices) coexist | `orderRoutes.ts` | Contradictory API contract; confusing which to use |
| 3 | **Response normalization is inconsistent** — `/orders/place` route has Hyperliquid-specific `if (data?.status === 'ok')` normalization, `/orders/modify` returns raw data, cancel returns partial | `orderRoutes.ts:38-58` | Frontend gets different shapes per exchange per endpoint |
| 4 | **`modifyOrder()` doesn't send exchange param** — `placeOrder` and `cancelOrder` add `exchange` to body, but `modifyOrder` does not | `orderService.ts:80` | Modify always hits default exchange, even after switching |
| 5 | **Global mutable state in client.ts** — `baseUrl`, `isTestnet`, `account`, `connected` are module-level lets | `client.ts:18-21` | No multi-session support; race conditions if two callers |

#### Fragile patterns

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 6 | **Tick size derived from mark price string format** — `derivePricePrecision()` counts decimal places of `ctx.markPx` | `marketData.ts:36-42` | If API changes string formatting, all price rounding breaks silently |
| 7 | **`floatToWire()` can produce scientific notation** — `parseFloat(x.toFixed(8)).toString()` on very small numbers outputs `"1e-9"` | `client.ts:154` | Hyperliquid API rejects scientific notation |
| 8 | **JSON key ordering for subscription dedup** — `JSON.stringify(subscription)` used as map key; key order not guaranteed | `realtime.ts:57` | Duplicate subscriptions if object is constructed differently |
| 9 | **`allMids` subscribed once per coin** — reconnect loop sends `sendSubscribe('allMids')` inside `for (coin of subscribedQuotes)` | `realtimeAdapter.ts:60-62` | N redundant subscription messages |

#### Type safety

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 10 | **`as any` casts** on contract lookups, candle data, message handling | `orders.ts:39`, `marketData.ts:96`, `realtimeAdapter.ts:103` | Silent breakage if shapes change |
| 11 | **`limitPrice` checked with `!limitPrice`** instead of `!= null` — `0` is falsy but valid | `orders.ts:104` | Cannot place limit at price 0 (edge case) |
| 12 | **Unknown order statuses default to `Working`** — `mapOrderStatus()` falls through silently | `realtimeAdapter.ts:186-192` | New Hyperliquid statuses treated as active orders |

#### Error handling

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 13 | **All errors mapped to HTTP 502** in `withConnection` — client errors (bad params) return same status as server errors | `withConnection.ts:24-27` | Frontend can't distinguish user error from exchange outage |
| 14 | **Error chain lost** — `wrapAxiosError` creates new Error, original stack trace gone | `client.ts:47-56` | Hard to debug; no `.cause` chain |
| 15 | **Nonce incremented before signing** — if `signTypedData()` fails, nonce is wasted | `client.ts:135-148` | Nonce space leak; potential rejection after many failures |
| 16 | **Malformed WS messages silently dropped** — no logging in catch blocks | `realtimeAdapter.ts:76`, `realtime.ts:95` | Protocol issues invisible |

#### State management

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 17 | **Quote OHLC never resets** — `high`/`low`/`volume` accumulate from first connection, never reset at session/day boundary | `realtimeAdapter.ts:97-129` | Misleading daily stats after reconnect |
| 18 | **`pendingBracketInfo` uses `lastPrice` as guess** for market order entry price — could be stale | `placeOrderWithBrackets.ts:60` | Bracket preview lines show wrong SL/TP prices |
| 19 | **Preview state not rolled back on order failure** — `previewHideEntry: true` persists after failed order | `placeOrderWithBrackets.ts:88-95` | Phantom bracket lines remain on chart |
| 20 | **`refreshOrdersAfterDelay` uses arbitrary 500ms** — may be too early (order not settled) or too late (stale UI) | `orderService.ts:30` | Race condition with server processing |

#### Modify endpoint

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 21 | **Missing fields default to 0** — `size ?? 0`, `limitPrice ?? 0` when not provided | `orders.ts:252-257` (reverted) | Drag-modify sends size=0, cancelling the order |
| 22 | **Stop order modify hardcodes `reduceOnly: true`** — original flag not preserved | `orders.ts:198` (reverted) | User's regular stop becomes reduce-only without consent |
| 23 | **Multiple redundant `openOrders` lookups** — fetches open orders up to 3 times in one modify call | `orders.ts:147-248` (reverted) | Unnecessary API calls; latency |

#### WebSocket proxy

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 24 | **`connectUpstream()` duplicates close logic** from `closeUpstream()` | `realtime.ts:11-22` | Code duplication; inconsistent cleanup |
| 25 | **First client triggers fresh upstream** — `closeUpstream()` then `connectUpstream()` when `clients.size === 1` | `realtime.ts:82-88` | Kills existing upstream for all clients on page refresh |
