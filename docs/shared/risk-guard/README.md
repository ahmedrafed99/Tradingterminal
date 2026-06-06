# Risk Guard — Max Loss per Trade Safeguard

Automatically flattens a position the moment its unrealized loss crosses a user-configured dollar threshold — even when no stop loss is set.

---

## UI

```
┌─────────────────────────────────────────────────────────────┬──────────────────┐
│  NQ  1D  ▾   [chart toolbar]                        ⚙  📷  │  Market  Limit   │
├─────────────────────────────────────────────────────────────┤                  │
│                                                             │  Contracts  [3 ▲]│
│   19,842 ──┤                                               │                  │
│            │  █                                            │  ┌─────────────┐ │
│   19,800 ──┤  █  █                                        │  │  Bracket ⚙  │ │
│            │  █  █  █                                     │  │  SL  20 pts │ │
│   19,760 ──┤  █  █  █  █                  entry ●────────│  │  TP1 30 pts │ │
│            │           █                                  │  └─────────────┘ │
│   19,740 ──┤           █  █              ← upnl: -$80    │                  │
│            │           █  █  █                            │  ╔═════════════╗ │
│   19,720 ──┼ - - - - - █- █- █- - - - - - - - - - - - - │  ║ Risk Guard  ║ │
│  [guard]   │                                               │  ║ ○────────● ║ │
│   19,700 ──┤                                               │  ║ Max loss   ║ │
│            │                                               │  ║ $ [  100 ] ║ │
│   19,680 ──┤                                               │  ╚═════════════╝ │
│                                                             │                  │
│                                                             │  [Buy]  [Sell]   │
│                                                             │                  │
│                                                             │  ───────────     │
│                                                             │  NQ  Long 3      │
│                                                             │  Entry: 19,762   │
│                                                             │  UP&L: -$80      │
├─────────────────────────────────────────────────────────────┴──────────────────┤
│  Orders   Positions   Trades                                                    │
└─────────────────────────────────────────────────────────────────────────────────┘

                     ┌──────────────────────────────────────────┐
  when triggered →   │ ⛔  Risk guard — position flattened       │
                     │     Loss -$103 exceeded limit of -$100    │
                     └──────────────────────────────────────────┘
```

### Order panel

A **Risk Guard** box appears below the bracket summary, with:
- A toggle (enabled/disabled, persisted in settings)
- A dollar input for the max-loss threshold (e.g. `$100`)

### Chart

When a position is open and risk guard is enabled, a **dashed red horizontal line** is drawn on the chart at the price corresponding to entry − max loss. It updates live as the entry price is confirmed. This gives a visual "floor" before the trade even moves.

### Toast

When the guard fires, a non-dismissible red toast appears:

> **Risk guard — position flattened**  
> Loss -$103 exceeded limit of -$100

---

## How It Works

### Monitoring

A singleton `riskGuardService` subscribes to the Zustand store via `useStore.subscribe`. On every position update it checks:

```
position.unrealizedPnl < -(threshold)
```

If the condition is met and the position hasn't already been flagged as triggered, it fires.

### Trigger sequence

1. Mark the position as guard-triggered (prevents double-fire on the same position)
2. Call `positionService.closePosition(accountId, contractId)` — sends a market flatten
3. Call `bracketEngine.clearSession()` — cancels any open SL/TP bracket orders
4. Show the non-dismissible red toast with the actual loss and the configured limit

### Per-position debounce

The service keeps a `Set<string>` of already-triggered position keys (`accountId:contractId`). Once a position is in that set, no further flattens are attempted for it. The key is cleared when the position size returns to 0 (position closed event).

---

## Configuration

Stored in the existing settings slice (persisted to localStorage + backend JSON file).

| Field | Type | Default | Description |
|---|---|---|---|
| `riskGuardEnabled` | `boolean` | `false` | Master on/off toggle |
| `riskGuardMaxLoss` | `number` | `100` | Dollar threshold (positive number, e.g. `100` = stop at -$100) |

Settings apply **globally** — same threshold for all instruments and accounts.

---

## Integration Points

| System | How it connects |
|---|---|
| `riskGuardService` (new) | Subscribes to store; calls `positionService` + `bracketEngine` on trigger |
| `positionService.closePosition` | Already exists — sends the market flatten |
| `bracketEngine.clearSession` | Already exists — cancels open bracket orders |
| `chartSettingsSlice` (or new `riskGuardSlice`) | Stores `riskGuardEnabled` + `riskGuardMaxLoss` |
| `OrderPanel` | Renders the Risk Guard box; passes config to service |
| Chart (position line layer) | Draws the dashed guard line when a position is open |

---

## Files to Create / Modify

| File | Change |
|---|---|
| `frontend/src/services/riskGuardService.ts` | New singleton — the core monitoring loop |
| `frontend/src/store/slices/riskGuardSlice.ts` | New slice — `enabled`, `maxLoss` |
| `frontend/src/components/order-panel/RiskGuardBox.tsx` | New component — toggle + dollar input |
| `frontend/src/components/order-panel/OrderPanel.tsx` | Mount `RiskGuardBox`; start/stop service on connect/disconnect |
| `frontend/src/components/chart/hooks/useChartWidgets.ts` | Draw the dashed guard line when position is open |