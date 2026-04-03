# Stats Dashboard — Known Issues

## "All Time" filter option (attempted, reverted)

### Goal
Add an "All Time" option to the date preset filter (today / this week / this month / **all time**) and consolidate all trade fetching into a single request by fetching the broadest range (all time) once on page load, then filtering today/week/month client-side.

### What was done
- Extended `DatePreset` type with `'all'`, added `getDateRange('all')` returning `startTimestamp: '1970-01-01T00:00:00.000Z'`
- Replaced the per-preset fetch strategy (3-4 requests on load) with a single all-time superset fetch, stored in an `allTradesCache` map
- Derived today/week/month display trades and badge counts client-side from the cached superset
- Moved `displayTrades` update into the store action (`setTradesDatePreset`) so preset switching is synchronous (no useEffect delay)
- Moved session trades derivation (for TopBar RPNL) into TradesTab instead of App.tsx to avoid cascading re-renders

### Performance issue — preset switching is slow (~2-4s)

Switching presets in the stats popover takes 2-4 seconds despite all data being cached and client-side filtering taking <1ms.

**Root cause: cascading React re-renders.** A single preset change triggers 2-3 full render cycles of `StatsPopover`, each taking ~800-1000ms of DOM work:

1. **Render 1**: Store action updates `tradesDatePreset` + `displayTrades` synchronously. StatsPopover re-renders, all `useMemo` chains recompute (`buildCalendarData` ~30ms, `buildHourlyData` ~30ms).

2. **Render 2**: TradesTab's `useEffect` fires (runs after paint), calls `setPresetCounts` (local state). If `displayTrades` was also set here (new array reference, same content), it triggers StatsPopover to re-render again with all useMemos recomputing.

3. **Render 3**: App.tsx's session trades effect depends on `displayTrades`. When it changes, `setSessionTrades` fires, which updates BottomPanel (for badge count), cascading to StatsPopover.

Each render cycle itself is fast in JS (~60ms of useMemo computation), but the **DOM reconciliation and paint** of the full stats popover (KPI cards, PnL chart, calendar grid, breakdowns) takes ~800ms per cycle.

React StrictMode in dev doubles every render (mount-unmount-remount), compounding the issue.

### Fixes attempted
- Removed `displayTrades` from TradesTab's preset counts effect deps (eliminated the original duplicate-fetch bug)
- Made store action set `displayTrades` synchronously (eliminated 1 render cycle)
- Stopped TradesTab effect from calling `setDisplayTrades` on cache hit (eliminated another render cycle)
- Moved session trades derivation out of App.tsx to avoid the `displayTrades` -> `setSessionTrades` -> BottomPanel cascade

### Important: DevTools overhead

Chrome DevTools (Inspect Element) adds **3-5x overhead** to React rendering. The ~2-4s times above were measured with DevTools open. With DevTools closed, preset switching takes ~300-400ms — noticeably faster and acceptable. **Always close DevTools when testing performance.**

### What remains to solve
The stats popover is inherently heavy (~1000+ DOM elements across calendar grid, charts, breakdowns with 30 tooltip instances). Potential future optimizations if needed:

- `React.memo` on heavy sub-components (StatsBreakdowns, StatsCalendarGrid, StatsKpiCards, StatsPnlChart)
- `useDeferredValue` on `displayTrades` in StatsPopover + `startTransition` on preset change — makes the dropdown close instantly while stats update in the background
- Replace `toLocaleDateString`/`toLocaleTimeString` calls in `buildCalendarData`, `buildHourlyData`, and `EquityCurveCanvas.drawEquityCurve` with fast arithmetic-based NY timezone conversion (avoids ~2600+ expensive Intl calls per preset switch)
- Eliminate cascading renders: change TradesTab preset counts effect dep from `displayTrades` to `tradesDatePreset`, remove StatsPopover's redundant fetch effects
