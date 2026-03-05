# Feature: Bracket Engine (Runtime)

Client-side singleton service that manages SL + multi-TP bracket orders after entry fill. Separate from the bracket settings UI modal — this is the **runtime execution engine**.

**Status**: Implemented

---

## Native vs Client-Side Brackets

The ProjectX gateway supports atomic bracket placement (SL + 1 TP attached to the entry order) when "Auto OCO Brackets" is enabled. The app uses a **dual-path strategy**:

| TPs | Path | Latency gap | Managed by |
|-----|------|-------------|------------|
| 0-1 | **Gateway-native brackets** | Zero — atomic with entry | Gateway (OCO auto-cancel) |
| 2+  | **Client-side bracket engine** | Brief — orders placed after fill | `bracketEngine.ts` |

`buildNativeBracketParams()` in `types/bracket.ts` decides which path: returns bracket params for <= 1 TP, returns `null` for 2+ TPs (triggering the engine).

### Why client-side for 2+ TPs?

The gateway only supports **one** TP per bracket. For multi-TP setups, **all brackets (SL + TPs) are placed as separate orders** after detecting the entry fill via SignalR.

---

## File

`frontend/src/services/bracketEngine.ts` — singleton, imported by `OrderPanel.tsx`, `BuySellButtons.tsx`, `PositionDisplay.tsx`, and `CandlestickChart.tsx`.

---

## Two-Step Arming Pattern (2+ TP path only)

The engine must be armed **before** the HTTP order call to avoid missing fills that arrive while the HTTP request is in flight. This pattern is **only used for the 2+ TP path** — the 0-1 TP path uses gateway-native brackets and skips the engine entirely.

```
1. armForEntry(config)          ← called BEFORE placeOrder HTTP call
     └── buffers incoming SignalR fill events

2. confirmEntryOrderId(orderId) ← called AFTER HTTP response
     └── checks buffered fills, processes if entry already filled
```

If a fill event arrives between steps 1 and 2, it is buffered and replayed once the order ID is confirmed.

### Disarm on failure

If `placeOrder` throws, callers must disarm the engine via `clearSession()` to prevent it from reacting to fills from unrelated orders. Both `BuySellButtons.tsx` and `useQuickOrder.ts` handle this in their catch blocks.

---

## Entry Fill Handling (`onEntryFilled`)

When the entry order fills (detected via SignalR `GatewayUserOrder` with status=2):

1. **Places SL** as a stop order (type 4 for Stop, type 5 for TrailingStop) — wrapped in `retryAsync` (3 attempts, exponential backoff). If all retries fail, shows a non-dismissible critical toast ("UNPROTECTED position").
2. **Places each TP** as a separate limit order, sorted nearest-first — wrapped in `retryAsync` (2 attempts)
   - TP sizes are **normalized** before placement (see TP Size Normalization below)
   - Last TP gets the remainder to ensure all contracts are covered
   - Skips TPs if all entry contracts are already allocated

### Price conversion

```
priceOffset = pointsToPrice(points, contract)
            = points * contract.tickSize * contract.ticksPerPoint
```

`ticksPerPoint` is derived from the `Contract` (e.g. 4 for MNQ, 100 for BTC). Helpers live in `utils/instrument.ts`: `pointsToPrice()`, `priceToPoints()`, `pointsToTicks()`, `calcPnl()`.

- **SL price**: `entryPrice - offset` for long, `entryPrice + offset` for short
- **TP price**: `entryPrice + offset` for long, `entryPrice - offset` for short

---

## Condition Evaluation

On each SignalR order fill event, the engine checks if a TP was filled and executes associated condition actions:

```
SignalR GatewayUserOrder event (status=2, filled)
  └─► BracketEngine.onOrderEvent()
        └─► if filled order matches a TP
              └─► evaluate all Conditions where trigger.tpIndex matches
                    moveSLToBreakeven → modify SL order price to entry price
                    moveSLToTP        → modify SL order price to TP N price
                    customOffset      → modify SL order price to entry ± points
                    cancelRemainingTPs → cancel all remaining TP orders
```

Conditions are defined in the bracket preset UI and evaluated entirely client-side — they are NOT sent to the TopstepX API.

---

## TP Size Normalization

When TP sizes (whole contracts) sum to more than the entry size, the engine normalizes them pro-rata before placement:

1. Compute ratio: `entrySize / totalTpSize`
2. Scale each TP: `max(1, floor(tp.size * ratio))`
3. Last TP gets the remainder to guarantee exact sum
4. Shows a warning toast: "TP sizes adjusted to match order size"

If sizes already sum to the entry size (or less), no normalization occurs. Normalized sizes are stored on the session (`normalizedTPs`) and used by `getFilledTPSize()` for accurate SL size reduction.

### External TP size updates (`updateTPSize`)

When TP sizes are modified externally via the chart overlay +/- buttons, `updateTPSize(orderId, newSize)` updates the corresponding entry in `normalizedTPs` to keep `getFilledTPSize()` accurate. Without this sync, subsequent TP fills would compute the wrong remaining position size for SL adjustment. No-op if no active session (handles ad-hoc TPs placed outside the engine).

---

## Error Handling & Retry

All critical operations use `retryAsync` (from `utils/retry.ts`) with exponential backoff + jitter, and show toast notifications on failure:

| Operation | Retries | On exhaustion |
|-----------|---------|---------------|
| SL placement | 3 | Critical toast (non-dismissible): "UNPROTECTED position" |
| TP placement | 2 | Error toast |
| SL size modify (after TP fill) | 2 | Warning toast |
| Move SL to breakeven | 1 | Error toast |
| Cancel session orders | 1 per order | Warning toast per failed cancel |
| Condition action | 1 | Error toast: "Condition action failed: {kind}" |

Toast notifications are surfaced via `showToast()` from `utils/toast.ts`, which writes to the Zustand toast store slice and renders via `<ToastContainer />`.

---

## SL Size Auto-Sync on Position Change

When position size changes, the SL order size must be synced to match. Two paths handle this:

1. **BracketEngine** (preset flow): reduces SL size when it has an active session — uses `getFilledTPSize()` to sum filled TP sizes, computes remaining position
2. **OrderPanel position handler** (fallback for drag-placed orders): syncs SL size whenever `slOrder.size !== pos.size` and no bracket session is active. This handles both **TP partial fills** (position shrinks) and **adding contracts** (position grows).

**Must use position event, NOT order event** — position size isn't updated yet when the order fill event fires (event sequence: Order → Trade → Position).

---

## Session Management

### Active session tracking

- `hasActiveSession()` — returns `true` if armed or has an active bracket session
- Each session tracks: entry order ID, entry price, entry side, SL order ID, TP order IDs, filled TP set, config

### Session clearing

- `clearSession()` — called when position closes (size=0)
- Returns `Set<number>` of order IDs being cancelled (so callers can avoid double-cancelling)
- Cancels **both** SL and all remaining unfilled TPs via `cancelSessionOrders()`
- Resets all session state

### Internal helpers

- `cancelSessionOrders(session)` — cancels SL + all unfilled TPs **in parallel** (`Promise.allSettled`) (used by `clearSession`). Checks `isOrderStillOpen()` before each cancel to skip orders already removed by the gateway (prevents spurious retry delays and "Failed to cancel" toasts).
- `cancelSessionTPs(session)` — cancels only unfilled TPs **in parallel** (`Promise.allSettled`) (used when SL fills, or on `cancelRemainingTPs` condition action). Same `isOrderStillOpen()` guard.
- `isOrderStillOpen(orderId)` — checks if the order still exists in the Zustand store's `openOrders`. When a position closes, the gateway may auto-cancel bracket orders before the engine's parallel cancel batch reaches them.
- `getFilledTPSize()` — sums sizes of filled TPs to calculate remaining position

---

## Public API

```ts
// Arming (called by BuySellButtons / CandlestickChart + button)
armForEntry(config: {
  accountId: number;
  contractId: string;
  entrySide: 0 | 1;
  entrySize: number;
  config: BracketConfig;
  contract: Contract;       // instrument metadata (tickSize, tickValue, ticksPerPoint)
}): void

confirmEntryOrderId(orderId: number): void

// Called on every SignalR order event (by OrderPanel)
onOrderEvent(order: Order): void

// Manual actions (called by PositionDisplay)
moveSLToBreakeven(): Promise<boolean>

// Config updates (called by CandlestickChart for + button drag)
updateArmedConfig(updates: Partial<ArmedConfig>): void

// TP size sync (called by useOverlayLabels after +/- resize)
updateTPSize(orderId: number, newSize: number): void

// Session queries
hasActiveSession(): boolean

// Cleanup (called by OrderPanel on position close)
// Returns Set<number> of order IDs being cancelled
clearSession(): Set<number>
```

---

## Preset Suspend/Restore

Managed by the Zustand store (not the engine itself):

- **On position open**: the active preset is **suspended** (`suspendedPresetId`), active set to null — next order is naked
- **On position close**: the preset is **restored** automatically
- Ad-hoc bracket state is cleared and preview is turned off when real SL/TP orders exist on the chart
- Manual preset selection clears any suspended state

---

## Integration Points

| Consumer | Usage |
|----------|-------|
| `BuySellButtons.tsx` | Uses native brackets for <= 1 TP; arms engine for 2+ TPs, confirms after, disarms on failure |
| `useQuickOrder.ts` (+ button) | Same dual-path: native brackets or engine arming. Disarms on failure. Updates armed config on drag |
| `OrderPanel.tsx` | Forwards every SignalR order event via `onOrderEvent()`, calls `clearSession()` on position close |
| `PositionDisplay.tsx` | Calls `moveSLToBreakeven()` from the SL-to-BE button |
| `useOverlayLabels.ts` | Calls `updateTPSize()` after +/- TP size redistribution to keep `normalizedTPs` in sync |

---

## Tests

`frontend/src/services/__tests__/bracketEngine.test.ts` — 15 tests using Vitest, mocking `orderService` and `showToast`.

Coverage: arm/confirm lifecycle, entry fill (long/short/buffered), SL placement failure + critical toast, TP size normalization, SL fill cancels TPs, TP fill reduces SL size, clearSession cancels orders, conditions (moveSLToBreakeven on TP fill), condition action failure toast.

```bash
cd frontend && npm test
```
