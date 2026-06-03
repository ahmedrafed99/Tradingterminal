## Chart candles flash/disappear on tab focus after being AFK

**Status:** Fixed (2026-06-03)

**Symptom:** After leaving the browser tab in the background for ~30 minutes and clicking back on it, the entire visible chart range went blank momentarily before redrawing. Hard refresh restored normal display.

**Root cause:** When a browser tab is backgrounded, `requestAnimationFrame` is throttled to ~0 fps. The quote handler kept updating `refs.lastBar` / `refs.bars` in memory, but `flushQuote()` — which calls `series.update()` — was never called because it was gated behind RAF. On tab focus, `visibilitychange` triggered `triggerBackfill`, which fetched 1 bar but then called `series.setData(~20k candles)`. LWC's `setData` clears and fully re-renders the series, causing the momentary blank.

**Fix (useChartBars.ts):**
1. In `handleQuote`: when `document.hidden` is true, bypass RAF and call `flushQuote()` directly so LWC's series stays synchronized while the tab is backgrounded.
2. In `handleVisibilityChange`: if `lastBar.time` is within the current candle period (meaning LWC was kept current by the direct flush), skip `triggerBackfill` entirely — no `setData` flash on focus.

The full server backfill still fires if `lastBar` falls more than one period behind (e.g. SignalR disconnected while hidden).
