# Hyperliquid Integration

## Overview

Hyperliquid is a high-performance L1 blockchain DEX supporting perpetual futures, spot trading, and real-world asset (RWA) exposure. This terminal integrates with Hyperliquid via its REST and WebSocket APIs — no third-party SDK.

**Network**: Testnet only (initially)
- Testnet REST: `https://api.hyperliquid-testnet.xyz`
- Testnet WebSocket: `wss://api.hyperliquid-testnet.xyz/ws`
- Mainnet REST: `https://api.hyperliquid.xyz`
- Mainnet WebSocket: `wss://api.hyperliquid.xyz/ws`

---

## Authentication

Hyperliquid uses **private key signing** (EIP-712 typed data) instead of API keys.

- Private key stored server-side only (never sent to browser)
- `viem` library handles `privateKeyToAccount()` + EIP-712 signing
- Every exchange request is signed with a nonce (millisecond timestamp)
- Nonces must be unique and within a 2-day historical / 1-day forward window

### API Wallets (Agent Wallets)

For production use, Hyperliquid supports permissioned "agent wallets" that can trade but cannot withdraw. These are recommended for automated trading.

---

## API Endpoints

### Info Endpoint (read-only)

`POST /info` — single endpoint, `type` field selects the query.

| Type | Purpose |
|------|---------|
| `meta` | All perpetual market metadata (universe) |
| `allMids` | Current mid prices for all assets |
| `clearinghouseState` | Account balances, positions, margin |
| `openOrders` | Open orders for a user |
| `userFills` | Fill history |
| `candleSnapshot` | OHLCV bar data |
| `l2Book` | Order book depth |
| `spotMeta` | Spot market metadata |
| `spotClearinghouseState` | Spot balances |

### Exchange Endpoint (write, requires signing)

`POST /exchange` — all trading actions, signed with private key.

| Action | Purpose |
|--------|---------|
| `order` | Place order (limit, IOC/market, trigger) |
| `cancel` | Cancel order by ID |
| `modify` | Modify existing order |
| `batchModify` | Batch modify orders |
| `updateLeverage` | Set cross/isolated margin + leverage |
| `usdTransfer` | Transfer USDC between spot and perp |

### WebSocket

`wss://api.hyperliquid-testnet.xyz/ws`

Subscribe via JSON: `{ "method": "subscribe", "subscription": { "type": "...", ... } }`

| Subscription | Purpose |
|-------------|---------|
| `allMids` | All mid prices (no params) |
| `l2Book` | Order book for a coin |
| `candle` | OHLCV candle updates |
| `trades` | Trade feed for a coin |
| `bbo` | Best bid/offer |
| `orderUpdates` | User order status changes |
| `userFills` | User fill events |
| `userEvents` | Fills, funding, liquidations |

---

## Instrument Types

### Perpetual Futures (primary)
- 150+ markets: BTC, ETH, SOL, and many more
- 24/7 trading, hourly funding rates
- Asset ID = universe index (0-based integer)

### Tradfi / HIP-3 (Real-World Assets)
- US equities: NVDA, TSLA, AAPL, MSFT, AMZN, GOOGL, etc.
- Commodities: WTI (oil), Silver
- Pre-IPO: Anthropic, SpaceX, OpenAI
- Trade exactly like perps (same API, same margin system)

### Spot Markets
- Trading pairs: PURR/USDC, HYPE/USDC, etc.
- Separate balance management from perps
- Asset ID = `10000 + index`

---

## Order Types

| Type | Implementation |
|------|---------------|
| **Market** | IOC limit order at best price +/- slippage |
| **Limit** | Standard limit, GTC by default |
| **Stop Market** | Trigger order → market on trigger |
| **Stop Limit** | Trigger order → limit on trigger |
| **Take Profit** | Trigger on favorable price move |
| **ALO (Post-Only)** | Added liquidity only, no taker |

### Order Modifiers
- **GTC** — Good til cancel
- **IOC** — Immediate or cancel
- **ALO** — Post-only (maker only)
- **Reduce Only** — Only reduces position

### Constraints
- Minimum order value: $10
- Price: up to 5 significant figures
- Size: must match asset's `szDecimals`
- Max leverage: varies by asset (up to 50x for BTC)

---

## Rate Limits

- Address-based rate allocation
- 1000 WebSocket subscriptions per IP
- Stale `expiresAfter` on cancel costs 5x rate limit
- Query `userRateLimit` to monitor usage

---

## Mapping to Terminal Adapter Interface

| Adapter Method | Hyperliquid API Call |
|---------------|---------------------|
| `auth.connect()` | `privateKeyToAccount(key)` — derive wallet |
| `accounts.list()` | `POST /info { type: 'clearinghouseState' }` |
| `marketData.searchContracts()` | `POST /info { type: 'meta' }` + filter |
| `marketData.retrieveBars()` | `POST /info { type: 'candleSnapshot' }` |
| `orders.place()` | `POST /exchange { action: { type: 'order' } }` |
| `orders.cancel()` | `POST /exchange { action: { type: 'cancel' } }` |
| `orders.modify()` | `POST /exchange { action: { type: 'modify' } }` |
| `orders.searchOpen()` | `POST /info { type: 'openOrders' }` |
| `positions.searchOpen()` | `POST /info { type: 'clearinghouseState' }` |
| `trades.search()` | `POST /info { type: 'userFills' }` |
| Realtime quotes | WS subscribe `allMids` + `l2Book` |
| Realtime orders | WS subscribe `orderUpdates` |
| Realtime positions | WS subscribe `userEvents` |

---

## References

- [Hyperliquid API Docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api)
- [Info Endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [Exchange Endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)
- [WebSocket](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket)
- [Order Types](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/order-types)
- [Nonces & API Wallets](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets)
