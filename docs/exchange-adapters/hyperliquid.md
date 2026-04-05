# Hyperliquid Adapter

## Overview

Hyperliquid is a high-performance L1 DEX for perpetual futures, spot, and real-world asset trading.
The adapter integrates via direct REST + WebSocket — no SignalR, no third-party SDK.

- **Testnet REST/WS**: `https://api.hyperliquid-testnet.xyz`
- **Mainnet REST/WS**: `https://api.hyperliquid.xyz`
- **Auth**: EIP-712 per-request signing via a private key (viem)
- **Realtime**: native WebSocket multiplexed at `/ws/hl` (no SignalR negotiate)

---

## Key Differences from ProjectX

| Aspect | ProjectX | Hyperliquid |
|--------|----------|-------------|
| Auth | API key → JWT (stored between calls) | Private key → EIP-712 signature per request |
| Realtime | SignalR dual hubs (`/hubs/market`, `/hubs/user`) | Native WebSocket at `/ws/hl` |
| IDs | Numeric, converted to string | Coin symbols (`BTC`, `ETH`) + oid (`BTC:12345`) |
| Instrument IDs | `CON.F.US.ENQ.H26` | `BTC`, `ETH`, `NVDA` |
| Market hours | CME schedule | 24/7 |
| Quantities | Integer contracts | Decimal (szDecimals from meta) |
| Market orders | Native market type | IOC limit at mid ± 5% slippage |
| Brackets | Tick offsets relative to fill | Absolute prices, multi-TP supported |
| Tick size | From exchange metadata | From `szDecimals` — NOT from `markPx` string format |
| Price precision | Exchange-defined | Max 5 significant figures |
| Open orders | Single endpoint | `frontendOpenOrders` (includes trigger orders) |

---

## State Isolation

Every sub-module is a **factory function** — all mutable state lives in a closure created by
`createHyperliquidAdapter()`. Nothing is stored at module scope.

```
createHyperliquidAdapter()
  └── state = { privateKey, walletAddress, connected, isTestnet, apiUrl }
        ├── createClient(state)       ← HTTP + signing
        ├── createAuth(state)
        ├── createAccounts(client)
        ├── createMarketData(client)
        ├── createOrders(client, state)
        ├── createPositions(client, state)
        ├── createTrades(client, state)
        └── createRealtime(state)
```

Two calls to `createHyperliquidAdapter()` produce two fully isolated adapters that cannot
share or pollute each other.

---

## File Structure

```
backend/src/adapters/hyperliquid/
├── index.ts        createHyperliquidAdapter() — the only public export
├── client.ts       HTTP client (info + exchange), EIP-712 signing, floatToWire
├── auth.ts         Private key → viem account derivation
├── accounts.ts     clearinghouseState → normalized account list
├── marketData.ts   meta/candleSnapshot → Contract, Bar
├── orders.ts       place/cancel/modify/searchOpen with full normalization
├── positions.ts    clearinghouseState → normalized positions
├── trades.ts       userFills → normalized trades
└── realtime.ts     Native WebSocket multiplexer at /ws/hl
```

---

## Auth Flow

```
POST /auth/connect { exchange: 'hyperliquid', credentials: { privateKey: '0x...' } }
  → createHyperliquidAdapter()
  → adapter.auth.connect({ credentials: { privateKey } })
      → privateKeyToAccount(privateKey)  ← viem, no network call
      → state.walletAddress = account.address
      → state.connected = true
  → setAdapter('hyperliquid', adapter)
```

No token refresh needed. Every exchange action is signed with a fresh nonce at call time.

---

## Signing

Every write action (`POST /exchange`) is signed using EIP-712:

1. `actionHash = keccak256(msgpack(action) + nonce_8bytes_bigendian + 0x00)`
2. Sign phantom agent: `{ source: 'a' (mainnet) | 'b' (testnet), connectionId: actionHash }`
3. Domain: `{ name: 'Exchange', version: '1', chainId: 1337, verifyingContract: 0x000...0 }`
4. Split signature: `{ r, s, v }` from viem's 65-byte hex output

Nonce = `Date.now()` — must be unique, within ±2 days of server time.

---

## Realtime: WebSocket Multiplexer

The backend runs a single upstream WebSocket to `wss://api.hyperliquid[-testnet].xyz/ws` and
multiplexes it to all connected browser clients at `/ws/hl`.

```
Browser A ─┐
Browser B ─┼──► /ws/hl ──► HL upstream WS ──► forward to all browsers
Browser C ─┘               (stays alive across page refreshes)
```

**Key behaviors**:
- Upstream is opened on first browser connect; stays alive across page refreshes
- Upstream is only closed when the last browser disconnects
- On re-subscribe (new client or reconnect), all stored subscriptions are re-sent
- Subscription dedup uses canonical JSON (sorted keys) as map key

---

## Order IDs

HL uses numeric order IDs (`oid`) per coin. The adapter normalizes these to `COIN:OID` strings
(e.g., `BTC:12345`) for consistency with the rest of the system. The cancel/modify endpoints
parse this back to `{ coin, oid }` internally.

---

## Open Orders

`searchOpen` uses `frontendOpenOrders` (not `openOrders`). The difference:

- `openOrders` — resting limit orders only, no trigger orders
- `frontendOpenOrders` — all open orders including trigger (TP/SL) orders

The normalized order shape includes `isTrigger: boolean` and `orderType: string` (e.g.,
`"Limit"`, `"Stop Market"`, `"Take Profit Market"`) from HL's response.

---

## Bracket Orders

### Single TP + SL — atomic

When exactly one TP and one SL are specified, the adapter sends all three orders in a single
atomic `POST /exchange` using `grouping: "normalTpsl"`:

```
entry order   → [0]
TP trigger    → [1]  tpsl: "tp", isMarket: true, reduceOnly: true
SL trigger    → [2]  tpsl: "sl", isMarket: true, reduceOnly: true
```

All three orders are created or none are. HL returns `waitingForFill` for the TP/SL
while the entry order is resting.

> **Note**: the grouping string is `"normalTpsl"` (lowercase s) — not `"normalTpSl"`.
> The Rust serde deserializer is case-sensitive; the wrong case causes HTTP 422.

### Multiple TPs

When two or more TP legs are specified, `normalTpsl` is not used (it only supports one TP).
Instead the adapter places the entry first, then all bracket legs in one batched `na` call:

```typescript
// place() schema
{
  contractId: 'BTC',
  type: OrderType.Limit,
  side: OrderSide.Buy,
  size: 0.002,
  limitPrice: 60000,
  stopLossBracket: { price: 58000 },           // one SL
  takeProfitBrackets: [
    { price: 65000, size: 0.001 },             // TP1 — explicit size
    { price: 70000, size: 0.001 },             // TP2 — explicit size
  ],
}

// If size is omitted from TP legs, the entry size is split equally:
takeProfitBrackets: [{ price: 65000 }, { price: 70000 }]
// → each TP gets size / 2
```

The SL always covers the full entry size. As TP legs fill and reduce the position, HL
automatically adjusts the effective SL size.

### Modifying a TP or SL

Use the standard `modify` endpoint with the TP/SL's `orderId`. The adapter reads the
existing order's `orderType` from `frontendOpenOrders` to determine whether it is a TP or SL,
then performs cancel-and-replace preserving the correct `tpsl` flag.

```typescript
await adapter.orders.modify({
  accountId: '',
  orderId: 'BTC:51234567',   // TP order ID from searchOpen
  stopPrice: 68000,           // new trigger price
});
```

### Cancelling individual legs

Each TP and SL is a real resting order with its own ID. Cancel any leg independently:

```typescript
await adapter.orders.cancel({ accountId: '', orderId: 'BTC:51234567' });
// remaining TPs and SL are unaffected
```

---

## Verification

Run the integration test against testnet:

```bash
HL_PRIVATE_KEY=0xYOUR_KEY npx tsx backend/test-hl.ts
```

88 assertions across 20 sections:

| Section | Coverage |
|---------|----------|
| 1 | floatToWire + roundToSigFigs edge cases |
| 2 | Auth error handling (bad key, order without connect) |
| 3 | Auth lifecycle: connect, disconnect, reconnect |
| 4 | Accounts: balance, simulated flag |
| 5 | Market data: search, bars, availableContracts |
| 6 | Place limit order + searchOpen |
| 7 | Modify limit order (batchModify) |
| 8 | Cancel order + cancel non-existent error |
| 9 | Below-minimum order rejection |
| 10 | Invalid contract error |
| 11 | Market order (IOC at mid ± 5%) |
| 12 | Open positions after fill |
| 13 | 1 TP + 1 SL via atomic normalTpsl |
| 14 | 2 TPs + 1 SL — equal size split |
| 15 | 2 TPs with explicit sizes |
| 16 | Modify TP trigger price |
| 17 | Cancel individual TP — other orders survive |
| 18 | Cancel SL — TPs survive |
| 19 | Trade history (userFills) |
| 20 | Adapter isolation (two independent instances) |
