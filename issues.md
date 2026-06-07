# Chart Loading & Timeframe Switch — Issues

## Bug 1 — `dataMap` rebuilt after an `await` (crosshair shows stale prices)

**File:** `frontend/src/components/chart/hooks/useChartBars.ts`

`series.setData(candles)` is called at line 469, but `refs.dataMap.current.clear()` + refill happens at line 520 — after the partial bar fetch `await` at line 487. During that network round-trip (~50–200ms), the chart displays new TF candles but the crosshair OHLC tooltip reads from the old TF's dataMap.

**Fix:** Move the `refs.dataMap.current.clear()` + fill loop to right after `series.setData(candles)`, before the partial bar block.

---

## Bug 2 — Real-time effect re-subscribes on every TF change (quote gap window)

**File:** `frontend/src/components/chart/hooks/useChartBars.ts` line 989

Real-time subscription effect has dep array `[connected, contract, timeframe]`. When only `timeframe` changes (same contract), it runs the full cleanup (`unsubscribeQuotes` → `offQuote`) then re-subscribes to the same contractId. Only `periodSec` actually needs to change.

During React's commit + effect scheduling gap, quotes for the contract are silently dropped. `pendingBar` is also discarded (RAF cancelled in cleanup), so the forming bar's OHLC progress is lost and starts fresh from the next quote.

**Fix:** Separate the quote subscription (dep `[connected, contract]`) from bar-bucketing logic (dep `[timeframe]`). Capture `periodSec` via a ref updated independently so the single subscription handler reads it on each quote.

---

## Bug 3 — `visibleLogicalRangeChange` listener leak on rapid TF switch

**File:** `frontend/src/components/chart/hooks/useChartBars.ts` ~line 608

The scroll-to-load-older listener is subscribed after the partial bar `await`. If cleanup runs (setting `cancelled = true`) while the partial bar fetch is in-flight, `rangeUnsub?.()` in cleanup hits `null`. After the fetch resolves, `subscribeVisibleLogicalRangeChange` is called and `rangeUnsub` is set with nothing left to clean it up.

Functionally benign — the leaked listener calls `loadOlder()` which returns immediately because `cancelled === true` in its closure — but each rapid TF switch during a partial bar fetch accumulates one more listener.

**Fix:** Add `if (cancelled) return;` after the partial bar try-catch block (~line 511), before the `setLastBarTime` / `rangeUnsub` block.

---

## Design Notes

- **`barsCacheRef` is unbounded** — no eviction. Long sessions accumulate bar arrays for every visited contract + TF combination. Consider a max-entries limit or LRU eviction.
- **Aggregation fast path is one-directional** — finer → coarser works (1m → 5m); coarser → finer always goes to network. Expected behavior.
- **Backtest path never writes to `barsCacheRef` or `previousTimeframeRef`** — switching back to live after a backtest always does a full fetch. Intentional.

---

## Chart candles flash/disappear on tab focus after being AFK

**Status:** Fixed (2026-06-03)

**Symptom:** After leaving the browser tab in the background for ~30 minutes and clicking back on it, the entire visible chart range went blank momentarily before redrawing. Hard refresh restored normal display.

**Root cause:** When a browser tab is backgrounded, `requestAnimationFrame` is throttled to ~0 fps. The quote handler kept updating `refs.lastBar` / `refs.bars` in memory, but `flushQuote()` — which calls `series.update()` — was never called because it was gated behind RAF. On tab focus, `visibilitychange` triggered `triggerBackfill`, which fetched 1 bar but then called `series.setData(~20k candles)`. LWC's `setData` clears and fully re-renders the series, causing the momentary blank.

**Fix (useChartBars.ts):**
1. In `handleQuote`: when `document.hidden` is true, bypass RAF and call `flushQuote()` directly so LWC's series stays synchronized while the tab is backgrounded.
2. In `handleVisibilityChange`: if `lastBar.time` is within the current candle period (meaning LWC was kept current by the direct flush), skip `triggerBackfill` entirely — no `setData` flash on focus.

The full server backfill still fires if `lastBar` falls more than one period behind (e.g. SignalR disconnected while hidden).
