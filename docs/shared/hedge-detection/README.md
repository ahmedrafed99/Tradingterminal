# Feature: Hedge Detection

Client-side safety guard that prevents placing orders that would create a hedging position — prohibited by prop firm rules (ProjectX/TopstepX).

---

## What counts as a hedge

A hedge occurs when an open position exists in one direction and a new order would *leave* you exposed in the opposite direction at the same time — on any account, for the same symbol or its micro/standard sibling.

**Blocked combinations (any account):**

| Existing position | Blocked order side |
|---|---|
| Long ES | Short ES or Short MES |
| Short MES | Long MES or Long ES |
| Long NQ | Short NQ or Short MNQ |

The rule applies across all accounts simultaneously. Having a long on account A and trying to short on account B is blocked just the same as doing it on the same account.

### Flips on the active account

An order on the active account that's larger than the existing same-contract position (e.g. sell 5 when long 3) is **not** a hedge by itself — the broker nets the 3 flat and opens the remaining 2 in the opposite direction. The guard allows this *unless* another conflicting position exists on a different account (or sibling contract), which would leave you hedged after the flip.

---

## Sibling detection

Micro and standard contracts are detected as siblings purely from the contractId structure — no hardcoded symbol list needed.

ContractId format: `CON.F.US.{CODE}.{EXPIRY}`

```
CON.F.US.ES.H26   → code = "ES"
CON.F.US.MES.H26  → code = "MES"

areSiblings = "MES" === "M" + "ES"  ✓
```

Any symbol where one code equals `"M" + otherCode` is treated as a sibling pair. This covers ES/MES, NQ/MNQ, E6/ME6, YM/MYM, GC/MGC, CL/MCL, and any future micro contracts automatically.

---

## What is and isn't checked

**Checked:** `positions[]` in the store — actual filled positions with `size > 0`.

**Not checked:** `openOrders[]` — pending bracket orders (stop loss, take profit) are not positions and do not trigger the guard. A take profit sell order on a long position is never counted as a hedge.

---

## Behavior

When a hedge would result from placing the order:

- Buy and Sell buttons are **disabled** (`canPlace = false`)
- A warning row appears below the buttons identifying the conflict:  
  `"Hedge blocked: Long ES open on Account A"`
- If an order somehow reaches `placeOrderWithBrackets` (chart quick-order, bot), a last-resort check throws and surfaces the same message as a toast

A flip on the active account (orderSize > own position size) is allowed as long as no other conflicting position would remain after the flip.

The check runs on every render — it is fully reactive. The moment a conflicting position opens (via WebSocket push), the buttons disable automatically with no user action required.

---

## Files

| File | Role |
|---|---|
| `frontend/src/utils/hedgeDetection.ts` | Pure utility: `getContractCode`, `areSiblings`, `detectHedge` |
| `frontend/src/components/order-panel/BuySellButtons.tsx` | Reads live positions, disables buttons, shows warning |
| `frontend/src/services/placeOrderWithBrackets.ts` | Last-resort guard for non-panel placement paths |

---

## Data flow

```
WebSocket / REST
      │
      ▼
positions[] in store  ←── all accounts, all symbols, live
      │
      ▼
BuySellButtons (render)
  detectHedge(positions, orderContractId, orderSide, accounts)
      │
      ├── no conflict → canPlace = true, buttons enabled
      └── conflict    → canPlace = false, buttons disabled + warning shown
```