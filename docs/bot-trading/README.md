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
  "text": { "content": "Support", "color": "#5b8a72", "fontSize": 12, "bold": false, "italic": false, "hAlign": "left", "vAlign": "middle" },
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
  "type": 2,
  "side": 0,
  "size": 1,
  "limitPrice": 24400,
  "stopLossBracket": { "ticks": 40, "type": 2 },
  "takeProfitBracket": { "ticks": 80, "type": 1 }
}
```

| Field | Values |
|-------|--------|
| `type` | 1 = Market, 2 = Limit, 3 = Stop |
| `side` | 0 = Buy, 1 = Sell |
| `stopLossBracket` | `ticks` = distance from fill, `type` = 2 (Stop) |
| `takeProfitBracket` | `ticks` = distance from fill, `type` = 1 (Limit) |

Brackets are optional. Omit either for no SL or no TP.

### Manage Orders

- `POST /orders/cancel` — `{ "accountId", "orderId" }`
- `PATCH /orders/modify` — `{ "accountId", "orderId", "limitPrice?", "stopPrice?", "size?" }`
- `GET /orders/open?accountId=X` — list working orders

### Read State

- `GET /positions/open?accountId=X` — current position
- `GET /trades/search?accountId=X` — fill history

---

## Style Defaults

**Text:** `hAlign: "left"`, `vAlign: "middle"` — text sits on the line, left-aligned.

**Colors** (muted, dark-chart friendly):

| Purpose | Hex |
|---------|-----|
| Support / long entry | `#5b8a72` |
| Resistance / short entry | `#a65d6a` |
| Neutral | `#787b86` |
| Target / TP | `#b8a04a` |
| Stop-loss | `#8b5c5c` |
| Info | `#6b7ea0` |

---

## Required Context

| Data | Source |
|------|--------|
| `contractId` | `GET /market/contracts/available` |
| Candle timestamp | `POST /market/bars` or calculate from current time + timeframe |
| Current price | Latest bar close |
