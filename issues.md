
# Condition-Triggered Bracket Price Bug

## Status: FIXED

## Symptom

When a condition triggers and places a limit entry + Suspended bracket legs, the SL/TP chart lines appear at the **preset** bracket prices instead of the custom positions the user adjusted in the condition preview.

## Root cause (confirmed)

`applyConditionBracketInfo` (called on SSE trigger) set `previewHideEntry: true` but did **not** set `draftSlPoints` / `draftTpPoints`. `usePreviewLines` reads from `resolvePreviewConfig()`, which falls back to the active preset when drafts are null — so the chart lines showed preset prices regardless of what custom values were armed.

The earlier investigation focused on activation prices (Path A / Path B corrections) which is a secondary concern. The primary visual bug was entirely client-side.

## Fix (committed)

`applyConditionBracketInfo` in `ConditionsTab.tsx` now sets `draftSlPoints` and `draftTpPoints` from `c.bracket` alongside the other preview state:

```typescript
useStore.setState({
  previewHideEntry: true,
  previewSide: side,
  limitPrice: entryPrice,
  orderType: 'limit',
  draftSlPoints: c.bracket.sl?.points ?? null,
  draftTpPoints: fittedTps.map((tp) => tp.points),
});
```

Additional fixes applied in the same session:
- `pendingBracketInfo` now carries `fromCondition: true` when set from a condition trigger.
- Path B in `OrderPanel.tsx` branches on `fromCondition`: uses `bi.slPrice`/`bi.tpPrices` directly (not `resolvePreviewConfig()`) when correcting post-fill activation prices for condition-triggered brackets.
- Retroactive patch in `applyConditionBracketInfo`: if WS Suspended events beat the SSE (race condition), already-stored brackets are patched with custom prices from `bi` immediately after SSE arrives.
