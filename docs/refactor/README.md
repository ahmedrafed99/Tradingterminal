# Refactoring Opportunities

This file tracks known architectural issues and improvement suggestions. These are NOT bugs — the code works — but reducing them would make future maintenance and debugging significantly faster.

---

## Priority 1 — High Risk / High Reward

### 1.1 Replace heuristic bracket leg identification with customTag throughout

**Problem**: In several places, bracket legs are identified by matching `side + type + size` against `qoPendingPreview`. This is fragile — it can match the wrong order if multiple bracket orders of similar shape are open simultaneously.

**Current heuristic pattern** (in tradingSlice.ts, buildQoPendingLabels.ts, usePreviewDrag.ts):
```typescript
const isSl = order.customTag?.endsWith('-SL') ?? (
  order.side === oppSide && (order.type === OrderType.Stop || order.type === OrderType.TrailingStop)
);
```

**Desired**: Remove the `?? (heuristic)` fallback entirely. Require `customTag` to be present and correct. Log a warning if it's missing. This requires verifying that the ProjectX gateway _always_ sends `customTag` for bracket legs (confirmed via logs: `AutoBracket{guid}-SL` / `-TP`).

**Files affected**: `tradingSlice.ts:97-107`, `buildQoPendingLabels.ts:51-56`, `buildQoPendingLabels.ts:111-119`, `usePreviewDrag.ts:127-132`, `usePreviewDrag.ts:156-163`

**Risk**: Low — customTag has been confirmed reliable in production logs. The heuristic fallback was a defensive measure added before customTag was discovered.

---

### 1.2 Post-fill price correction only handles single TP (index 0)

**Problem**: The post-fill correction in `OrderPanel.tsx` uses `qo.tpPrices[0]` — hardcoded index 0. If the user has 2+ TPs (via the 2+ TP client-side engine path), the correction would apply TP1's desired price to all TP bracket legs.

However, the 2+ TP path does NOT use native brackets (it places TPs via bracketEngine after fill), so this code path is only ever reached for the 0-1 TP native bracket path. This is implicitly correct but confusingly fragile.

**Desired**: Add a guard: `if (nativeBrackets path)` — or at minimum an inline comment explaining why `tpPrices[0]` is always correct here.

**Files affected**: `OrderPanel.tsx:259-267`

---

### 1.3 qoPendingPreview is not cleared after post-fill correction

**Problem**: `qoPendingPreview` is set when a quick order (+) is placed with brackets, and cleared by `pendingFillUnsub` in `useQuickOrder.ts` when the entry fills. The post-fill correction in `OrderPanel.tsx` fires when the bracket legs transition to Working (after entry fill), but relies on `qoPendingPreview` still being populated at that moment.

The `pendingFillUnsub` clears it when `order.status === 2 (Filled)` for the entry order. The bracket legs transition to Working shortly after the entry fills. There's a race: if the `pendingFillUnsub` subscriber fires and clears `qoPendingPreview` before the bracket leg Working events arrive, the post-fill correction silently skips (no crash, just no correction).

**In practice**: SignalR events arrive in the order: entry Filled → bracket legs Working. JavaScript is single-threaded and the Zustand subscriber runs synchronously, so in practice this works. But it's dependent on event ordering.

**Desired**: Store `qoPendingPreview` prices in a stable ref or delay clearing it until after bracket legs are confirmed Working.

**Files affected**: `OrderPanel.tsx:243-270`, `useQuickOrder.ts` (pendingFillUnsub subscriber)

---

### 1.4 OrderPanel.tsx is doing too much

**Problem**: `OrderPanel.tsx` is a 520-line file that serves as the SignalR event hub for orders, positions, quotes — while also being a React component that renders the order panel UI. Mixing event wiring with component rendering makes it hard to test and reason about.

**Current responsibilities in OrderPanel.tsx**:
- Subscribes to SignalR order events → handles bracket leg detection, post-fill correction, bracket engine forwarding, REST refresh
- Subscribes to SignalR position events → handles position close cleanup, SL size sync, preset suspend/restore
- Subscribes to quote events → seeds `lastPrice`
- REST hydration on account change and reconnect
- Position inference from orders + trades
- Renders the order panel UI (InstrumentSelector, BuySellButtons, etc.)

**Desired split**:
- `useOrderEvents.ts` hook: all SignalR order event handling
- `usePositionEvents.ts` hook: all SignalR position event handling
- `OrderPanel.tsx`: just the UI render + calls the hooks

**Files affected**: `OrderPanel.tsx` (entire file)

**Effort**: Medium. The hooks exist in the chart subsystem already (`useOrderLines`, `useOrderDrag`, etc.) — same pattern.

---

## Priority 2 — Medium Risk

### 2.1 Suspended order chart lines are excluded by status check — but should be excluded by qoPendingPreview

**Problem**: `useOrderLines.ts` and `buildOrderLabels.ts` skip `OrderStatus.Suspended` orders to prevent duplicate lines over `qoPreviewLines`. This is correct, but it means that if a Suspended order arrives WITHOUT a corresponding `qoPendingPreview` (e.g. externally placed bracket order, or after page refresh), it will never appear on the chart at all — not as a preview line and not as an order line.

**Desired**: The exclusion logic should check for the presence of a matching `qoPendingPreview` entry rather than unconditionally skipping all Suspended orders. This would correctly show Suspended orders that weren't placed through the + button.

**Files affected**: `useOrderLines.ts:67`, `buildOrderLabels.ts:118`

---

### 2.2 The REST refresh (bracketRefreshTimerRef) is vestigial

**Problem**: The 1.5s delayed `searchOpenOrders` REST call was added to hydrate bracket prices for Suspended orders. But:
- Suspended orders are excluded from `searchOpenOrders` (gateway only returns Working orders)
- After our fix, Suspended prices are injected from `qoPendingPreview` instead
- The guard `!order.customTag` correctly prevents this from firing for bracket legs post-fill

The refresh is still useful for one case: detecting externally placed orders that haven't arrived via SignalR. But the variable name `bracketRefreshTimerRef` and the surrounding comment are misleading.

**Desired**: Rename to `externalOrderRefreshTimerRef`, update comment to accurately describe its purpose (external order hydration, not bracket price hydration).

**Files affected**: `OrderPanel.tsx:180` (ref declaration), `OrderPanel.tsx:226-236` (timer usage)

---

### 2.3 Price-preserving merge in upsertOrder masks real data loss

**Problem**: `upsertOrder` now does:
```typescript
limitPrice: enriched.limitPrice ?? prev.limitPrice,
stopPrice: enriched.stopPrice ?? prev.stopPrice,
```

This correctly handles status-only updates that arrive without prices. But it also means that a legitimate price-clearing event (e.g. a gateway-side modify that removes a stop price) would be silently ignored. No such event is known to exist for ProjectX, but it's a latent correctness hazard.

**Desired**: Add a comment explicitly noting this assumption and a condition under which the preserve logic should be revisited.

**Files affected**: `tradingSlice.ts:114-118`

---

## Priority 3 — Low Priority / Cleanup

### 3.1 `OrderStatus` enum uses `erasableSyntaxOnly` TypeScript warnings

**Problem**: The `enums.ts` file uses `export enum` which TypeScript's `--erasableSyntaxOnly` flag flags as a warning (enums are erased at compile time but have runtime object representation). This is a pre-existing linting issue not caused by our changes.

**Desired**: Convert to `const` objects with `as const` or use TypeScript's `const enum`, depending on whether the enum values need to be iterable at runtime.

**Files affected**: `frontend/src/types/enums.ts`

---

### 3.2 Duplicate OrderStatus numeric literal usage in OrderPanel

**Problem**: `OrderPanel.tsx:278` has an inline comment `// status 2=filled or cancelled-type statuses` — a leftover from before `OrderStatus.Filled`, `.Cancelled`, etc. were defined. The code now uses the enum correctly, but the comment is stale.

**Files affected**: `OrderPanel.tsx:278` (minor — just remove stale comment)

---

### 3.3 Console.log statements left in order handler

**Problem**: `OrderPanel.tsx:209-218` contains verbose `console.log` statements that fire on every single SignalR order event. In production these pollute the console and slightly slow down the event handler.

**Desired**: Guard with `import.meta.env.DEV` (same pattern used elsewhere in the file).

**Files affected**: `OrderPanel.tsx:209-218`, `OrderPanel.tsx:279`, `OrderPanel.tsx:294`

---

## Why Was This Bug So Hard to Debug?

The bug required navigating four interacting systems:

1. **Undocumented gateway behavior** — The ProjectX API swagger documents `status=8` as "Suspended" but says nothing about prices being absent or modifyOrder being silently ignored. This had to be discovered from live logs.

2. **Two separate visual representations** — Before fill: `qoPreviewLines` (chart DOM elements). After fill: Zustand store `openOrders` → `useOrderLines` chart lines. Both existed simultaneously during the transition window, causing visual glitches when prices were injected into the store.

3. **Enum misname** — `OrderStatus.Bracket = 8` instead of `Suspended = 8` made the code misleading. Every reader had to mentally translate "bracket" to "suspended-contingent" to understand what the status meant.

4. **Silent gateway failures** — `modifyOrder` on a Suspended order returns success but does nothing. There was no error, no warning — just the order activating at the wrong price after fill. Silent failures are the hardest class of bug to diagnose.

5. **Race-dependent correctness** — The post-fill correction relies on `qoPendingPreview` being non-null when bracket leg Working events arrive. This works due to JavaScript's event loop ordering, but the dependency is invisible in the code.

The code architecture itself is sound — the split into hooks, the bracket engine pattern, the Zustand slice design. The difficulty came entirely from working against an underdocumented external API.
