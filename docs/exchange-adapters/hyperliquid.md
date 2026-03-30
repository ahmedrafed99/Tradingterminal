# Hyperliquid Adapter

## Overview

Hyperliquid is a high-performance L1 DEX for perpetual futures, spot, and RWA trading. Uses direct REST + WebSocket (no SignalR).

- **Testnet REST**: `https://api.hyperliquid-testnet.xyz`
- **Testnet WebSocket**: `wss://api.hyperliquid-testnet.xyz/ws`
- **Auth**: Private key → EIP-712 typed data signing via `viem`

For full API reference, see [docs/crypto/hyperliquid/README.md](../crypto/hyperliquid/README.md).

## Adapter Files

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
