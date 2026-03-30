# Bot UI

Web interface at `localhost:5173/bot` for controlling the trading bot visually.

Standalone HTML page at `frontend/public/bot.html` (same pattern as theme-editor). No React Router — Vite serves it automatically.

---

## Layout

```
┌─────────────────────────────────────────┐
│  Bot Controls Bar                       │
│  [Contract: MNQ] [Account: 20130833]    │
├─────────────────────────────────────────┤
│                                         │
│     Chart (iframe of main app)          │
│                                         │
├─────────────────────────────────────────┤
│ Date Range: [2026-03-20] to [2026-03-25]│
│ Anchor Window: [7:30] to [9:20]         │
│                                         │
│ [Draw ●ON]  [Trade ○OFF]  [Manage ○OFF] │
│                                         │
│ [▶ Run]  [■ Stop]                       │
│                                         │
│ Log output:                             │
│ [08:30] Anchors — Low: 24440, High: ... │
│ [08:35] SOS detected — entry: 24494 ... │
└─────────────────────────────────────────┘
```

---

## Controls

### Selectors

- **Contract** — dropdown populated from `GET /market/contracts/available`
- **Account** — dropdown populated from `GET /accounts`

### Date Range

Start and end date pickers. Used by Draw mode to analyze each trading day in the range.

### Anchor Window

Start and end time inputs (default `7:30` / `9:20` ET). Maps to `--startAt` and `--windowEnd` flags.

### Toggles

| Toggle | Default | Description |
|--------|---------|-------------|
| Draw | OFF | Draw analysis levels on chart for each date in range |
| Trade | OFF | Start the watch bot for today (live trading) |
| Manage | OFF | Enable SL trailing after fill (`--manage` flag) |

### Actions

- **Run** — start the current operation (draw across range, or start live trading)
- **Stop** — stop the running operation

### Log Panel

Scrollable text area showing bot output in real time. Streams via SSE from `GET /bot/events`.

---

## Modes

### Draw Mode

For each date in the selected range, calls `POST /bot/analyze` to get the SOS/SOW structure, then draws levels on the chart using the existing drawing API.

### Trade Mode

Starts the watch bot for today. Calls `POST /bot/watch` which runs the watch logic server-side. Status updates stream to the log panel via SSE.

---

## Backend Endpoints

Route module: `backend/src/routes/botRoutes.ts`, mounted at `/bot`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/bot/analyze` | Run session analysis for a date, return structure |
| POST | `/bot/watch` | Start watch process (live trading) |
| GET | `/bot/events` | SSE stream for watch log output |
| POST | `/bot/stop` | Stop the running watch process |

### POST /bot/analyze

```json
{ "contractId": "CON.F.US.MNQ.M26", "date": "2026-03-24" }
```

Returns the full SOS/SOW structure with levels, targets, and SL trail events.

### POST /bot/watch

```json
{
  "contractId": "CON.F.US.MNQ.M26",
  "accountId": "20130833",
  "side": "auto",
  "startAt": "7:30",
  "windowEnd": "9:20",
  "manage": false,
  "size": 1
}
```

Starts the watch process. Log output streams via `/bot/events`.

---

## Design

- Dark theme matching the main app (CSS variables from `tokens.css`)
- Muted colors, monospace log output
- Toggle buttons styled like existing chart toolbar
