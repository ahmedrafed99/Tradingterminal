# Feature: Top Bar

A top bar (`h-10`) rendered above the chart when connected. Contains account selector, live balance + unrealized P&L, realized P&L, connection status, latency display, and settings access. Hidden when not connected (only the "Connect to TopstepX" button is shown).

**Status**: Implemented

---

## UI Layout

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [Eval-A #▼] 👁  │  Balance: $50,123.45  RP&L: +85.00 $  UP&L: +12.50 $  │ ● ⚙ │
└──────────────────────────────────────────────────────────────────────────────────┘
  Left                              Centre                               Right
```

- **Background**: `bg-black`, border bottom `border-(--color-border)`
- **Font**: `text-xs`, color `var(--color-text-muted)` throughout
- **Height**: `h-10` (40px), `shrink-0`
- **Layout**: Left section is `shrink-0` (auto width), right section uses `w-48 shrink-0`. Centre balance anchored via flex spacers

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/components/TopBar.tsx` | Account selector, privacy toggle, live balance, UP&L, SignalR account listener |
| `frontend/src/store/useStore.ts` | Added `updateAccount` method to patch a single account by ID |

---

## Sections

### Left — Account Selector + Privacy Toggle

- **Dropdown**: Custom dropdown with CSS grid layout (`subgrid`) for column alignment. Populated from `accountService.searchAccounts()` after connection
- **Style**: `bg-(--color-panel)` panel, `text-xs font-medium`, rounded-lg items with `hover:bg-(--color-hover-row)`. Active account highlighted with subtle `#0d0d0d` background. Dropdown container uses `grid-template-columns: 1fr auto` with subgrid on each row so role badges (Master/Follower) align vertically across all rows.
- **Account name formatting**: TopstepX account names are parsed by `formatAccountName()` into label + ID:
  - `$50K TRADING COMBINE | 50KTC-V2-440809-12345` → label: `50K Trading Combine`, id: `12345`
  - `50KTC-V2-440809-12345` → label: `50K Trading Combine`, id: `12345`
  - `PRAC-V2-440809-55555` → label: `Practice`, id: `55555`
  - Non-TopstepX names pass through unchanged
- **Privacy toggle**: Eye icon button. Only blurs the **account ID** portion — the label (e.g. "Practice", "50K Trading Combine") and role badges (Master/Follower) remain visible. Blur uses `filter: blur(5px)`, `opacity: 0.4`, `transition: var(--transition-normal)`.
- **Default state**: `hideAccountName = false` (names visible). State is persisted to localStorage via `hideAccountName` in the Zustand store (survives hard refresh).
- **No accounts**: shows `"No accounts"` in `text-(--color-text-dim)`

### Centre — Balance + RP&L + UP&L

```
Balance: $50,123.45   RP&L: +85.00 $   UP&L: +12.50 $
```

**Privacy blur**: Each value (Balance, RP&L, UP&L) is individually clickable — click to toggle a smooth CSS blur (`filter: blur(5px)`, `opacity: 0.4`, `transition: 0.2s`) for privacy when streaming. State is persisted to localStorage via `hideBalance`, `hideRpnl`, `hideUpnl` in the Zustand store (survives hard refresh).

**Balance** = `account.balance + unrealizedPnl` (live equity). Updates from two sources:

1. **Realized balance** — `GatewayUserAccount` SignalR events update `account.balance` via `updateAccount()`. Fires on fills and position closes.
2. **Unrealized P&L** — computed on every render from `lastPrice` (real-time quotes), `positions`, and `orderContract` (tick size + tick value).

```ts
const diff = isLong ? lastPrice - pos.averagePrice : pos.averagePrice - lastPrice;
unrealizedPnl += calcPnl(diff, orderContract, pos.size);
```

`calcPnl()` from `utils/instrument.ts` — universal formula `(priceDiff / tickSize) * tickValue * size`, works for both futures and crypto.

**UP&L display** — color-coded:
- Positive: `text-[#26a69a]` (green), prefixed with `+`
- Negative: `text-[#ef5350]` (red)
- Zero: `text-[#d1d4dc]` (neutral white), no prefix

### Centre — Realized P&L

```
RP&L: +$85.00
```

**Net Realized P&L** = `sum(profitAndLoss) - sum(fees) - sum(commissions)` for non-voided trades in the current CME session. Both `fees` and `commissions` are included so the figure matches the Stats dashboard `totalNet`.

- **Data source**: `POST /api/Trade/search` with `{ accountId, startTimestamp }` — proxied via `GET /trades/search`
- **Session boundary**: CME session starts at 6 PM New York time (23:00 UTC in EST, 22:00 UTC in EDT). Calculated by `getCmeSessionStart()` helper in `frontend/src/utils/cmeSession.ts`
- **`profitAndLoss`** values are in dollars (no tick-value multiplication needed); `null` for opening half-turns (ignored)
- **Refresh**: SignalR `GatewayUserTrade` events trigger a REST re-fetch (debounced 500ms) in `App.tsx`. Trade events do NOT include `profitAndLoss`, so a full `tradeService.searchTrades()` call is required. `App.tsx` fetches independently — does **not** depend on `TradesTab` being mounted. Result updates `allTradesCache` and `sessionTrades` store slice.
- **Color-coded**: positive `text-[#26a69a]` (green) with `+` prefix, negative `text-[#ef5350]` (red), zero `text-[#d1d4dc]` (neutral)

**Data pipeline:**
```
SignalR GatewayUserTrade event
  → App.tsx onTrade handler (debounced 500ms)
  → tradeService.searchTrades(accountId, startTimestamp)  ← REST fetch
  → allTradesCache.set(accountId, trades)                 ← shared cache
  → store.setSessionTrades(trades filtered by getCmeSessionStart())
  → TopBar useMemo recomputes realizedPnl / realizedFees
  → RP&L re-renders
```

Note: `TradesTab` also registers its own `onTrade` handler to refresh its display. Both handlers fire independently — no coupling between them.

### Right — Connection Status + Latency + Settings

- **Status pill**: `w-1.5 h-1.5` circle, `bg-emerald-400` (connected) or `bg-red-400` (disconnected) + text label
- **Latency display**: WebSocket RTT measured via `realtimeService.ping()` every 5 seconds
  - Color-coded dot + ms value: green (`#26a69a`) < 50ms, yellow (`#f0a830`) 50–150ms, red (`#ef5350`) > 150ms
  - Only shown when connected
- **Settings icon**: gear SVG, opens `SettingsModal` via `setSettingsOpen(true)`

---

## Effects

### Auto-select account
```ts
useEffect(() => {
  if (accounts.length === 0) return;
  if (activeAccountId === null || !accounts.find(...)) {
    setActiveAccountId(accounts[0].id);
  }
}, [accounts, activeAccountId, setActiveAccountId]);
```
Selects the first account when accounts load or if the persisted ID is stale.

### Clear accounts on disconnect
```ts
useEffect(() => {
  if (!connected) useStore.getState().setAccounts([]);
}, [connected]);
```
Accounts are loaded by `App.tsx` on page refresh and by `SettingsModal` on user-initiated connect. TopBar only clears them on disconnect.

### Live balance via SignalR
```ts
useEffect(() => {
  if (!connected) return;
  const handler = (account: RealtimeAccount) => {
    updateAccount({ id: account.id, balance: account.balance });
  };
  realtimeService.onAccount(handler);
  return () => { realtimeService.offAccount(handler); };
}, [connected, updateAccount]);
```
Listens to `GatewayUserAccount` events and patches the account's `balance` field in the store. The `SubscribeAccounts` call is already made in `realtimeService.flushUserSubscriptions()`.

---

## Store State

### AccountsState
```ts
interface AccountsState {
  accounts: Account[];
  activeAccountId: number | null;
  setAccounts: (accounts: Account[]) => void;
  setActiveAccountId: (id: number) => void;
  updateAccount: (partial: { id: number } & Partial<Account>) => void;
}
```

`updateAccount` merges partial data into the matching account in the array:
```ts
updateAccount: (partial) =>
  set((s) => ({
    accounts: s.accounts.map((a) =>
      a.id === partial.id ? { ...a, ...partial } : a,
    ),
  })),
```

### Data used from other slices
- `positions` (PositionsState) — open positions for unrealized P&L
- `lastPrice` (OrderPanelState) — real-time market price from quotes
- `orderContract` (OrderPanelState) — provides `tickSize` and `tickValue` for P&L calculation

---

## Implementation Notes

- `activeAccountId` is persisted to localStorage (via Zustand `persist` middleware) — survives page reloads
- `accounts` array is NOT persisted — re-fetched on every connection
- Unrealized P&L is computed inline during render (no extra state/effect) since `lastPrice` changes trigger re-renders via Zustand selector
- `contractId` comparison uses `String()` coercion — SignalR sends strings, API may return numbers
- The P&L formula matches `PositionDisplay` in the order panel — both use `calcPnl()` from `utils/instrument.ts`
