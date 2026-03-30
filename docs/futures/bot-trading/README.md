# Bot Trading

REST API for drawing on the chart and placing orders from external bots. Base URL: `http://localhost:3001`

Frontend connects to `GET /drawings/events` (SSE) on mount. All draws are instant.

---

## Drawing Tools

All drawing tools use `POST /drawings/add`. Returns `{ "success": true, "id": "<uuid>" }`.

### HLine

```json
{
  "type": "hline",
  "price": 21300,
  "color": "#5b8a72",
  "strokeWidth": 1,
  "contractId": "CON.F.US.MNQ.M26",
  "text": { "content": "Support", "color": "#5b8a72", "fontSize": 12, "bold": false, "italic": false, "hAlign": "right", "vAlign": "middle" },
  "startTime": 0,
  "extendLeft": true
}
```

### Marker

Arrow + label anchored to candle high/low.

```json
{
  "type": "marker",
  "time": 1774304880,
  "price": 24427.25,
  "color": "#5b8a72",
  "label": "Entry  1 @ 24427.25",
  "placement": "below",
  "strokeWidth": 1,
  "contractId": "CON.F.US.MNQ.M26",
  "text": null
}
```

| Scenario | Placement |
|----------|-----------|
| Long entry | `"below"` |
| Long exit | `"above"` |
| Short entry | `"above"` |
| Short exit | `"below"` |

### Remove / Clear

- `DELETE /drawings/remove/:id` — remove one drawing
- `POST /drawings/clear-chart` — remove all

---

## Order Tools

### Place Order

```
POST /orders/place
```

```json
{
  "accountId": "20130833",
  "contractId": "CON.F.US.MNQ.M26",
  "type": 1,
  "side": 0,
  "size": 1,
  "limitPrice": 24400,
  "stopLossBracket": { "ticks": -40, "type": 4 },
  "takeProfitBracket": { "ticks": 80, "type": 1 }
}
```

| Field | Values |
|-------|--------|
| `type` | 1 = Limit, 2 = Market, 4 = Stop |
| `side` | 0 = Buy, 1 = Sell |
| `stopLossBracket` | `ticks` = signed distance from fill (negative for buy, positive for sell), `type` = 4 (Stop) |
| `takeProfitBracket` | `ticks` = signed distance from fill (positive for buy, negative for sell), `type` = 1 (Limit) |

Brackets are optional. Omit either for no SL or no TP.

### Manage Orders

- `POST /orders/cancel` — `{ "accountId", "orderId" }`
- `PATCH /orders/modify` — `{ "accountId", "orderId", "limitPrice?", "stopPrice?", "size?" }`
- `GET /orders/open?accountId=X` — list working orders

### Read State

- `GET /positions/open?accountId=X` — current position
- `GET /trades/search?accountId=X` — fill history

---

## CLI (`scripts/bot.mjs`)

All commands: `node scripts/bot.mjs <command> [options]`

### watch

Real-time bot that tracks anchors, waits for SOS/SOW, places orders with brackets, and optionally trails SL.

```
node scripts/bot.mjs watch --contractId <id> --accountId <id> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--contractId` | required | Instrument contract ID |
| `--accountId` | required | Trading account ID |
| `--side` | `auto` | `long`, `short`, or `auto` (most recent SOS/SOW wins) |
| `--now` | off | Skip wait and anchor window, start immediately |
| `--startAt` | `7:30` | ET time to begin (ignored if `--now`) |
| `--windowEnd` | `9:20` | ET time to lock anchors. `0` = no window, straight to signals |
| `--manage` | off | Keep running after fill, trail SL on recovery |
| `--size` | `1` | Number of contracts |
| `--from` | `7:30` | ET time to start scanning for anchors (e.g. `--from 12:00`) |
| `--dryRun` | off | Log actions without placing orders |

**Phases:**
1. Wait until `--startAt` (skip with `--now`)
2. Track anchors until `--windowEnd` — also detects signals (skip with `--now` or `--windowEnd 0`)
3. Wait for SOS/SOW signal — draws levels live, updates text dynamically
4. Place limit order with SL/TP brackets — wait for fill, add entry marker
5. Trail SL (only with `--manage`)

**Market hours:** Futures open Sunday 6 PM ET — Friday 5 PM ET. Bot exits when market is closed.

**Previous day fallback:** When current session has < 30 bars (e.g. Sunday open), the bot merges the previous trading day's bars automatically. This ensures structure detection has enough context for the important previous SOS/SOW algorithm. Previous day bars are cached and included in every subsequent fetch.

**Skip conditions:** The bot skips placing an order if the target was already hit AND the invalidation level was tested (price reached entry). If the target was hit but invalidation was never tested, the order is still placed — the entry wouldn't have filled so the opportunity is still valid.

**Dynamic drawings during watch:**

| Line | Before signal | After signal | After fill |
|------|--------------|-------------|------------|
| Move to Low | "Move to Low" | "Move to Low (SOS)" | kept |
| Move to High | tracks running high | "Move to High (SOW)" | kept |
| Stop Loss | "Stop Loss (preview)" | kept | removed (real bracket live) |
| Previous SOS/SOW | "Previous SOS" | kept | kept |
| Entry marker | — | — | added at fill candle |

### analyze

Print detected structure for a date.

```
node scripts/bot.mjs analyze --contractId <id> --date <YYYY-MM-DD> [--from HH:MM] [--to HH:MM]
```

Optional `--from` / `--to` override the anchor scan window (default 7:30 to end of day).

### draw-analysis

Draw all levels, markers, and SL trails for a historical date in one shot.

```
node scripts/bot.mjs draw-analysis --contractId <id> --date <YYYY-MM-DD> --side long|short [--from HH:MM] [--to HH:MM]
```

### manage

Print SL trail events for a historical date.

```
node scripts/bot.mjs manage --contractId <id> --date <YYYY-MM-DD> --side long|short
```

---

## Style Defaults

**Text:** `hAlign: "right"`, `vAlign: "middle"` — text sits on the line, right-aligned.

**Colors** (muted, dark-chart friendly):

| Purpose | Hex |
|---------|-----|
| Move to Low (current) | `#b05050` (muted red) |
| Previous Move to Low (SOS target) | `#8b6060` (softer red) |
| Move to High (current) | `#5b8a72` (muted green) |
| Previous Move to High (SOW target) | `#6b9a7a` (softer green) |
| Neutral | `#787b86` |
| Stop-loss | `#c13030` |
| Info | `#6b7ea0` |

---

## Required Context

| Data | Source |
|------|--------|
| `contractId` | `GET /market/contracts/available` |
| Candle timestamp | `POST /market/bars` or calculate from current time + timeframe |
| Current price | Latest bar close |
