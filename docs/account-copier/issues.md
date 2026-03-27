# Account Copier — Issues & Solutions

## v1: Backend SignalR Event Mirroring (FAILED — reverted)

### Approach
Backend created its own SignalR connection to the exchange, listened for master account order/position events, and replicated them to followers via REST.

### Why It Failed

1. **Exchange rejects duplicate SignalR connections** — Same JWT token can't have two simultaneous SignalR sessions. The backend connection would connect then immediately close.

2. **Pivoted to frontend event forwarding** — Frontend forwarded SignalR events to backend via `POST /copy/event`. Backend handled replication. This worked for basic order placement.

3. **Bracket lifecycle completely broken** — The backend placed SL/TP orders on the follower that the frontend bracket engine didn't know about. When the follower cancelled an order, the bracket engine tried to clean up bracket legs it had no IDs for → "failed to cancel" errors, orphaned SL/TP lines on the chart.

4. **Root cause**: The backend copy engine and the frontend bracket engine were two independent systems fighting over the same orders. The bracket engine manages chart lines, order cleanup, and OCO logic — bypassing it guaranteed broken state.

### Lesson
Don't replicate at the event level (after the fact). Replicate at the action level (before it happens), so the existing bracket engine lifecycle applies naturally.

---

## v2: Frontend Service-Level Interception (CURRENT — working)

### Approach
Intercept `orderService.placeOrder/cancelOrder/modifyOrder`. When a call is made for the master account, fire the same call for the follower. The bracket engine uses these same functions, so all bracket actions are automatically replicated.

### Issues Encountered & Fixed

#### Issue 1: Native brackets caused double SL/TP
**Problem**: The master's entry order included `stopLossBracket`/`takeProfitBracket` params (native gateway brackets). CopyTracker copied these params to the follower entry. The bracket engine then placed its own SL/TP via `orderService.placeOrder` — which also got copied. Result: follower had double brackets.

**Attempted fix**: Strip `stopLossBracket`/`takeProfitBracket` from follower entry params.

**Why that failed**: The bracket engine discovers (not places) native SL on the master. When using native brackets, the engine calls `discoverNativeSL()` instead of `orderService.placeOrder()`. So stripping brackets left the follower with NO SL at all.

**Final fix**: Keep native brackets on the follower entry. The gateway creates SL/TP on the follower independently. For the standard 0-1 TP case, native brackets handle everything. The bracket engine's subsequent `placeOrder`/`modifyOrder`/`cancelOrder` calls for the master's brackets are intercepted and applied to the follower's tracked orders.

**Status**: Working. Native brackets fill independently on the follower when price hits the level.

#### Issue 2: First SignalR order event arrives as action=1 (update)
**Problem**: In the earlier backend approach, the handler only created new follower orders on `action=0` (new). But the first event for a Working order sometimes arrives as `action=1` (update), not `action=0`. Market orders may skip Working entirely.

**Fix**: Changed to check `orderMap` presence instead of `action` value. If the order ID isn't tracked, it's new regardless of action.

**Status**: Not applicable to v2 (no SignalR event handling).

#### Issue 3: Vite proxy missing for `/copy` route
**Problem**: In the backend approach, `POST /copy/configure` returned 404 because the Vite dev server proxy didn't include `/copy`.

**Fix**: Added `/copy` to `vite.config.ts` proxy list.

**Status**: Not applicable to v2 (no backend routes).

---

## Known Limitations (v2)

1. **Requires browser open** — Copy trading only works while the terminal tab is active. If the browser is closed, no copying happens. This is acceptable because you're actively trading when placing orders.

2. **Order map lost on refresh** — `copyTracker.orderMap` is in-memory. After page refresh, existing follower orders aren't tracked. New master actions create new follower orders, which may cause duplicates if old orders are still open.

3. **Single follower** — UI currently supports one follower account. The `copyTracker` supports multiple (`followerIds: string[]`) but the dropdown only selects one.

4. **No copy log UI** — v1 had a bottom panel Copy Log tab. v2 doesn't have this yet. Failed copies show as toast warnings.

5. **Follower independence is limited** — If the follower cancels a copied order, the master doesn't know. The master's next modify on that order will fail silently on the follower (toast warning). The `orderMap` entry becomes stale.
