# Account Copier (Copy Trading)

Mirrors trades from a **master account** to a chosen **follower account**. Frontend-only — intercepts `orderService` calls so the bracket engine's SL/TP lifecycle is automatically replicated.

---

## How It Works

```
User clicks Buy/Sell
    │
    ▼
placeOrderWithBrackets()        ← bracket engine armed
    │
    ▼
orderService.placeOrder(master) ← copyTracker intercepts here
    │                                │
    ▼                                ▼
Exchange places master order     Exchange places follower order
    │                                │ (same params, different accountId)
    ▼                                ▼
master orderId                   follower orderId
    │                                │
    └── copyTracker.orderMap tracks the mapping ──┘

... bracket engine places SL (via orderService.placeOrder) → also copied
... user drags SL (via orderService.modifyOrder) → also copied
... user cancels (via orderService.cancelOrder) → also copied
```

Every `orderService.placeOrder`, `cancelOrder`, and `modifyOrder` call is intercepted. If the call is for the master account, the same action fires on the follower. Since the bracket engine uses these same functions for SL/TP, all bracket actions replicate automatically — no special bracket handling needed.

---

## What Gets Copied

Everything that goes through `orderService`:

| Action | Source | Copied? |
|---|---|---|
| Market/limit entry order | BuySellButtons → placeOrderWithBrackets | Yes |
| Native brackets (SL/TP on entry) | Passed as `stopLossBracket`/`takeProfitBracket` params | Yes (gateway creates them on follower) |
| Engine-placed SL after fill | bracketEngine → orderService.placeOrder | Yes |
| Engine-placed TPs after fill | bracketEngine → orderService.placeOrder | Yes |
| SL/TP drag (modify) | useOrderDrag → orderService.modifyOrder | Yes |
| Order cancel (chart X or tab) | orderService.cancelOrder | Yes |
| Position close button | PositionDisplay → orderService.placeOrder (market) | Yes |
| SL size sync on TP fill | bracketEngine → orderService.modifyOrder | Yes |
| Move SL to breakeven | bracketEngine → orderService.modifyOrder | Yes |

---

## Order Mapping

In-memory `Map` inside `copyTracker.ts`:

```
masterOrderId → Map<followerAccountId, followerOrderId>
```

- Built when follower order placement succeeds (response contains orderId)
- Used to find the follower's order when the master order is modified or cancelled
- `followerPlacedIds` Set prevents infinite loops (don't re-replicate follower orders)
- Lost on page refresh — existing follower orders continue independently

---

## Configuration

Three fields in `layoutSlice` (persisted to localStorage via Zustand):

```typescript
copyEnabled: boolean;
copyMasterAccountId: string | null;
copyFollowerIds: string[];        // currently supports one follower
```

`copyTracker.ts` auto-syncs from the store via `useStore.subscribe()`.

---

## UI

### Settings Modal — "Copy Trading" Tab

```
┌──────────────────────────────────────────┐
│  MASTER ACCOUNT                          │
│  ┌────────────────────────────────┐      │
│  │ Account A (50K Challenge)   ▼  │      │
│  └────────────────────────────────┘      │
│  Trades on this account will be copied.  │
│                                          │
│  FOLLOWER ACCOUNT                        │
│  ┌────────────────────────────────┐      │
│  │ Account B (Funded)          ▼  │      │
│  └────────────────────────────────┘      │
│  This account will mirror the master.    │
│                                          │
│  STATUS              [ On/Off toggle ]   │
│  Active                                  │
└──────────────────────────────────────────┘
```

- Master dropdown: pick source account
- Follower dropdown: pick destination (excludes master)
- Toggle: enable/disable. Disabled when < 2 accounts or no follower selected.

---

## Files

### New
| File | Purpose |
|---|---|
| `frontend/src/services/copyTracker.ts` | Core copy logic — order mapping, intercept functions, store sync |
| `frontend/src/components/settings/CopyTradingTab.tsx` | Settings tab with master/follower dropdowns + toggle |

### Modified
| File | Change |
|---|---|
| `frontend/src/services/orderService.ts` | Added `copyTracker.onPlaceOrder/onCancelOrder/onModifyOrder` after each API call |
| `frontend/src/store/slices/layoutSlice.ts` | Added `copyEnabled`, `copyMasterAccountId`, `copyFollowerIds` + setters |
| `frontend/src/store/useStore.ts` | Added copy fields to `partialize` for persistence |
| `frontend/src/components/SettingsModal.tsx` | Added "Copy Trading" tab |

No backend changes.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Follower order fails (locked, margin) | Toast warning shown, master unaffected |
| Follower cancels a copied order | No replication (follower's accountId, not master's). Master's next modify on that order fails silently on follower |
| Master forces changes | Always replicated — master accountId triggers intercept |
| Page refresh | `orderMap` lost. Existing follower orders remain. New master actions create new copies |
| Copy disabled mid-session | `orderMap` cleared. Existing orders on both accounts remain independently |
| Native brackets (SL/TP) | Kept on follower entry — gateway manages them. Bracket engine's subsequent actions also copied |
