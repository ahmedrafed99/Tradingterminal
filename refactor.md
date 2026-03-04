# Multi-Exchange Refactor Plan

Goal: abstract the codebase away from ProjectX/TopstepX so a second exchange (crypto spot/perp) can be added later. **ProjectX remains the only implementation** until the abstraction is validated.

---

## Phase 1 — Internal Enums & Types ✅

Replace all raw numeric literals with named enums/constants. No behavior change, just readability and a future translation boundary.

### What changes

| Raw value | Meaning | Used in |
|---|---|---|
| `type: 1 \| 2 \| 4 \| 5` | Limit / Market / Stop / TrailingStop | orderService, orderRoutes, bracketEngine, order panel, chart-trading |
| `side: 0 \| 1` | Buy / Sell | orderService, orderRoutes, bracketEngine, order panel, overlay labels |
| `status: 6, 2, ...` | Pending / Filled / ... | bracketEngine, realtimeService, order event handlers |
| `type: 1 \| 2` (position) | Long / Short | realtimeService, position display, overlay labels |
| `type: 3-8` (depth) | BestAsk / BestBid / VolumeAtPrice / Reset / ... | volume profile, depth handlers |
| `TICKS_PER_POINT = 4` | Futures-specific tick constant | bracket.ts, bracket settings UI |

### Approach

- Create a shared `enums.ts` (or `types/exchange.ts`) with `OrderType`, `OrderSide`, `OrderStatus`, `PositionType`, `DepthType` enums.
- Replace every raw literal with the enum value.
- ProjectX adapter (later) will map these enums to/from the gateway's numeric values.
- Make `TICKS_PER_POINT` instrument-driven (read from contract metadata) instead of a global constant.

### Validation

App behavior is identical. TypeScript compiler catches any missed spots.

---

## Phase 2 — Backend Exchange Adapter ✅

Extract ProjectX-specific logic behind interfaces so the Express routes become exchange-agnostic.

### What was done

- Created `backend/src/adapters/types.ts` with `ExchangeAdapter` interface composed of `ExchangeAuth`, `ExchangeAccounts`, `ExchangeMarketData`, `ExchangeOrders`, `ExchangeTrades`, `ExchangeRealtime`.
- Created `backend/src/adapters/registry.ts` — singleton holder (`getAdapter`/`setAdapter`/`clearAdapter`/`isConnected`).
- Moved all ProjectX logic into `backend/src/adapters/projectx/` (auth, accounts, marketData, orders, trades, realtime).
- All routes now call `getAdapter().domain.method()` instead of axios directly.
- `authRoutes.ts` creates the adapter on connect via `createProjectXAdapter()` and registers it.
- SignalR negotiate proxy + WS upgrade handler extracted from `index.ts` into the adapter.
- Deleted `backend/src/auth.ts` — logic lives in `adapters/projectx/auth.ts`.
- `tsc --noEmit` compiles clean. No route URLs, request shapes, or response shapes changed.

---

## Phase 3 — Realtime Adapter (Frontend) ✅

Abstract `realtimeService.ts` so the transport (SignalR vs plain WebSocket) and event shapes are behind an interface.

### What was done

- Created `frontend/src/adapters/types.ts` with `RealtimeAdapter` interface and canonical data types (`Quote`, `DepthEntry`, `RealtimeOrder`, `RealtimePosition`, `RealtimeAccount`, `RealtimeTrade`) plus handler type aliases.
- Created `frontend/src/adapters/registry.ts` — singleton holder (`getRealtimeAdapter`/`setRealtimeAdapter`/`clearRealtimeAdapter`).
- Moved all SignalR logic into `frontend/src/adapters/projectx/realtimeAdapter.ts` as `ProjectXRealtimeAdapter implements RealtimeAdapter`. SignalR-specific helpers (`UserHubItem<T>`, `normalizeUserHubArgs`) are file-private.
- Created `frontend/src/adapters/projectx/index.ts` — `createProjectXRealtimeAdapter()` factory.
- Rewrote `frontend/src/services/realtimeService.ts` as a thin delegating facade that proxies all calls to the active adapter and re-exports types for backward compatibility (`GatewayQuote` is a type alias for `Quote`).
- Zero consumer file changes — all 7 files importing from `realtimeService` work unchanged.
- `@microsoft/signalr` is now only imported in the ProjectX adapter file.
- `tsc --noEmit` compiles clean for both frontend and backend.

### Why this is the hardest piece

- SignalR has built-in reconnection, hub multiplexing, and negotiate flow. Plain WebSocket needs all of that manually.
- The backend SignalR proxy (`index.ts` lines 43-127) is also exchange-specific — it would need a parallel path for crypto WS proxying (or direct browser-to-exchange connections).

---

## Phase 4 — Instrument Model Generalization ✅

Make the `Contract` type flexible enough for both futures and crypto instruments.

### What was done

- Extended `Contract` in `marketDataService.ts` with optional computed fields: `ticksPerPoint`, `quantityStep`, `pricePrecision`, `quantityPrecision`. Populated by `normalizeContract()` on search/list responses (defaults match MNQ futures).
- Created `frontend/src/utils/instrument.ts` with centralized helpers: `getTicksPerPoint()`, `pointsToPrice()`, `priceToPoints()`, `pointsToTicks()`, `calcPnl()`.
- Removed the hardcoded `TICKS_PER_POINT = 4` constant from `types/bracket.ts`. All conversions now use instrument-derived `contract.ticksPerPoint`.
- Replaced ~30 inline P&L formulas (`(diff / tickSize) * tickValue * size`) with `calcPnl()` across 5 files: `useOverlayLabels.ts` (12 sites), `useQuickOrder.ts` (4), `useOrderLines.ts` (1), `TopBar.tsx` (1), `PositionDisplay.tsx` (1).
- Changed `bracketEngine.ts` from `tickSize: number` to `contract: Contract` — uses imported `pointsToPrice()` instead of a local copy.
- Updated `buildNativeBracketParams()` to accept `contract` as third arg — uses `pointsToTicks()` instead of `points * TICKS_PER_POINT`.
- Updated all callers: `BuySellButtons.tsx`, `useQuickOrder.ts`, `useOverlayLabels.ts`.
- Added TODO Phase 6 comments for fractional quantity support in `orderRoutes.ts`, `ContractsSpinner.tsx`, `useStore.ts`.
- Updated bracket engine tests (`bracketEngine.test.ts`) to pass `contract: mockContract` instead of `tickSize: 0.25`.
- `tsc --noEmit` clean for both frontend and backend. All previously passing tests still pass.

### Key design note

The P&L formula `(priceDiff / tickSize) * tickValue * size` is universal — for crypto, the gateway returns `tickValue == tickSize`, so it naturally simplifies to `priceDiff * size`. No branching needed.

---

## Phase 5 — UI Flexibility

Update UI components to handle exchange differences gracefully.

### What changes

- **Order panel**: support fractional sizes (step size from instrument metadata), show exchange-specific order types.
- **Settings modal**: exchange selector + exchange-specific credential fields (username+apiKey for ProjectX, apiKey+secret for crypto).
- **Pinned instruments**: default set becomes exchange-aware (not hardcoded `['NQ', 'MNQ']`).
- **Instrument selector**: search/display adapts to exchange naming (futures contracts with expiry vs perpetual pairs).
- **P&L display**: quote currency label (USD for futures, USDT/USDC for crypto).
- **Position display**: additional fields for perps (liquidation price, leverage, margin type) — hidden for futures.

### Validation

ProjectX UI unchanged. New fields/options only appear when a crypto exchange is active.

---

## Phase 6 — Add Crypto Exchange

With the abstraction validated against ProjectX, implement the second adapter.

### New code

- `backend/src/adapters/crypto/` — auth (HMAC signing), REST client, WS client.
- `frontend/src/adapters/crypto/` — `CryptoRealtimeAdapter` (plain WebSocket, normalizes into internal types).
- Exchange-specific instrument search, order placement, position tracking.

### Crypto-specific concerns

- **Spot vs Perp**: spot has no positions (just balances), perp has positions with funding/liquidation.
- **Rate limits**: crypto APIs have strict rate limits per IP/key — need throttling.
- **Signing**: every request needs HMAC-SHA256 signature with timestamp and recv_window.
- **WebSocket keepalive**: most crypto exchanges require periodic pings or the connection drops.
- **Order acknowledgment**: crypto exchanges return order ID synchronously but fill events come async — similar to current flow, should map cleanly.

---

## What Stays Untouched

These layers are already exchange-agnostic:

- Chart rendering (lightweight-charts)
- Drawing tools
- Screenshot system
- Dual chart layout
- Toast system
- Design system / styling
- Volume profile rendering (just needs data in the right shape)

---

## Open Questions

- Do we support multiple exchanges connected simultaneously, or one at a time?
- For crypto spot (no positions), do we show a "balances" tab instead of positions?
- Should bracket engine support crypto-native SL/TP (some exchanges support it natively)?
- WebSocket: proxy through backend (like SignalR today) or connect directly from browser?
