# Bot Trading

External bots (Claude Code, scripts, agents) interact with the trading terminal chart through a REST API backed by Server-Sent Events for instant delivery.

---

## Transport

The frontend opens an `EventSource` to `GET /drawings/events` on mount. All drawing commands are broadcast to connected clients via SSE — drawings appear on the chart instantly, no polling.

**Base URL:** `http://localhost:3001`

---

## Tools

### Draw Horizontal Line

Draw a full-width horizontal line at a price level.

```
POST /drawings/add
```

```json
{
  "type": "hline",
  "price": 21300,
  "color": "#5b8a72",
  "strokeWidth": 1,
  "contractId": "CON.F.US.MNQ.M26",
  "text": {
    "content": "Support",
    "color": "#5b8a72",
    "fontSize": 12,
    "bold": false,
    "italic": false,
    "hAlign": "left",
    "vAlign": "middle"
  },
  "startTime": 0,
  "extendLeft": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"hline"` | Required |
| `price` | number | Price level |
| `color` | string | Hex color (e.g. `"#ff4d4f"` red, `"#787b86"` gray) |
| `strokeWidth` | number | Line thickness 1-4 |
| `contractId` | string | Instrument contract ID (must match the chart) |
| `text` | DrawingText \| null | Optional label on the line |
| `startTime` | number | Unix seconds — 0 for full width |
| `extendLeft` | boolean | `true` = full width, `false` = starts at `startTime` going right |

---

### Draw Marker

Draw an arrow + pill label anchored to a candle's high or low.

```
POST /drawings/add
```

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

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"marker"` | Required |
| `time` | number | Bar timestamp in unix seconds (must align to a candle) |
| `price` | number | Price level (fallback anchor if bar data unavailable) |
| `color` | string | Arrow and arrowhead color |
| `label` | string | Text in the pill (e.g. `"Entry  1 @ 24427.25"`) |
| `placement` | `"above"` \| `"below"` | `"below"` = anchors to candle low, `"above"` = anchors to candle high |
| `contractId` | string | Instrument contract ID |

**Placement rules for trade markers:**

| Scenario | Placement |
|----------|-----------|
| Long entry | `"below"` (arrow under candle low) |
| Long exit | `"above"` (arrow above candle high) |
| Short entry | `"above"` (arrow above candle high) |
| Short exit | `"below"` (arrow under candle low) |

---

### Remove Drawing

Remove a specific drawing by its ID (returned from the add call).

```
DELETE /drawings/remove/:id
```

---

### Clear All Drawings

Remove all drawings from the chart.

```
POST /drawings/clear-chart
```

---

## Response Format

All endpoints return:

```json
{ "success": true, "id": "<uuid>" }
```

The `id` is auto-generated if not provided in the request body. Store it to remove individual drawings later.

---

## Style Defaults

### Color Palette

Muted, eye-friendly colors that sit well on a dark chart background.

| Purpose | Color | Hex |
|---------|-------|-----|
| Support / long entry | Soft teal | `#5b8a72` |
| Resistance / short entry | Muted rose | `#a65d6a` |
| Neutral level | Warm gray | `#787b86` |
| Target / take-profit | Soft gold | `#b8a04a` |
| Stop-loss | Dusty red | `#8b5c5c` |
| Info / annotation | Slate blue | `#6b7ea0` |

### Text Positioning

All HLine labels use `vAlign: "middle"`, `hAlign: "left"` so text sits centered on the line, aligned to the left edge of the chart.

```json
{
  "text": {
    "content": "Support",
    "color": "#5b8a72",
    "fontSize": 12,
    "bold": false,
    "italic": false,
    "hAlign": "left",
    "vAlign": "middle"
  }
}
```

---

## Required Context

To place drawings, the bot needs:

| Data | How to get it |
|------|---------------|
| `contractId` | `GET /market/contracts/available` — use the `id` field |
| Candle timestamp | `POST /market/bars` — bar timestamps in the response, or calculate from current time + timeframe |
| Current price | Latest bar close, or observe from chart |
