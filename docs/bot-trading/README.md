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
| `--manage` | off | Keep running after fill, trail SL on recovery |
| `--size` | `1` | Number of contracts |
| `--dryRun` | off | Log actions without placing orders |

**Phases:**
1. Wait until `--startAt` (skip with `--now`)
2. Track anchors in 7:30–9:20 ET window (skip with `--now` or if past 9:20)
3. Wait for SOS/SOW signal — draws levels live, updates text dynamically
4. Place limit order with SL/TP brackets — wait for fill, add entry marker
5. Trail SL (only with `--manage`)

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
node scripts/bot.mjs analyze --contractId <id> --date <YYYY-MM-DD>
```

### draw-analysis

Draw all levels, markers, and SL trails for a historical date in one shot.

```
node scripts/bot.mjs draw-analysis --contractId <id> --date <YYYY-MM-DD> --side long|short
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
| Support / long entry | `#5b8a72` |
| Resistance / short entry | `#a65d6a` |
| Neutral | `#787b86` |
| Target / TP | `#b8a04a` |
| Stop-loss | `#c13030` |
| Info | `#6b7ea0` |

---

## Required Context

| Data | Source |
|------|--------|
| `contractId` | `GET /market/contracts/available` |
| Candle timestamp | `POST /market/bars` or calculate from current time + timeframe |
| Current price | Latest bar close |
