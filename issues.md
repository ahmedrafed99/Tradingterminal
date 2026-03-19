# Known Issues

## 1. TP/SL bracket lines vanish after page refresh

**Status:** Open
**Severity:** High — user loses visual confirmation of pending bracket orders

### Symptom

After submitting a quick order with TP/SL brackets (entry not yet filled), all three lines (entry, SL, TP) display correctly. On page refresh, only the entry line remains — SL and TP lines disappear.

### Root Cause

Two rendering systems both refuse to draw Suspended bracket orders after refresh:

1. **`useOrderLines`** ([useOrderLines.ts:68](frontend/src/components/chart/hooks/useOrderLines.ts#L68)) intentionally skips `Suspended` orders because `qoPendingPreview` is supposed to render them.
2. **`useOverlayLabels`** ([useOverlayLabels.ts:94](frontend/src/components/chart/hooks/useOverlayLabels.ts#L94)) skips `buildQoPendingLabels()` entirely because `qoPendingPreview` is `null`.

`qoPendingPreview` is in-memory Zustand state ([tradingSlice.ts:252](frontend/src/store/slices/tradingSlice.ts#L252)) — set only at order submission time ([useQuickOrder.ts:464-480](frontend/src/components/chart/hooks/useQuickOrder.ts#L464-L480)) and never persisted. On refresh, the store reinitializes to `null`, so the Suspended bracket orders exist in `openOrders[]` (fetched from the server) but no rendering path picks them up.

### Data Flow

```
BEFORE REFRESH (works):
  openOrders[Entry=Working, SL=Suspended, TP=Suspended]
  qoPendingPreview = { entryPrice, slPrice, tpPrices, ... }
  → useOrderLines renders Entry (skips Suspended)
  → qoPendingPreview renders SL + TP lines       ✅

AFTER REFRESH (broken):
  openOrders[Entry=Working, SL=Suspended, TP=Suspended]  ← server returns all 3
  qoPendingPreview = null                                 ← lost, not persisted
  → useOrderLines skips Suspended                         ⛔
  → qoPendingPreview is null, labels block skipped        ⛔
  → SL + TP lines orphaned — nobody renders them          💀
```

### Previous Fix Attempts (reverted)

Several approaches were tried and reverted (commits `b5479ae`–`0989f98`) because fixing the refresh case broke the normal flow:

1. **Rehydration effect in `useOrderLines`** — persisted `qoPendingPreview` to sessionStorage and added a separate effect to recreate dashed preview lines after refresh. Failed because two systems (useQuickOrder + useOrderLines) were managing the same preview lines, causing timing races: lines were destroyed by useQuickOrder's cleanup before the rehydration effect could run, or the fill/cancel watcher missed state transitions due to effect ordering.

2. **Enriching `setOpenOrders`** — injected `qoPendingPreview` prices into Suspended orders during REST bulk load. Failed because REST `searchOpenOrders` does not return Suspended bracket legs at all — there's nothing to enrich.

3. **Subscribing to `qoPendingPreview` in live-lines effect** — made the effect reactive to preview state changes. Caused conflicts with useQuickOrder's line management: the effect destroyed and recreated preview lines that useQuickOrder was tracking in its local array, breaking the fill/cancel cleanup path.

**Key lesson:** preview line lifecycle must stay in ONE place. useQuickOrder already manages creation, tracking (local array), and cleanup (pendingFillUnsub → removePreviewLines). The rehydration should happen inside useQuickOrder's effect body, reusing the same local array and watcher pattern.

### Fix Plan

Add rehydration to `useQuickOrder`'s effect body (not useOrderLines):

1. **Persist `qoPendingPreview` to sessionStorage** in tradingSlice setter; rehydrate on store init.
2. **Store `entryOrderId`** to sessionStorage after placeOrder resolves.
3. **In useQuickOrder's effect**, after guards pass: if `qoPendingPreview` exists in the store (rehydrated) and `entryOrderId` is in sessionStorage, recreate SL/TP lines into the local `qoPreviewLines` array and set up `pendingFillUnsub` using the same watcher pattern. The existing cleanup path (`removePreviewLines`) handles cancel/fill/effect-cleanup identically to the normal flow.
4. **Conditional Suspended skip** in useOrderLines and buildOrderLabels: skip Suspended orders only when preview lines actually exist (`qoLinesActive`), not unconditionally.
