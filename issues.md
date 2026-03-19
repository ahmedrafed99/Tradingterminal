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

### Fix Options

1. **Reconstruct `qoPendingPreview`** from Suspended orders in `openOrders[]` on page load (entry price, SL/TP prices are on the order objects).
2. **Fallback in `useOrderLines`**: render Suspended orders when `qoPendingPreview` is `null`.
3. **Persist `qoPendingPreview`** to sessionStorage.
